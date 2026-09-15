/**
 * Zeruvo AI Gateway — Cloudflare Worker
 * Routes (client wire preserved end-to-end):
 *   POST /v1/chat/completions          → OpenAI wire
 *   POST /v1/messages                  → Anthropic wire
 *   POST /v1beta/models/{m}:generateContent[?alt=sse]  → Gemini wire
 *   GET  /v1/models                    → enabled models list
 *   GET  /health
 */
import { setEnv } from './db';
import { authenticate } from './auth';
import { estimateTokens, reserve, settle, type Reservation } from './quota';
import {
	fromOpenAI,
	fromAnthropic,
	fromGemini,
	toOpenAI,
	toAnthropic,
	toGemini,
	type NeutralRequest,
} from './providers';
import {
	importDek,
	decryptProviderKey,
	loadProviderKeys,
	markDead,
	type ProviderKeyRow,
} from './keys';
import type { Wire } from './stream';
import { startFailoverStream, type RouteRow, type FailoverDeps, type FailoverOutcome } from './failover';

export interface Env {
	SUPABASE_URL: string;
	SUPABASE_SERVICE_ROLE_KEY: string;
	NEXOR_ENCRYPTION_KEY: string;
	MOCK_LLM?: Fetcher;
	/** tunable header-wait deadlines for the failover stream (ms) */
	GATEWAY_HEADER_WAIT_FIRST_MS?: string;
	GATEWAY_HEADER_WAIT_LATER_MS?: string;
}

interface ModelInfo {
	model_id: string;
	provider_id: string;
	provider_kind: string; // custom | openrouter
	provider_base_url: string;
	usage_multiplier: string;
	context_window: number | null;
	enabled: boolean;
}

import { setEnv as setEnvDb, postgrestRpc } from './db';

// module-level env passthrough (set once per isolate in fetch())
let _env: Env | null = null;
function envNow(): Env {
	if (!_env) throw new Error('env not set');
	return _env;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		_env = env;
		setEnvDb(env);
		const url = new URL(request.url);

		if (url.pathname === '/health') {
			return Response.json({ ok: true, service: 'nexor-gateway' });
		}

		try {
			// CORS preflight — browser-hosted agents (Cline, web UIs) send OPTIONS
		// before every call; a 404 here surfaces as an opaque "repeated tool
		// call failures" instead of a real answer.
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'authorization, x-api-key, x-goog-api-key, content-type, anthropic-version',
					'Access-Control-Max-Age': '86400',
				},
			});
		}

		if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
			return await handleChat(request, 'openai', ctx);
		}
		if (url.pathname === '/v1/messages' && request.method === 'POST') {
			return await handleChat(request, 'anthropic', ctx);
		}
		const geminiMatch = url.pathname.match(/^\/v1beta\/models\/([^:]+):(generateContent|streamGenerateContent)$/);
		if (geminiMatch && request.method === 'POST') {
			const wantsStream =
				geminiMatch[2] === 'streamGenerateContent' ||
				url.searchParams.get('alt') === 'sse';
			return await handleChat(request, 'gemini', ctx, decodeURIComponent(geminiMatch[1]), wantsStream);
		}
		if (url.pathname === '/v1/models' && request.method === 'GET') {
			return await listModels(request);
		}

		return json({ error: { type: 'not_found', message: `No route for ${url.pathname}` } }, 404);
	} catch (err) {
		console.error('gateway error', err);
		// Stranded-reservation release lives inside handleChat's own error
		// handling — the reservation is that request's closure state, not
		// module state, so nothing recoverable here.
		return json(
			{ error: { type: 'gateway_error', message: 'Internal gateway error' } },
			500,
		);
	}
	},
};

void postgrestRpc;

