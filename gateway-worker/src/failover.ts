/**
 * Durable failover stream.
 *
 * Why: handleChat used to await the upstream response BEFORE constructing the
 * client Response. Under heavy context, providers (pi.b.ai) hold the response
 * headers for 100-130s — Cloudflare's edge then 524s the CLIENT long before
 * our own headers arrive, so agents see "Response ended unexpectedly" / empty
 * compact responses. The retry loop also only rotated keys of the SAME
 * provider, so a saturated provider was never escaped.
 *
 * Here the client Response exists from the first moment: byte 0 goes out
 * immediately (`: open` comment for SSE, a single space for JSON — both are
 * valid-whitespace no-ops to every parser), heartbeats keep the connection
 * alive during the header wait, and attempts rotate across the provider's
 * KEYS (the admin decides which providers serve a model — the gateway never
 * escapes to an unenabled provider). A key attempt is retried on another
 * key when it stalls (header deadline), 429s, 5xx's, drops the connection
 * or embeds an error BEFORE any content byte reached the client; auth
 * failures additionally mark the key dead. After content flows, switching
 * is impossible — we end the stream honestly with an error frame instead.
 *
 * Settle happens exactly once, in the caller, off the outcome.
 */
import { pickWeighted, type ProviderKeyRow } from './keys';
import {
	errorFrame,
	extractNonStreamUsage,
	makeIdleTimer,
	pumpAggregate,
	pumpProviderStream,
	CLIENT_GONE_REASON,
	HEARTBEAT_MS,
	IDLE_TIMEOUT_MS,
	STALL_REASON,
	type PumpResult,
	type StreamOutcome,
	type Wire,
} from './stream';

export interface RouteRow {
	/** models.id of THIS row (the provider the admin enabled for this model) */
	model_id: string;
	provider_id: string;
	provider_kind: string;
	provider_base_url: string;
}

export interface FailoverDeps {
	/** raw upstream call; must honor signal; forceStream re-issues stream:true for aggregate mode */
	call(
		route: RouteRow,
		apiKey: string,
		forceStream: boolean,
		signal: AbortSignal,
	): Promise<Response>;
	loadKeys(route: RouteRow): Promise<ProviderKeyRow[]>;
	decrypt(key: ProviderKeyRow): Promise<string>;
	markKeyDead(keyId: string): Promise<void>;
}

export type FinalErrorKind =
	| 'upstream_failed'
	| 'provider_keys_rejected'
	| 'no_provider_keys'
	| 'provider_rate_limited'
	| 'client_request_error'
	| 'gateway_timeout';

export interface FailoverOutcome extends StreamOutcome {
	/** null on success; otherwise what killed the request (status + wire kind) */
	finalError: { kind: FinalErrorKind; status: number; message: string } | null;
	/** provider that actually served the answer (may differ from primary) */
	servedRoute: RouteRow | null;
	/** human-readable attempt trace, logged for wrangler tail */
	trace: string[];
	/** client disconnected before completion */
	clientGone: boolean;
}

export interface FailoverOptions {
	clientWire: Wire;
	/** 'sse' passthrough | 'aggregate' stream:false | 'buffer' gemini non-stream JSON */
	mode: 'sse' | 'aggregate' | 'buffer';
	/** the admin-enabled provider row for this model — the ONE route */
	route: RouteRow;
	deps: FailoverDeps;
	headerWaitFirstMs?: number;
	headerWaitLaterMs?: number;
}

const DEFAULT_HEADER_WAIT_FIRST_MS = 100_000;
const DEFAULT_HEADER_WAIT_LATER_MS = 60_000;
/** cap on key attempts within the route (bounds worst-case header-wait) */
const MAX_KEY_ATTEMPTS = 3;

// Neutral client-facing failure texts — never reveal provider internals
// (key rejections, credits, provider codes). Exact reasons live in trace.
const MSG_UNAVAILABLE = 'This model is currently unavailable. Please try again later.';
const MSG_BUSY = 'This model is currently busy. Please try again in a few minutes.';
const MSG_SLOW = 'This model is taking too long to respond. Please try again.';
const MSG_CUT = 'The model\'s response was interrupted. Please try again.';

interface AttemptFailure {
	kind: FinalErrorKind;
	status: number;
	message: string;
	/** auth-class failure — key marked dead, another key of same route was tried */
	keyRejected?: boolean;
}

