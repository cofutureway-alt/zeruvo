/**
 * SSE pass-through with:
 *  - first-chunk error sniffing (providers embed errors in HTTP-200 streams)
 *  - heartbeat comments every 15s to survive proxy idle windows
 *  - usage extraction from terminal chunks (per provider format)
 *  - normalized error frames on the client's own wire format
 */
export type Wire = 'openai' | 'anthropic' | 'gemini';

export interface Usage {
	input: number;
	output: number;
	cacheRead?: number;
}

const HEARTBEAT_MS = 15_000;
const TIMEOUT_MS_DEFAULT = 300_000; // admin-adjustable later via config

export interface StreamOutcome {
	usage: Usage | null;
	sniffedError?: { status: number; message: string };
	timedOut?: boolean;
	/** upstream connection dropped mid-response (client must know it was truncated) */
	aborted?: boolean;
	/** bytes actually streamed to the client — provable output volume */
	streamedBytes: number;
}

/**
 * Pipe provider SSE → client SSE. Returns accumulated outcome.
 * `toClientFrame` lets each wire re-frame terminal/error events its own way;
 * raw data lines pass through untouched otherwise (formats are compatible).
 */
function makeIdleTimer(onFire: () => void, timeoutMs: number): { reset(): void; stop(): void } {
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

export function pipeProviderStream(
	providerRes: Response,
	clientWire: Wire,
	timeoutMs = TIMEOUT_MS_DEFAULT,
): { body: ReadableStream<Uint8Array>; outcome: Promise<StreamOutcome> } {
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	let timerRef: { reset(): void; stop(): void } | null = null;

	const outcome: StreamOutcome = { usage: null, streamedBytes: 0 };
	let resolveOutcome!: (o: StreamOutcome) => void;
	const outcomePromise = new Promise<StreamOutcome>((r) => (resolveOutcome = r));
	let outcomeSettled = false;
	/** idempotent resolution — client cancels/timeout/error can all race here */
	function finish() {
		if (outcomeSettled) return;
		outcomeSettled = true;
		resolveOutcome(outcome);
	}

	const reader = providerRes.body!.getReader();

	/**
	 * Idle timeout: re-armed on every chunk of upstream activity. A stream
	 * that is actively producing is never killed; only a stalled one hits
	 * the limit. (The previous single-shot 300s timer killed legitimate
	 * long generations mid-answer once the context grew.)
	 */

	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			let buffer = '';
			let firstDataSeen = false;

			/** enqueue that never throws on a dead client */
			function safeEnqueue(chunk: Uint8Array): boolean {
				try {
					controller.enqueue(chunk);
					return true;
				} catch {
					return false; // client gone
				}
			}

			const timer = makeIdleTimer(() => {
				outcome.timedOut = true;
				safeEnqueue(
					encoder.encode(errorFrame(clientWire, 'gateway_timeout', 'Upstream idle beyond the time limit')),
				);
				try { reader.cancel(); } catch {}
				cleanup();
				try { controller.close(); } catch {}
				finish();
			}, timeoutMs);
			timerRef = timer;

			heartbeatInterval = setInterval(() => {
				timer.reset(); // a heartbeat counts as our own activity toward the client
				safeEnqueue(encoder.encode(': heartbeat\n\n'));
			}, HEARTBEAT_MS);

			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					timer.reset();
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
								safeEnqueue(encoder.encode(errorFrame(clientWire, 'upstream_error', err.message)));
								cleanup();
								try { controller.close(); } catch {}
								finish();
								return;
							}
						}
						extractUsage(payload, clientWire, outcome);
						outcome.streamedBytes += payload.length;
						// stop piping if the client walked away — but the outcome
						// still resolves so quota settles for what was streamed
						if (!safeEnqueue(encoder.encode(`data: ${payload}\n\n`))) {
							cleanup();
							try { reader.cancel(); } catch {}
							try { controller.close(); } catch {}
							finish();
							return;
						}
					}
				}
			} catch {
				/* upstream aborted mid-stream */
				outcome.aborted = true;
				// tell the client the answer was cut short — a bare [DONE] would
				// present a truncated generation as a complete one
				safeEnqueue(
					encoder.encode(errorFrame(clientWire, 'upstream_disconnected', 'Upstream connection dropped mid-response')),
				);
			}

			// terminal frame per wire
			if (clientWire === 'openai') safeEnqueue(encoder.encode('data: [DONE]\n\n'));
			cleanup();
			try { controller.close(); } catch {}
			finish();
		},
		cancel() {
			cleanup();
			try {
				reader.cancel();
			} catch {}
			// client walked away mid-stream — still settle quota for the
			// provable volume streamed so far (was: reservation stranded)
			finish();
		},
	});

	function cleanup() {
		if (heartbeatInterval) clearInterval(heartbeatInterval);
		timerRef?.stop();
	}

	return { body, outcome: outcomePromise };
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