// ---------- chat pipeline ----------
async function handleChat(
	request: Request,
	clientWire: Wire,
	ctx: ExecutionContext,
	geminiModel?: string,
	geminiWantsStream?: boolean,
): Promise<Response> {
	// auth, model resolution and body-read are independent — run together
	const rawBody = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!rawBody) return json({ error: { type: 'bad_request', message: 'Invalid JSON' } }, 400);

	const upstreamModel0 = clientWire === 'gemini' ? (geminiModel ?? '') : String(rawBody.model ?? '');
	const [auth, resolvedArr] = await Promise.all([
		authenticate(request),
		postgrestRpc<ModelInfo[]>('resolve_model', { p_upstream_model: upstreamModel0 }).catch(() => null),
	]);
	const resolved = resolvedArr?.[0];
	if (!auth.ok) return json({ error: { type: auth.code, message: auth.message } }, auth.status);

	if (!resolved) {
		return json({ error: { type: 'model_not_found', message: `Unknown model ${upstreamModel0}` } }, 404);
	}
	if (!resolved.enabled) {
		return json({ error: { type: 'model_disabled', message: 'Model not available' } }, 403);
	}
	const multiplier = Number(resolved.usage_multiplier) || 1;

	// parse the body with the adapter matching the CLIENT's wire format —
	// Anthropic/Gemini natives carry system prompts and tool schemas in
	// their own shapes that the OpenAI parser would silently drop
	const neutral =
		clientWire === 'anthropic'
			? fromAnthropic(rawBody)
			: clientWire === 'gemini'
				? fromGemini(rawBody, geminiModel)
				: fromOpenAI(rawBody);
	// Gemini streaming comes from the URL verb (?alt=sse / :streamGenerateContent),
	// never from a JSON field — honor it explicitly
	if (clientWire === 'gemini' && geminiWantsStream) neutral.stream = true;
	const upstreamModel = clientWire === 'gemini' ? (geminiModel ?? neutral.model) : neutral.model;

	// plan/model gating
	const allowed = auth.ctx.allowed_models ?? [];
	if (allowed.length && !allowed.includes(resolved.model_id)) {
		return json({ error: { type: 'model_not_in_plan', message: 'Model not included in your plan' } }, 403);
	}
	const keyAllowed = auth.ctx.api_allowed_models ?? [];
	if (keyAllowed.length && !keyAllowed.includes(resolved.model_id)) {
		return json({ error: { type: 'model_not_allowed_for_key', message: 'Key may not call this model' } }, 403);
	}

	// atomic reservation BEFORE touching the provider — run it in parallel
	// with the key material it doesn't depend on (dek import + provider keys)
	const maxTok =
		clientWire === 'gemini'
			? ((rawBody.generationConfig as { maxOutputTokens?: number })?.maxOutputTokens ?? undefined)
			: typeof rawBody.max_tokens === 'number'
				? rawBody.max_tokens
				: undefined;
	const est = estimateTokens(neutral.messages, maxTok);
	const [reservation, dek] = await Promise.all([
		reserve(
			auth.ctx.user_id,
			multiplier,
			est.inputEstimate,
			est.outputEstimate,
			auth.ctx.plan_daily_weighted ? Number(auth.ctx.plan_daily_weighted) : null,
		),
		importDek(envNow().NEXOR_ENCRYPTION_KEY),
	]);
	if (!reservation.ok) {
		return json({ error: { type: reservation.code, message: reservation.message } }, reservation.status);
	}
	const resv = reservation.reservation;

	// ---- committed: the durable stream owns everything after here.
	// The client Response exists from byte 0 (no more Cloudflare 524 during
	// the provider header wait), keep-alive frames cover the stall windows,
	// and a key that fails BEFORE any content flows is rotated for the next
	// live key of the SAME provider — provider choice stays the admin's.
	const startedAt = Date.now();
	const route: RouteRow = {
		model_id: resolved.model_id,
		provider_id: resolved.provider_id,
		provider_kind: resolved.provider_kind,
		provider_base_url: resolved.provider_base_url,
	};

	const deps: FailoverDeps = {
		call: (r, apiKey, forceStream, signal) =>
			forwardToProvider(envNow(), clientWire, r, neutral, rawBody, apiKey, forceStream, signal),
		loadKeys: async (r) => loadProviderKeys(r.provider_id).catch(() => [] as ProviderKeyRow[]),
		decrypt: (key) => decryptProviderKey(dek, key.encrypted_key),
		markKeyDead: (keyId) => markDead(keyId, 5),
	};

	const isStream = clientWire === 'gemini' ? !!geminiWantsStream : neutral.stream;
	const mode = isStream ? 'sse' : clientWire === 'gemini' ? 'buffer' : 'aggregate';
	const { body, outcome } = startFailoverStream({
		clientWire,
		mode,
		route,
		deps,
		headerWaitFirstMs: Number(envNow().GATEWAY_HEADER_WAIT_FIRST_MS) || undefined,
		headerWaitLaterMs: Number(envNow().GATEWAY_HEADER_WAIT_LATER_MS) || undefined,
	});

	ctx.waitUntil(
		outcome
			.then((o) =>
				settleAfter(resv, billFor(o, est, neutral.stream), {
					api_key_id: auth.ctx.api_key_id,
					model_id: resolved.model_id,
					upstream_model: upstreamModel,
					...logMeta(o, startedAt, neutral.stream, est),
				}),
			)
			.catch((e) => console.error('settle failed', e)),
	);

	return new Response(body, {
		status: 200,
		headers: mode === 'sse' ? sseHeaders() : { 'Content-Type': 'application/json' },
	});
}

