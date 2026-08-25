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
}

/**
 * Pipe provider SSE → client SSE. Returns accumulated outcome.
 * `toClientFrame` lets each wire re-frame terminal/error events its own way;
 * raw data lines pass through untouched otherwise (formats are compatible).
 */
export function pipeProviderStream(
	providerRes: Response,
	clientWire: Wire,
	timeoutMs = TIMEOUT_MS_DEFAULT,
): { body: ReadableStream<Uint8Array>; outcome: Promise<StreamOutcome> } {
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

	const outcome: StreamOutcome = { usage: null };
	let resolveOutcome!: (o: StreamOutcome) => void;
	const outcomePromise = new Promise<StreamOutcome>((r) => (resolveOutcome = r));

	const reader = providerRes.body!.getReader();

	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			let buffer = '';
			let firstDataSeen = false;

			heartbeatInterval = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': heartbeat\n\n'));
				} catch {
					/* client gone */
				}
			}, HEARTBEAT_MS);

			timeoutHandle = setTimeout(() => {
				outcome.timedOut = true;
				controller.enqueue(
					encoder.encode(errorFrame(clientWire, 'gateway_timeout', 'Upstream exceeded time limit')),
				);
				try {
					reader.cancel();
				} catch {}
				cleanup();
				controller.close();
				resolveOutcome(outcome);
			}, timeoutMs);

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
								controller.enqueue(encoder.encode(errorFrame(clientWire, 'upstream_error', err.message)));
								cleanup();
								controller.close();
								resolveOutcome(outcome);
								return;
							}
						}
						extractUsage(payload, clientWire, outcome);
						controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
					}
				}
			} catch {
				/* upstream aborted */
			}

			// terminal frame per wire
			if (clientWire === 'openai') controller.enqueue(encoder.encode('data: [DONE]\n\n'));
			cleanup();
			controller.close();
			resolveOutcome(outcome);
		},
		cancel() {
			cleanup();
			try {
				reader.cancel();
			} catch {}
		},
	});

	function cleanup() {
		if (heartbeatInterval) clearInterval(heartbeatInterval);
		if (timeoutHandle) clearTimeout(timeoutHandle);
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
