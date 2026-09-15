/**
 * SSE pass-through pumps with:
 *  - first-chunk error sniffing (providers embed errors in HTTP-200 streams)
 *  - usage extraction from terminal chunks (per provider format)
 *  - normalized error frames on the client's own wire format
 *
 * The pumps are sink-driven: they never own the client ReadableStream,
 * heartbeats or timers — the durable failover orchestrator (failover.ts)
 * owns those and hands us a `push` for client bytes. A pump reports
 * `abortedPreContent` when the attempt failed BEFORE any content byte
 * reached the client, which makes it eligible for cross-provider failover.
 */
export type Wire = 'openai' | 'anthropic' | 'gemini';

export interface Usage {
	input: number;
	output: number;
	cacheRead?: number;
}

export const HEARTBEAT_MS = 15_000;
export const IDLE_TIMEOUT_MS = 300_000; // idle (per-stream), not total — re-armed on activity

export interface StreamOutcome {
	usage: Usage | null;
	sniffedError?: { status: number; message: string };
	timedOut?: boolean;
	/** upstream connection dropped mid-response (client must know it was truncated) */
	aborted?: boolean;
	/** bytes actually streamed to the client — provable output volume */
	streamedBytes: number;
}

export interface PumpResult extends StreamOutcome {
	/**
	 * True when this attempt failed (embedded error frame, dropped connection,
	 * or zero usable frames) WITHOUT any content byte having reached the
	 * client — the orchestrator may transparently retry another route.
	 */
	abortedPreContent?: boolean;
}

/** Error name used as AbortSignal.reason when the gateway kills a stalled attempt. */
export const STALL_REASON = 'GatewayStall';
/** Error name used as AbortSignal.reason when the client walked away. */
export const CLIENT_GONE_REASON = 'ClientGone';

export function signalReasonName(signal: AbortSignal | undefined): string {
	const reason = signal?.reason as { name?: string } | undefined;
	return reason?.name ?? '';
}

export interface IdleTimer {
	reset(): void;
	stop(): void;
}

export function makeIdleTimer(onFire: () => void, timeoutMs: number): IdleTimer {
	let handle: ReturnType<typeof setTimeout> | null = null;
	const arm = () => {
		handle = setTimeout(() => {
			handle = null;
			onFire();
		}, timeoutMs);
	};
	arm();
	return {
		reset() {
			if (handle) {
				clearTimeout(handle);
				arm();
			}
		},
		stop() {
			if (handle) {
				clearTimeout(handle);
				handle = null;
			}
		},
	};
}

/**
 * Forward provider SSE → client through `push` (stream:true client).
 * `push` returns false when the client walked away → stop immediately;
 * the outcome still resolves so quota settles for what was streamed.
 *
 * Same re-framing as the original pass-through: only `data:` payloads are
 * forwarded (`data: <payload>\n\n`), OpenAI wire gets the terminal
 * `data: [DONE]\n\n`, a mid-stream upstream drop emits an
 * 'upstream_disconnected' error frame before [DONE] so the client knows
 * the answer was cut short. First data frame sniffs for a provider-embedded
 * error: if found before anything was forwarded → abortedPreContent (the
 * orchestrator fails over instead of leaking a dead stream).
 */
export async function pumpProviderStream(
	providerRes: Response,
	clientWire: Wire,
	push: (s: string) => boolean,
): Promise<PumpResult> {
	const decoder = new TextDecoder();
	const outcome: PumpResult = { usage: null, streamedBytes: 0 };
	const reader = providerRes.body!.getReader();

	let firstDataSeen = false;
	let clientGone = false;
	let buffer = '';

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			let idx: number;
			while ((idx = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, idx).replace(/\r$/, '');
				buffer = buffer.slice(idx + 1);
				if (!line.startsWith('data:')) continue;
				const payload = line.slice(5).trim();
				if (!payload) continue;

				if (!firstDataSeen) {
					firstDataSeen = true;
					const err = sniffError(payload, providerRes.status);
					if (err) {
						outcome.sniffedError = err;
						if (outcome.streamedBytes === 0) {
							outcome.abortedPreContent = true;
						} else {
							push(`data: ${payload}\n\n`); // content already in flight — forward it
						}
						try { reader.cancel(); } catch { /* ignore */ }
						return outcome;
					}
				}
				extractUsage(payload, clientWire, outcome);
				outcome.streamedBytes += payload.length;
				if (!push(`data: ${payload}\n\n`)) {
					clientGone = true;
					break;
				}
			}
			if (clientGone) {
				try { reader.cancel(); } catch { /* ignore */ }
				return outcome;
			}
		}
	} catch {
		/* upstream reader threw (dropped or aborted) */
		if (outcome.streamedBytes === 0) {
			// died before any content — let the orchestrator try another route
			outcome.abortedPreContent = true;
			return outcome;
		}
		// content already reached the client: the orchestrator decides the
		// terminal error (stall vs disconnect) and writes the honest frame
		outcome.aborted = true;
		return outcome;
	}

	if (!clientGone && clientWire === 'openai') push('data: [DONE]\n\n');
	return outcome;
}