/**
 * Settlement policy (anti-quota-burn), unchanged from before failover:
 *  1. total failure before any content, or client-gone with 0 bytes → 0
 *  2. provider reported usage → actual tokens
 *  3. otherwise → provable volume only: input estimate + streamed bytes / 4.
 *     The speculative output estimate is NEVER billed.
 */
function billFor(
	o: FailoverOutcome,
	est: { inputEstimate: number; outputEstimate: number },
	stream: boolean,
): number {
	if (o.finalError && o.streamedBytes === 0) return 0;
	const usage = o.usage;
	if (usage && (usage.input > 0 || usage.output > 0)) return usage.input + usage.output;
	if (!stream && o.finalError) return 0;
	return est.inputEstimate + Math.ceil(o.streamedBytes / 4);
}

/** request_logs fields — same status/error_code vocabulary as before failover */
function logMeta(
	o: FailoverOutcome,
	startedAt: number,
	stream: boolean,
	est: { inputEstimate: number; outputEstimate: number },
): Record<string, unknown> {
	const usage = o.usage;
	const tokensOut = usage?.output ?? Math.ceil(o.streamedBytes / 4);
	const base: Record<string, unknown> = {
		latency_ms: Date.now() - startedAt,
		tokens_in: usage?.input ?? (o.streamedBytes > 0 ? est.inputEstimate : 0),
		tokens_out: tokensOut,
		cache_read_tokens: usage?.cacheRead ?? 0,
	};
	if (o.finalError) {
		const statusMap: Record<string, number> = {
			no_provider_keys: 503,
			provider_keys_rejected: 502,
			provider_rate_limited: 429,
			gateway_timeout: 504,
			upstream_failed: 502,
			client_request_error: o.finalError.status,
		};
		return {
			status: statusMap[o.finalError.kind] ?? 502,
			error_code: o.finalError.kind === 'client_request_error' ? 'upstream_failed' : o.finalError.kind,
			...base,
		};
	}
	return {
		status: o.sniffedError?.status ?? 200,
		error_code: o.sniffedError
			? 'upstream_stream_error'
			: o.timedOut
				? 'gateway_timeout'
				: o.aborted
					? 'upstream_disconnected'
					: !usage && stream
						? 'usage_unreported'
						: null,
		...base,
	};
}