export function startFailoverStream(opts: FailoverOptions): {
	body: ReadableStream<Uint8Array>;
	outcome: Promise<FailoverOutcome>;
} {
	const encoder = new TextEncoder();
	const outcome: FailoverOutcome = {
		usage: null,
		streamedBytes: 0,
		finalError: null,
		servedRoute: null,
		trace: [],
		clientGone: false,
	};
	let resolveOutcome!: (o: FailoverOutcome) => void;
	const outcomePromise = new Promise<FailoverOutcome>((r) => (resolveOutcome = r));
	let settled = false;
	const finish = () => {
		if (settled) return;
		settled = true;
		if (outcome.trace.length) console.log('[failover]', JSON.stringify({
			served: outcome.servedRoute?.provider_id ?? null,
			trace: outcome.trace,
		}));
		resolveOutcome(outcome);
	};

	let closed = false;
	let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
	let currentAbort: AbortController | null = null;
	let heartbeat: ReturnType<typeof setInterval> | null = null;

	/** write to client; false = client gone (keep-alive or content) */
	const rawPush = (s: string): boolean => {
		if (closed || !controllerRef) return false;
		try {
			controllerRef.enqueue(encoder.encode(s));
			return true;
		} catch {
			return false;
		}
	};
	const keepAlive = () => rawPush(opts.mode === 'sse' ? ': heartbeat\n\n' : ' ');
	const onClientGone = () => {
		if (outcome.clientGone) return;
		outcome.clientGone = true;
		stopHeartbeat();
		try { currentAbort?.abort(new Error(CLIENT_GONE_REASON)); } catch { /* ignore */ }
	};
	/** content writer — after first success byte, route switching is over */
	const pushContent = (s: string): boolean => {
		const ok = rawPush(s);
		if (!ok) onClientGone();
		return ok;
	};

	function stopHeartbeat() {
		if (heartbeat) {
			clearInterval(heartbeat);
			heartbeat = null;
		}
	}

	const prelude = opts.mode === 'sse' ? ': open\n\n' : ' ';

	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controllerRef = controller;
			// first byte IMMEDIATELY — Cloudflare's 524 clock dies here
			rawPush(prelude);
			heartbeat = setInterval(keepAlive, HEARTBEAT_MS);
			void run().finally(() => {
				stopHeartbeat();
				closed = true;
				try { controller.close(); } catch { /* already closed */ }
				finish();
			});
		},
		cancel() {
			onClientGone();
			finish();
		},
	});

	async function run() {
		let lastFailure: AttemptFailure | null = null;
		let sawKeysRejected = false;
		let sawRateLimit = false;
		let sawNoKeys = false;
		let attemptIndex = 0;

		// Single route (the provider the admin enabled for this model);
		// resilience comes from rotating across its live KEYS. Cross-provider
		// escape is a catalog decision (which provider is enabled), never a
		// runtime one.
		const route = opts.route;
		if (!outcome.clientGone) {
			const keys = await opts.deps.loadKeys(route).catch(() => [] as ProviderKeyRow[]);
			const tried = new Set<string>();
			for (let guard = 0; guard < MAX_KEY_ATTEMPTS; guard++) {
				if (outcome.clientGone) return;
				const candidates = keys.filter(
					(k) => !tried.has(k.id) && (!k.dead_until || new Date(k.dead_until).getTime() <= Date.now()),
				);
				const chosen = pickWeighted(candidates);
				if (!chosen) {
					if (tried.size === 0) {
						sawNoKeys = true;
						outcome.trace.push(`route ${route.provider_id.slice(0, 8)}: no live keys`);
					}
					break; // out of keys for this route
				}
				tried.add(chosen.id);
				attemptIndex++;

				let apiKey: string;
				try {
					apiKey = await opts.deps.decrypt(chosen);
				} catch (e) {
					outcome.trace.push(`route ${route.provider_id.slice(0, 8)}: decrypt failed (${(e as Error).name})`);
					lastFailure = { kind: 'upstream_failed', status: 502, message: MSG_UNAVAILABLE };
					continue;
				}

				const forceStream = opts.mode === 'aggregate';
				const result = await attempt(route, chosen, apiKey, forceStream, attemptIndex === 1);
				if (result.done) return; // success or terminal client-shaped error
				if (result.failure?.keyRejected) sawKeysRejected = true;
				if (result.failure?.kind === 'provider_rate_limited') sawRateLimit = true;
				lastFailure = result.failure;
				// pre-content failure → rotate to the next live key (auth failures
				// already marked the key dead by deps.markKeyDead)
			}
		}

		// Every key exhausted and (by construction) zero content bytes reached
		// the client — surface the last failure as an in-band error frame.
		if (!outcome.clientGone) {
			const kind: FinalErrorKind = sawNoKeys && !lastFailure
				? 'no_provider_keys'
				: sawKeysRejected && !lastFailure
					? 'provider_keys_rejected'
					: sawRateLimit
						? 'provider_rate_limited'
						: lastFailure?.kind ?? 'upstream_failed';
			const message =
				lastFailure?.message ??
				MSG_UNAVAILABLE;
			outcome.finalError = { kind, status: lastFailure?.status ?? 502, message };
			pushTerminalError(kind, message);
		}
	}

	interface AttemptResult {
		done: boolean;
		failure: AttemptFailure | null;
	}

	/** One header+stream attempt against one route/key. */
	async function attempt(
		route: RouteRow,
		key: ProviderKeyRow,
		apiKey: string,
		forceStream: boolean,
		isFirst: boolean,
	): Promise<AttemptResult> {
		const attemptStart = Date.now();
		/** first content byte served → time-to-first-token for the usage log */
		const markTtft = () => {
			if (outcome.ttftMs === undefined) outcome.ttftMs = Date.now() - attemptStart;
		};
		const headerWaitMs = isFirst
			? opts.headerWaitFirstMs ?? DEFAULT_HEADER_WAIT_FIRST_MS
			: opts.headerWaitLaterMs ?? DEFAULT_HEADER_WAIT_LATER_MS;
		const abort = new AbortController();
		currentAbort = abort;
		let stalled = false;

		// header-wait deadline — race so we can NAME the failure (stall vs 5xx)
		let headerTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
			stalled = true;
			try { abort.abort(new Error(STALL_REASON)); } catch { /* ignore */ }
		}, headerWaitMs);
		const abortP = new Promise<never>((_, reject) =>
			abort.signal.addEventListener(
				'abort',
				() => reject(new Error(stalled ? STALL_REASON : CLIENT_GONE_REASON)),
				{ once: true },
			),
		);

		let res: Response;
		const callP = opts.deps
			.call(route, apiKey, forceStream, abort.signal)
			.finally(() => {
				if (headerTimer) { clearTimeout(headerTimer); headerTimer = null; }
			});
		callP.catch(() => { /* race loser may reject later — observed in catch below */ });
		try {
			res = await Promise.race([callP, abortP]);
		} catch (e) {
			// stall, client-gone, or a raw fetch rejection (network/DNS/abort)
			callP.then((r) => { try { r.body?.cancel(); } catch { /* ignore */ } }).catch(() => undefined);
			const name = (e as Error)?.message ?? 'fetch-failed';
			if (name === CLIENT_GONE_REASON) {
				outcome.clientGone = true;
				return { done: true, failure: null };
			}
			const failure: AttemptFailure = name === STALL_REASON
				? { kind: 'upstream_failed', status: 504, message: MSG_SLOW }
				: name === 'AbortError'
					? { kind: 'upstream_failed', status: 504, message: MSG_SLOW }
					: { kind: 'upstream_failed', status: 502, message: MSG_UNAVAILABLE };
			outcome.trace.push(`route ${route.provider_id.slice(0, 8)} key ${key.id.slice(0, 8)}: ${name === STALL_REASON || name === 'AbortError' ? failure.message : truncateMsg(name)} (${failure.status})`);
			return { done: false, failure };
		}

		// status classification (mirrors the old attempt loop, plus cross-route escape).
		// CLIENT-FACING POLICY: provider-health failures never reveal the provider's
		// state (key rejections, credit, internal codes) — users get a neutral
		// "model unavailable/busy" message; the exact reason stays in `trace`
		// (server logs) for the admin.
		if (res.status === 401 || res.status === 402 || res.status === 403) {
			await opts.deps.markKeyDead(key.id).catch(() => undefined);
			const hint = extractHint(await res.text().catch(() => ''));
			outcome.trace.push(`route ${route.provider_id.slice(0, 8)} key ${key.id.slice(0, 8)}: ${res.status}${hint ? ` — ${hint}` : ''} → key marked dead`);
			return { done: false, failure: { kind: 'provider_keys_rejected', status: res.status, message: MSG_UNAVAILABLE, keyRejected: true } };
		}
		if (res.status === 429) {
			outcome.trace.push(`route ${route.provider_id.slice(0, 8)} key ${key.id.slice(0, 8)}: 429 rate-limited`);
			return { done: false, failure: { kind: 'provider_rate_limited', status: 429, message: MSG_BUSY } };
		}
		if ([400, 404, 422].includes(res.status)) {
			// client-shaped error: failover can't help. Pass through only
			// request-scoped provider text (context length, invalid params);
			// anything provider-internal is masked.
			const text = await res.text().catch(() => '');
			const safe = clientSafeReason(text);
			outcome.finalError = { kind: 'client_request_error', status: res.status, message: safe ?? `The model rejected this request (${res.status}). Please review your request parameters.` };
			outcome.trace.push(`route ${route.provider_id.slice(0, 8)}: HTTP ${res.status} (client-shaped)${safe ? '' : ` — ${truncateMsg(text)}`}`);
			if (!outcome.clientGone) pushTerminalError('upstream_failed', outcome.finalError.message);
			return { done: true, failure: null };
		}
		if (res.status >= 500) {
			outcome.trace.push(`route ${route.provider_id.slice(0, 8)} key ${key.id.slice(0, 8)}: HTTP ${res.status}`);
			return { done: false, failure: { kind: 'upstream_failed', status: 502, message: MSG_UNAVAILABLE } };
		}

		// ---- headers OK (2xx): stream through the mode pump ----
		// mid-stream idle watchdog: a stalled (not dropped) connection never
		// throws, so abort it — the pump returns and we handle it below
		const upstreamIdle = makeIdleTimer(() => {
			try { abort.abort(new Error(STALL_REASON)); } catch { /* ignore */ }
		}, IDLE_TIMEOUT_MS);

		try {
			if (opts.mode === 'sse') {
				const wrappedPush = (s: string): boolean => {
					upstreamIdle.reset();
					markTtft();
					return pushContent(s);
				};
				const pump = await pumpProviderStream(res, opts.clientWire, wrappedPush);
				// bytes were forwarded to the client as they streamed — bill them
				mergePump(pump);
				if (outcome.clientGone) return { done: true, failure: null };
				const stalledAttempt = isStallAbort(abort.signal);
				if (pump.abortedPreContent && !stalledAttempt) {
					outcome.trace.push(`route ${route.provider_id.slice(0, 8)}: pre-content ${pump.sniffedError ? `embedded error (${pump.sniffedError.status}) ${truncateMsg(pump.sniffedError.message)}` : 'stream drop'}`);
					return { done: false, failure: { kind: 'upstream_failed', status: 502, message: MSG_UNAVAILABLE } };
				}
				if (pump.aborted || stalledAttempt || pump.abortedPreContent) {
					if (outcome.streamedBytes === 0) {
						// stalled right after headers, nothing delivered → switch
						outcome.trace.push(`route ${route.provider_id.slice(0, 8)}: stalled pre-content`);
						return { done: false, failure: { kind: 'upstream_failed', status: 504, message: MSG_SLOW } };
					}
					// content already reached the client — be honest about truncation
					outcome.timedOut = outcome.timedOut || stalledAttempt;
					outcome.aborted = true;
					pushTerminalError(stalledAttempt ? 'gateway_timeout' : 'upstream_disconnected', MSG_CUT);
					outcome.trace.push(`route ${route.provider_id.slice(0, 8)}: ${stalledAttempt ? 'stalled' : 'dropped'} mid-stream after content`);
					return { done: true, failure: null };
				}
				outcome.servedRoute = route;
				return { done: true, failure: null };
			}

			if (opts.mode === 'aggregate') {
				// nothing is written to the client until the doc is complete, so
				// ANY failure is failover-eligible — and never billed (we only
				// merge the pump result on the delivering path)
				const pump = await pumpAggregate(res, opts.clientWire);
				if (outcome.clientGone) return { done: true, failure: null };
				const stalledAttempt = isStallAbort(abort.signal);
				if (pump.abortedPreContent || stalledAttempt) {
					outcome.trace.push(`route ${route.provider_id.slice(0, 8)}: pre-delivery ${stalledAttempt ? 'stall' : pump.sniffedError ? `embedded error (${pump.sniffedError.status}) ${truncateMsg(pump.sniffedError.message)}` : 'empty/aborted stream'}`);
					return { done: false, failure: { kind: stalledAttempt ? 'gateway_timeout' : 'upstream_failed', status: 504, message: stalledAttempt ? MSG_SLOW : MSG_UNAVAILABLE } };
				}
				mergePump(pump);
				if (!pushContent(pump.bodyText)) return { done: true, failure: null };
				markTtft();
				outcome.servedRoute = route;
				return { done: true, failure: null };
			}

			// buffer: gemini non-stream — upstream already replied with one JSON doc
			let bodyText: string;
			try {
				bodyText = await res.text();
			} catch {
				bodyText = '';
			}
			if (bodyText.trim() === '') {
				outcome.trace.push(`route ${route.provider_id.slice(0, 8)}: empty buffer response`);
				return { done: false, failure: { kind: 'upstream_failed', status: 502, message: MSG_UNAVAILABLE } };
			}
			const sniff = safeParseError(bodyText);
			if (sniff) {
				outcome.trace.push(`route ${route.provider_id.slice(0, 8)}: buffer embedded error (${sniff.status}) ${truncateMsg(sniff.message)}`);
				return { done: false, failure: { kind: 'upstream_failed', status: 502, message: MSG_UNAVAILABLE } };
			}
			const usage = extractNonStreamUsage(bodyText, opts.clientWire);
			outcome.usage = usage;
			outcome.streamedBytes += bodyText.length;
			if (!pushContent(bodyText)) return { done: true, failure: null };
			markTtft();
			outcome.servedRoute = route;
			return { done: true, failure: null };
		} finally {
			upstreamIdle.stop();
			currentAbort = null;
		}
	}

	/** fold a pump result into the shared outcome (usage/bytes/sniffed error) */
	function mergePump(p: PumpResult) {
		if (p.usage) outcome.usage = p.usage;
		// pump.streamedBytes counts payload bytes forwarded (or assembled); the
		// durable stream pushes them itself, so sum rather than overwrite.
		outcome.streamedBytes += p.streamedBytes;
		if (p.sniffedError) outcome.sniffedError = p.sniffedError;
		if (p.aborted) outcome.aborted = true;
		if (p.timedOut) outcome.timedOut = true;
	}

	function pushTerminalError(kind: string, message: string) {
		if (opts.mode === 'sse') {
			pushContent(errorFrame(opts.clientWire, kind, message));
			if (opts.clientWire === 'openai') pushContent('data: [DONE]\n\n');
		} else {
			pushContent(JSON.stringify({ error: { message, type: kind, code: kind } }));
		}
	}

	return { body, outcome: outcomePromise };
}