/**
 * Consume provider SSE into one complete JSON document, for stream:false
 * clients. Writes NOTHING to the client while collecting (the durable
 * stream's whitespace keep-alive covers that), so every failure mode here
 * is still switchable: embedded error, zero frames, or a mid-collection
 * drop before the assembled doc was pushed → abortedPreContent.
 */
export async function pumpAggregate(
	providerRes: Response,
	clientWire: Wire,
): Promise<PumpResult & { bodyText: string }> {
	const decoder = new TextDecoder();
	const outcome: PumpResult = { usage: null, streamedBytes: 0 };
	const reader = providerRes.body!.getReader();

	const frames: string[] = [];
	let errorSeen: { status: number; message: string } | undefined;

	try {
		let buffer = '';
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let idx: number;
			while ((idx = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, idx).replace(/\r$/, '');
				buffer = buffer.slice(idx + 1);
				if (!line.startsWith('data:')) continue;
				const payload = line.slice(5).trim();
				if (!payload || payload === '[DONE]') continue;

				if (!errorSeen) {
					const err = sniffError(payload, providerRes.status);
					if (err) { errorSeen = err; break; }
				}
				extractUsage(payload, clientWire, outcome);
				outcome.streamedBytes += payload.length;
				frames.push(payload);
			}
			if (errorSeen) break;
		}
	} catch {
		/* upstream dropped mid-collection */
	}

	if (errorSeen) {
		outcome.sniffedError = errorSeen;
		outcome.abortedPreContent = true; // nothing was written to the client
		return { ...outcome, bodyText: '' };
	}
	if (frames.length === 0) {
		// empty stream — pointless to deliver; try another route
		outcome.abortedPreContent = true;
		return { ...outcome, bodyText: '' };
	}
	const bodyText = JSON.stringify(assembleResponse(clientWire, frames, outcome.usage));
	return { ...outcome, bodyText };
}

/** Providers may return HTTP 200 but stream an error object as the first event. */
function sniffError(payload: string, httpStatus: number): { status: number; message: string } | undefined {
	if (httpStatus >= 400) return { status: httpStatus, message: truncate(payload) };
	try {
		const j = JSON.parse(payload);
		if (j.error) {
			return {
				status: typeof j.error.code === 'number' ? j.error.code : 502,
				message: j.error.message ?? truncate(payload),
			};
		}
		if (j.type === 'error' && j.error?.message) {
			return { status: 502, message: j.error.message };
		}
	} catch {
		/* not JSON — fine for openai-style [DONE] etc. */
	}
	return undefined;
}

function extractUsage(payload: string, wire: Wire, outcome: StreamOutcome): void {
	// fast path: the Workers CPU budget is precious on long generations — a
	// substring scan costs ~nothing compared to JSON.parse'ing every frame.
	// Only real usage OBJECTS matter: many providers ship "usage":null on
	// every chunk, and naive substrings would parse (waste) all of them.
	if (!payload.includes('"usage":{') && !payload.includes('usageMetadata')) return;
	try {
		const j = JSON.parse(payload);
		if (wire === 'anthropic') {
			if (j.type === 'message_start' && j.message?.usage) {
				outcome.usage = {
					input: j.message.usage.input_tokens ?? 0,
					output: 0,
					cacheRead: j.message.usage.cache_read_input_tokens ?? 0,
				};
			}
			if (j.type === 'message_delta' && j.usage?.output_tokens != null && outcome.usage) {
				outcome.usage.output = j.usage.output_tokens;
			}
		} else if (wire === 'gemini') {
			if (j.usageMetadata) {
				outcome.usage = {
					input: j.usageMetadata.promptTokenCount ?? 0,
					output: j.usageMetadata.candidatesTokenCount ?? 0,
				};
			}
		} else if (j.usage) {
			outcome.usage = {
				input: j.usage.prompt_tokens ?? 0,
				output: j.usage.completion_tokens ?? 0,
				cacheRead: j.usage.prompt_tokens_details?.cached_tokens ?? 0,
			};
		}
	} catch {
		/* ignore */
	}
}