/**
 * Aggregate an upstream SSE stream into ONE complete JSON document, for
 * clients that asked stream:false.
 *
 * Why not `await res.text()` on a non-streaming upstream call? Because the
 * worker then sends zero bytes until the whole generation finishes — and
 * with a large context that exceeds Cloudflare's ~100s no-response window
 * (HTTP 524 kills the request). Instead we request streaming from the
 * provider, respond immediately with a single space (valid JSON
 * whitespace, ignored by every parser), then keep emitting a space every
 * 15s while frames accumulate — the connection stays visibly alive — and
 * finally enqueue the reassembled JSON.
 */
export function aggregateProviderStream(
	providerRes: Response,
	clientWire: Wire,
	timeoutMs = TIMEOUT_MS_DEFAULT,
): { body: ReadableStream<Uint8Array>; outcome: Promise<StreamOutcome> } {
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();

	const outcome: StreamOutcome = { usage: null, streamedBytes: 0 };
	let resolveOutcome!: (o: StreamOutcome) => void;
	const outcomePromise = new Promise<StreamOutcome>((r) => (resolveOutcome = r));
	let outcomeSettled = false;
	function finish() {
		if (outcomeSettled) return;
		outcomeSettled = true;
		resolveOutcome(outcome);
	}

	const reader = providerRes.body!.getReader();

	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			let closed = false;
			const push = (s: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(s));
				} catch {
					/* client gone — keep aggregating so quota still settles */
				}
			};

			// first byte IMMEDIATELY — Cloudflare's 524 clock stops here
			push(' ');

			// keep-alive whitespace while the model thinks
			const timer = makeIdleTimer(() => {
				outcome.timedOut = true;
				push(JSON.stringify({
					error: { message: 'Upstream idle beyond the time limit', type: 'gateway_timeout', code: 'gateway_timeout' },
				}));
				try { reader.cancel(); } catch {}
				clearInterval(heartbeat);
				closed = true;
				try { controller.close(); } catch {}
				finish();
			}, timeoutMs);

			const heartbeat = setInterval(() => {
				timer.reset();
				push(' ');
			}, HEARTBEAT_MS);

			// collected SSE payloads + wire-specific accumulators
			const frames: string[] = [];
			let errorSeen: { status: number; message: string } | undefined;

			try {
				let buffer = '';
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					timer.reset();
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
				outcome.aborted = true;
			}

			clearInterval(heartbeat);
			timer.stop();

			// error → surface it as a normal JSON error with the upstream status
			if (errorSeen) {
				outcome.sniffedError = errorSeen;
				push(JSON.stringify({ error: { message: errorSeen.message, type: 'upstream_error', code: errorSeen.status } }));
				closed = true;
				try { controller.close(); } catch {}
				finish();
				return;
			}

			// reassemble the complete response on the client's wire
			push(JSON.stringify(assembleResponse(clientWire, frames, outcome.usage)));
			closed = true;
			try { controller.close(); } catch {}
			finish();
		},
		cancel() {
			try { reader.cancel(); } catch {}
			finish();
		},
	});

	return { body, outcome: outcomePromise };
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