function isStallAbort(signal: AbortSignal): boolean {
	const reason = signal.reason as Error | undefined;
	return reason?.message === STALL_REASON || reason?.name === STALL_REASON;
}

function safeParseError(bodyText: string): { status: number; message: string } | null {
	try {
		const j = JSON.parse(bodyText);
		if (j.error) {
			return {
				status: typeof j.error.code === 'number' ? j.error.code : 502,
				message: j.error.message ?? 'Upstream error',
			};
		}
	} catch {
		/* not JSON */
	}
	return null;
}

/**
 * Pull a human-readable reason out of an auth-class error body for the
 * SERVER trace. Never sent to clients.
 */
function extractHint(text: string): string | null {
	const t = text.trim();
	if (!t) return null;
	try {
		const j = JSON.parse(t) as Record<string, unknown>;
		const e = (j.error ?? j) as Record<string, unknown>;
		for (const k of ['message', 'detail', 'provider_code', 'code', 'reason']) {
			const v = e[k];
			if (typeof v === 'string' && v) return truncateMsg(v);
		}
	} catch {
		/* not JSON */
	}
	if (t.length < 200 && !t.startsWith('<')) return truncateMsg(t);
	return null;
}

/**
 * For client-shaped 4xx responses: pass the provider's text through ONLY
 * when it describes the request itself (context length, invalid params,
 * unknown model) and says nothing about provider internals (keys, quota,
 * credits, provider codes). Otherwise null → the generic rejection text.
 */
function clientSafeReason(text: string): string | null {
	const t = text.trim();
	if (!t) return null;
	let msg: string | null = null;
	try {
		const j = JSON.parse(t) as Record<string, unknown>;
		const e = (j.error ?? j) as Record<string, unknown>;
		const m = e.message ?? e.detail;
		if (typeof m === 'string' && m) msg = m;
	} catch {
		msg = t.length < 200 && !t.startsWith('<') ? t : null;
	}
	if (!msg) return null;
	if (/\b(provider|provider_code|api[ -]?key|apikey|quota|credit|balance|billing|subscription|unauthorized|forbidden|payment)\b/i.test(msg)) return null;
	if (/\b(context|token|length|invalid|unsupported|not (found|exist|supported)|maximum|too (long|large)|parameter)/i.test(msg)) return truncateMsg(msg);
	return null;
}

function truncateMsg(s: string): string {
	return s.length > 300 ? s.slice(0, 300) + '…' : s;
}
