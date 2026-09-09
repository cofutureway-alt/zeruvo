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
	pickWeighted,
	markDead,
} from './keys';
import { pipeProviderStream, aggregateProviderStream, type StreamOutcome, type Wire, type Usage } from './stream';

export interface Env {
	SUPABASE_URL: string;
	SUPABASE_SERVICE_ROLE_KEY: string;
	NEXOR_ENCRYPTION_KEY: string;
	MOCK_LLM?: Fetcher;
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
	const [reservation, dek, providerKeys] = await Promise.all([
		reserve(
			auth.ctx.user_id,
			multiplier,
			est.inputEstimate,
			est.outputEstimate,
			auth.ctx.plan_daily_weighted ? Number(auth.ctx.plan_daily_weighted) : null,
		),
		importDek(envNow().NEXOR_ENCRYPTION_KEY),
		loadProviderKeys(resolved.provider_id),
	]);
	if (!reservation.ok) {
		return json({ error: { type: reservation.code, message: reservation.message } }, reservation.status);
	}
	const resv = reservation.reservation;

	let lastError: Response | null = null;
	let noKeysHit = false;
	const startedAt = Date.now();

	for (let attempt = 0; attempt < 2; attempt++) {
		const keys = attempt === 0 ? providerKeys : await loadProviderKeys(resolved.provider_id);
		const chosen = pickWeighted(keys);
		if (!chosen) {
			noKeysHit = true;
			console.error('NO LIVE KEYS:', JSON.stringify({
				provider_id: resolved.provider_id,
				keys_seen: keys.map((k) => ({ id: k.id.slice(0, 8), dead_until: k.dead_until, now_ms: Date.now() })),
				attempt,
			}));
			// release the reservation — nothing will be billed
			ctx.waitUntil(settleAfter(resv, 0, {
				api_key_id: auth.ctx.api_key_id,
				model_id: resolved.model_id,
				upstream_model: upstreamModel,
				status: 503,
				error_code: 'no_provider_keys',
				latency_ms: Date.now() - startedAt,
			}).catch((e) => console.error('release failed', e)));
			return json({ error: { type: 'no_provider_keys', message: 'Provider has no live keys' } }, 503);
		}
		const apiKey = await decryptProviderKey(dek, chosen.encrypted_key);

		const upstreamRes = await forwardToProvider(envNow(), clientWire, resolved, neutral, rawBody, apiKey);
		if (upstreamRes.ok) {
			const started = Date.now();
			// Gemini wire: only stream when the client actually asked to stream
			// (plain :generateContent gets a single JSON document — piping it
			// through the SSE reader yields an empty body).
			const isStream = clientWire === 'gemini' ? !!geminiWantsStream : neutral.stream;
			if (!isStream) {
				// stream:false client — NEVER buffer the raw non-stream response:
				// the worker would send zero bytes for the whole generation and
				// Cloudflare kills it with 524 once the context grows. Ask the
				// upstream to stream, aggregate frames, and respond immediately
				// with whitespace padding so the connection stays alive.
				let streamed: { body: ReadableStream<Uint8Array>; outcome: Promise<StreamOutcome> };
				if (clientWire === 'gemini') {
					// gemini non-stream upstream returns one JSON doc; just buffer
					// it (it has no SSE framing) — same 524 risk, but gemini native
					// clients on this gateway are rare and always stream via alt=sse
					const bodyText = await upstreamRes.res.text();
					const usage = extractNonStreamUsage(bodyText, clientWire);
					ctx.waitUntil(
						settleAfter(resv, usage.input + usage.output, {
							api_key_id: auth.ctx.api_key_id,
							model_id: resolved.model_id,
							upstream_model: upstreamModel,
							status: upstreamRes.res.status,
							tokens_in: usage.input,
							tokens_out: usage.output,
							cache_read_tokens: usage.cacheRead ?? 0,
							latency_ms: Date.now() - started,
						}).catch((e) => console.error('settle failed', e)),
					);
					return applyUpstreamHeaders(upstreamRes.res, bodyText);
				}
				// re-issue the request as streaming
				const streamNeutral = { ...neutral, stream: true };
				const retry = await forwardToProvider(envNow(), clientWire, resolved, streamNeutral, rawBody, apiKey, true);
				if (retry.ok) {
					streamed = aggregateProviderStream(retry.res, clientWire);
				} else {
					return applyUpstreamHeaders(retry.res, await retry.res.text(), true);
				}
				ctx.waitUntil(
					streamed.outcome.then((o) => {
						const usage = o.usage;
						const rawBill = usage
							? usage.input + usage.output
							: est.inputEstimate + Math.ceil(o.streamedBytes / 4);
						return settleAfter(resv, rawBill, {
							api_key_id: auth.ctx.api_key_id,
							model_id: resolved.model_id,
							upstream_model: upstreamModel,
							status: o.sniffedError?.status ?? 200,
							error_code: o.sniffedError
								? 'upstream_stream_error'
								: o.timedOut
									? 'gateway_timeout'
									: o.aborted
										? 'upstream_disconnected'
										: !usage
											? 'usage_unreported'
											: null,
							tokens_in: usage?.input ?? 0,
							tokens_out: usage?.output ?? Math.ceil(o.streamedBytes / 4),
							cache_read_tokens: usage?.cacheRead ?? 0,
							latency_ms: Date.now() - started,
						});
					}).catch((e) => console.error('settle failed', e)),
				);
				return new Response(streamed.body, {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}
			const { body, outcome } = pipeProviderStream(upstreamRes.res, clientWire);
			ctx.waitUntil(
				outcome.then((o) => {
					// Settlement policy (anti-quota-burn):
					//  1. provider reported usage -> bill actual tokens
					//  2. otherwise -> bill provable volume only:
					//     measured streamed bytes / 4 as output tokens,
					//     plus the input estimate. The speculative output
					//     estimate is NEVER billed.
					const usage = o.usage;
					const rawBill = usage
						? usage.input + usage.output
						: est.inputEstimate + Math.ceil(o.streamedBytes / 4);
					return settleAfter(resv, rawBill, {
						api_key_id: auth.ctx.api_key_id,
						model_id: resolved.model_id,
						upstream_model: upstreamModel,
						status: o.sniffedError?.status ?? 200,
						error_code: o.sniffedError
							? 'upstream_stream_error'
							: o.timedOut
								? 'gateway_timeout'
								: o.aborted
									? 'upstream_disconnected'
									: !usage && neutral.stream
										? 'usage_unreported'
										: null,
						tokens_in: usage?.input ?? 0,
						tokens_out: usage?.output ?? Math.ceil(o.streamedBytes / 4),
						cache_read_tokens: usage?.cacheRead ?? 0,
						latency_ms: Date.now() - started,
					});
				}).catch((e) => console.error('settle failed', e)),
			);
			return new Response(body, {
				status: 200,
				headers: sseHeaders(),
			});
		}

		lastError = upstreamRes.res;
		if ([401, 402, 403].includes(upstreamRes.res.status)) {
			await markDead(chosen.id, 5); // dead 5 min (was 30 — too punishing)
			continue; // retry with another key (same reservation still held)
		}
		if (upstreamRes.res.status === 429) {
			// provider-side rate limit (e.g. free model saturated) — do NOT
			// kill the key; rotate once and if that fails surface a clean 429
			if (attempt === 0) continue;
			ctx.waitUntil(settleAfter(resv, 0, {
				api_key_id: auth.ctx.api_key_id,
				model_id: resolved.model_id,
				upstream_model: upstreamModel,
				status: 429,
				error_code: 'provider_rate_limited',
				latency_ms: Date.now() - startedAt,
			}).catch((e) => console.error('release failed', e)));
			return json(
				{
					error: {
						type: 'provider_rate_limited',
						message: 'Upstream provider is rate-limited for this model. Retry shortly.',
					},
				},
				429,
			);
		}
		break; // other errors: surface to client
	}

	// All attempts failed: nothing was streamed, so release the ENTIRE
	// reservation and bill nothing. Previously this path stranded the
	// reserved amount against the user's quota for the rest of the day.
	const allKeysDead = !noKeysHit && lastError && [401, 402, 403].includes(lastError.status);
	await settleAfter(resv, 0, {
		api_key_id: auth.ctx.api_key_id,
		model_id: resolved.model_id,
		upstream_model: upstreamModel,
		status: noKeysHit ? 503 : lastError!.status,
		error_code: noKeysHit
			? 'no_provider_keys'
			: allKeysDead
				? 'provider_keys_rejected'
				: 'upstream_failed',
		latency_ms: Date.now() - startedAt,
	}).catch((e) => console.error('release failed', e));
	if (allKeysDead) {
		return json(
			{
				error: {
					type: 'provider_keys_rejected',
					message:
						'The upstream provider rejected our credentials from this deployment. This is transient infrastructure — the admin has been notified via key health metrics.',
				},
			},
			502,
		);
	}
	return applyUpstreamHeaders(lastError!, await lastError!.text(), true);
}

async function forwardToProvider(
	env: Env,
	wire: Wire,
	resolved: ModelInfo,
	neutral: NeutralRequest,
	rawBody: Record<string, unknown>,
	apiKey: string,
	forceStream = false,
): Promise<{ ok: true; res: Response } | { ok: false; res: Response }> {
	// forceStream: the non-stream path re-issues as streaming so the worker
	// can respond to the client immediately (see aggregateProviderStream)
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
		const base = normalizeBase(resolved.provider_base_url);
		headers['Authorization'] = `Bearer ${apiKey}`;
		if (resolved.provider_kind === 'openrouter') {
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
	};
	const res =
		fetcher === (fetch as unknown as Fetcher)
			? await fetch(endpoint, init)
			: await env.MOCK_LLM!.fetch(new Request('https://mock.internal' + endpoint, init));
	return res.ok ? { ok: true, res } : { ok: false, res };
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

function applyUpstreamHeaders(res: Response, bodyText: string, isError = false): Response {
	const h = new Headers({ 'Content-Type': res.headers.get('content-type') ?? 'application/json' });
	return new Response(isError ? bodyText : bodyText, { status: isError ? sanitizeStatus(res.status) : 200, headers: h });
}

/** Don't leak provider auth failures as-is; map to a clean 502. */
function sanitizeStatus(status: number): number {
	return [401, 402, 403, 429].includes(status) ? 502 : status >= 500 ? 502 : status;
}

function extractNonStreamUsage(bodyText: string, wire: Wire): Usage {
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
	} catch {}
	return { input: 0, output: 0 };
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