/** Usage from a single non-streamed JSON document (gemini buffer path). */
export function extractNonStreamUsage(bodyText: string, wire: Wire): Usage {
	try {
		const j = JSON.parse(bodyText);
		if (wire === 'anthropic' && j.usage) {
			return { input: j.usage.input_tokens ?? 0, output: j.usage.output_tokens ?? 0 };
		}
		if (wire === 'gemini' && j.usageMetadata) {
			return { input: j.usageMetadata.promptTokenCount ?? 0, output: j.usageMetadata.candidatesTokenCount ?? 0 };
		}
		if (j.usage) {
			return {
				input: j.usage.prompt_tokens ?? 0,
				output: j.usage.completion_tokens ?? 0,
				cacheRead: j.usage.prompt_tokens_details?.cached_tokens ?? 0,
			};
		}
	} catch {
		/* fall through */
	}
	return { input: 0, output: 0 };
}

export function errorFrame(wire: Wire, code: string, message: string): string {
	if (wire === 'anthropic') {
		return `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: code, message } })}\n\n`;
	}
	if (wire === 'gemini') {
		return `data: ${JSON.stringify({ error: { code: 429, message, status: code } })}\n\n`;
	}
	return `data: ${JSON.stringify({ error: { message, type: code, code } })}\n\n`;
}

function truncate(s: string): string {
	return s.length > 300 ? s.slice(0, 300) + '…' : s;
}

/** Rebuild a full non-streaming response object from collected SSE frames. */
function assembleResponse(wire: Wire, frames: string[], usage: Usage | null): Record<string, unknown> {
	// anthropic: message_start carries the message shell; content_block deltas carry text
	if (wire === 'anthropic') {
		let shell: Record<string, any> | null = null;
		let text = '';
		for (const f of frames) {
			try {
				const j = JSON.parse(f);
				if (j.type === 'message_start') shell = j.message ?? null;
				else if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') text += j.delta.text ?? '';
			} catch { /* skip */ }
		}
		const stopReason = shell?.stop_reason ?? (frames.length ? 'end_turn' : null);
		return {
			id: shell?.id ?? 'msg_gateway',
			type: 'message',
			role: 'assistant',
			model: shell?.model ?? '',
			content: [{ type: 'text', text }],
			stop_reason: stopReason,
			stop_sequence: null,
			usage: usage
				? { input_tokens: usage.input, output_tokens: usage.output }
				: shell?.usage ?? { input_tokens: 0, output_tokens: 0 },
		};
	}

	// gemini: candidates[0].content.parts[].text accumulate
	if (wire === 'gemini') {
		let text = '';
		let finishReason: string | null = null;
		for (const f of frames) {
			try {
				const j = JSON.parse(f);
				for (const c of j.candidates ?? []) {
					for (const p of c.content?.parts ?? []) if (typeof p.text === 'string') text += p.text;
					if (c.finishReason) finishReason = c.finishReason;
				}
			} catch { /* skip */ }
		}
		return {
			candidates: [{
				content: { role: 'model', parts: [{ text }] },
				finishReason: finishReason ?? 'STOP',
			}],
			usageMetadata: usage
				? { promptTokenCount: usage.input, candidatesTokenCount: usage.output }
				: undefined,
		};
	}

	// openai: chunk with delta.text accumulate; tool calls from delta.tool_calls
	let id = 'chatcmpl-gateway';
	let model = '';
	let finishReason: string | null = null;
	let text = '';
	const toolAcc = new Map<number, { id: string; name: string; args: string }>();
	for (const f of frames) {
		try {
			const j = JSON.parse(f);
			if (j.id) id = j.id;
			if (j.model) model = j.model;
			for (const ch of j.choices ?? []) {
				const d = ch.delta ?? {};
				if (typeof d.content === 'string') text += d.content;
				for (const tc of d.tool_calls ?? []) {
					const i = tc.index ?? 0;
					const acc = toolAcc.get(i) ?? { id: tc.id ?? `call_${i}`, name: '', args: '' };
					if (tc.id) acc.id = tc.id;
					if (tc.function?.name) acc.name += tc.function.name;
					if (tc.function?.arguments) acc.args += tc.function.arguments;
					toolAcc.set(i, acc);
				}
				if (ch.finish_reason) finishReason = ch.finish_reason;
			}
		} catch { /* skip */ }
	}
	const message: Record<string, unknown> = { role: 'assistant', content: text || null };
	if (toolAcc.size) {
		message.tool_calls = [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map(([, t], i) => ({
			id: t.id,
			type: 'function',
			function: { name: t.name, arguments: t.args },
			index: i,
		}));
	}
	return {
		id,
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [{ index: 0, message, finish_reason: finishReason ?? 'stop' }],
		usage: usage
			? {
				prompt_tokens: usage.input,
				completion_tokens: usage.output,
				total_tokens: usage.input + usage.output,
			}
			: undefined,
	};
}