async function forwardToProvider(
	env: Env,
	wire: Wire,
	route: RouteRow,
	neutral: NeutralRequest,
	rawBody: Record<string, unknown>,
	apiKey: string,
	forceStream = false,
	signal?: AbortSignal,
): Promise<Response> {
	// forceStream: the aggregate (stream:false) path asks upstream to stream so
	// bytes can keep flowing to the durable client response (see failover.ts)
	const effective = forceStream ? { ...neutral, stream: true } : neutral;
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	let payload: Record<string, unknown>;
	let endpoint: string;
	let fetcher: Fetcher = fetch as unknown as Fetcher; // default: global fetch
	let path = '';

	if (wire === 'anthropic') {
		headers['x-api-key'] = apiKey;
		headers['anthropic-version'] = rawBody['anthropic-version'] as string ?? '2023-06-01';
		payload = toAnthropic(effective);
		endpoint = 'https://api.anthropic.com/v1/messages';
	} else if (wire === 'gemini') {
		endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${neutral.model}:generateContent`;
		payload = toGemini(effective);
		if (effective.stream) {
			endpoint += '?alt=sse';
		}
		endpoint += (endpoint.includes('?') ? '&' : '?') + `key=${apiKey}`;
	} else {
		// OpenAI-family: custom base URL, OpenRouter, or the internal mock binding
		const base = normalizeBase(route.provider_base_url);
		headers['Authorization'] = `Bearer ${apiKey}`;
		if (route.provider_kind === 'openrouter') {
			headers['HTTP-Referer'] = 'https://zeruvo.online';
			headers['X-Title'] = 'Zeruvo AI';
		}
		payload = toOpenAI(effective);
		// ask the provider to include usage in the final stream chunk,
		// otherwise streaming settlement would fall back to estimates
		if ((payload as { stream?: boolean }).stream) {
			(payload as Record<string, unknown>).stream_options = { include_usage: true };
		}
		endpoint = `${base}/chat/completions`;

		// worker-to-worker on the same account hits Cloudflare loop protection
		// (error 1042) over HTTP — route through the service binding instead.
		const mockHost = 'nexor-mock-llm.alammmedd4.workers.dev';
		if (new URL(endpoint).hostname === mockHost && env.MOCK_LLM) {
			fetcher = env.MOCK_LLM;
			path = new URL(endpoint).pathname + new URL(endpoint).search;
			endpoint = path;
		}
	}

	const init: RequestInit<RequestInitCfProperties> = {
		method: 'POST',
		headers,
		body: JSON.stringify(payload),
		signal,
	};
	return fetcher === (fetch as unknown as Fetcher)
		? await fetch(endpoint, init)
		: await env.MOCK_LLM!.fetch(new Request('https://mock.internal' + endpoint, init));
}

// ---------- /v1/models ----------
async function listModels(request: Request): Promise<Response> {
	// Authenticate like chat: an AI agent listing models must only see the
	// models included in its plan (plan_models), not the whole enabled catalog.
	const auth = await authenticate(request);
	if (!auth.ok) {
		return json({ error: { type: auth.code, message: auth.message } }, auth.status);
	}

	const enabled = await postgrestQuery<Array<{ id: string; upstream_model_id: string; context_window: number | null; display_name: string }>>(
		'models?enabled_for_users=eq.true&select=id,upstream_model_id,context_window,display_name',
	);
	// plan gating: allowed_models is the plan's model list; empty = no
	// restriction, so every enabled model is listed.
	const allowed = auth.ctx.allowed_models ?? [];
	const data = (enabled ?? [])
		.filter((m) => !allowed.length || allowed.includes(m.id))
		.map((m) => ({
			id: m.upstream_model_id,
			object: 'model',
			owned_by: m.upstream_model_id.split('/')[0] ?? 'nexor',
			context_length: m.context_window ?? undefined,
			display_name: m.display_name,
		}));
	return Response.json({ object: 'list', data });
}

// ---------- helpers ----------
function normalizeBase(base: string): string {
	let b = base.trim().replace(/\/+$/, '');
	if (!b.endsWith('/v1')) b += '/v1';
	return b;
}

function sseHeaders(): HeadersInit {
	return {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive',
	};
}

function json(obj: unknown, status: number): Response {
	return new Response(JSON.stringify(obj), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

async function settleAfter(
	resv: Reservation,
	rawBill: number,
	logExtra: Record<string, unknown>,
): Promise<void> {
	try {
		await settle(resv, rawBill, {
			...logExtra,
			// callers always provide tokens_in/tokens_out/cache_read_tokens in
			// logExtra — default to 0 only if omitted
			tokens_in: logExtra.tokens_in ?? 0,
			tokens_out: logExtra.tokens_out ?? 0,
			cache_read_tokens: logExtra.cache_read_tokens ?? 0,
		});
	} catch (err) {
		console.error('settle failed', err);
	}
}

// PostgREST SELECT helper (service role)
async function postgrestQuery<T>(resource: string): Promise<T | null> {
	const env = envNow();
	const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${resource}`, {
		headers: {
			apikey: env.SUPABASE_SERVICE_ROLE_KEY,
			Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
		},
	});
	if (!res.ok) throw new Error(`postgrest ${res.status}: ${await res.text()}`);
	return (await res.json()) as T;
}

void postgrestQuery;
