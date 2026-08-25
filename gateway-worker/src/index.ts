/**
 * Nexor AI Gateway — Cloudflare Worker
 * Routes (client wire preserved end-to-end):
 *   POST /v1/chat/completions          → OpenAI wire
 *   POST /v1/messages                  → Anthropic wire
 *   POST /v1beta/models/{m}:generateContent[?alt=sse]  → Gemini wire
 *   GET  /v1/models                    → enabled models list
 *   GET  /health
 */
import { setEnv } from './db';
import { authenticate } from './auth';
import { estimateTokens, reserve, settle } from './quota';
import {
	fromOpenAI,
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
import { pipeProviderStream, errorFrame, type Wire, type Usage } from './stream';

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
let _execCtx: ExecutionContext | null = null;
function envNow(): Env {
	if (!_env) throw new Error('env not set');
	return _env;
}

/** Keep async settlement alive after the response is returned. */
export function keepAlive(promise: Promise<unknown>): void {
	if (_execCtx) _execCtx.waitUntil(promise);
	else promise.catch((e) => console.error('post-response task failed', e));
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		_env = env;
		_execCtx = ctx;
		setEnvDb(env);
		const url = new URL(request.url);

		if (url.pathname === '/health') {
			return Response.json({ ok: true, service: 'nexor-gateway' });
		}

		try {
			if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
				return await handleChat(request, 'openai');
			}
			if (url.pathname === '/v1/messages' && request.method === 'POST') {
				return await handleChat(request, 'anthropic');
			}
			const geminiMatch = url.pathname.match(/^\/v1beta\/models\/([^:]+):(generateContent|streamGenerateContent)$/);
			if (geminiMatch && request.method === 'POST') {
				return await handleChat(request, 'gemini', decodeURIComponent(geminiMatch[1]));
			}
			if (url.pathname === '/v1/models' && request.method === 'GET') {
				return await listModels();
			}

			return json({ error: { type: 'not_found', message: `No route for ${url.pathname}` } }, 404);
		} catch (err) {
			console.error('gateway error', err);
			return json(
				{ error: { type: 'gateway_error', message: 'Internal gateway error' } },
				500,
			);
		}
	},
};

void postgrestRpc;

// ---------- chat pipeline ----------
async function handleChat(request: Request, clientWire: Wire, geminiModel?: string): Promise<Response> {
	const auth = await authenticate(request);
	if (!auth.ok) return json({ error: { type: auth.code, message: auth.message } }, auth.status);

	const rawBody = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!rawBody) return json({ error: { type: 'bad_request', message: 'Invalid JSON' } }, 400);

	const neutral = fromOpenAI(rawBody);
	const upstreamModel = clientWire === 'gemini' ? (geminiModel ?? neutral.model) : neutral.model;

	// resolve model → provider + multiplier
	const resolved = (
		await postgrestRpc<ModelInfo[]>('resolve_model', { p_upstream_model: upstreamModel })
	)?.[0];
	if (!resolved) {
		return json({ error: { type: 'model_not_found', message: `Unknown model ${upstreamModel}` } }, 404);
	}
	if (!resolved.enabled) {
		return json({ error: { type: 'model_disabled', message: 'Model not available' } }, 403);
	}
	const multiplier = Number(resolved.usage_multiplier) || 1;

	// plan/model gating
	const allowed = auth.ctx.allowed_models ?? [];
	if (allowed.length && !allowed.includes(resolved.model_id)) {
		return json({ error: { type: 'model_not_in_plan', message: 'Model not included in your plan' } }, 403);
	}
	const keyAllowed = auth.ctx.api_allowed_models ?? [];
	if (keyAllowed.length && !keyAllowed.includes(resolved.model_id)) {
		return json({ error: { type: 'model_not_allowed_for_key', message: 'Key may not call this model' } }, 403);
	}

	// atomic reservation BEFORE touching the provider
	const maxTok =
		clientWire === 'gemini'
			? ((rawBody.generationConfig as { maxOutputTokens?: number })?.maxOutputTokens ?? undefined)
			: typeof rawBody.max_tokens === 'number'
				? rawBody.max_tokens
				: undefined;
	const est = estimateTokens(neutral.messages, maxTok);
	const reservation = await reserve(auth.ctx.user_id, multiplier, est.inputEstimate, est.outputEstimate);
	if (!reservation.ok) {
		return json({ error: { type: reservation.code, message: reservation.message } }, reservation.status);
	}

	// provider keys + weighted selection with one retry on dead/rotatable errors
	const dek = await importDek(envNow().NEXOR_ENCRYPTION_KEY);
	let lastError: Response | null = null;

	for (let attempt = 0; attempt < 2; attempt++) {
		const keys = await loadProviderKeys(resolved.provider_id);
		const chosen = pickWeighted(keys);
		if (!chosen) {
			return json({ error: { type: 'no_provider_keys', message: 'Provider has no live keys' } }, 503);
		}
		const apiKey = await decryptProviderKey(dek, chosen.encrypted_key);

		const upstreamRes = await forwardToProvider(envNow(), clientWire, resolved, neutral, rawBody, apiKey);
		if (upstreamRes.ok) {
			const started = Date.now();
			const isStream = neutral.stream || clientWire === 'gemini';
			if (!isStream) {
				const bodyText = await upstreamRes.res.text();
				const usage = extractNonStreamUsage(bodyText, clientWire);
				keepAlive(
					settleAfter(reservation, usage, {
						api_key_id: auth.ctx.api_key_id,
						model_id: resolved.model_id,
						upstream_model: upstreamModel,
						status: upstreamRes.res.status,
						latency_ms: Date.now() - started,
					}),
				);
				return applyUpstreamHeaders(upstreamRes.res, bodyText);
			}
			const { body, outcome } = pipeProviderStream(upstreamRes.res, clientWire);
			keepAlive(
				outcome.then((o) => {
					const usage = o.usage ?? { input: est.inputEstimate, output: est.outputEstimate };
					return settleAfter(reservation, usage.input + usage.output, {
						api_key_id: auth.ctx.api_key_id,
						model_id: resolved.model_id,
						upstream_model: upstreamModel,
						status: o.sniffedError?.status ?? 200,
						error_code: o.sniffedError ? 'upstream_stream_error' : o.timedOut ? 'gateway_timeout' : null,
						latency_ms: Date.now() - started,
					});
				}),
			);
			return new Response(body, {
				status: 200,
				headers: sseHeaders(),
			});
		}

		lastError = upstreamRes.res;
		if ([401, 402, 403].includes(upstreamRes.res.status)) {
			await markDead(chosen.id, 30); // dead 30 min
			continue; // retry with another key
		}
		if (upstreamRes.res.status === 429) {
			continue; // rotate to another key once
		}
		break; // other errors: surface to client
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
): Promise<{ ok: true; res: Response } | { ok: false; res: Response }> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	let payload: Record<string, unknown>;
	let endpoint: string;
	let fetcher: Fetcher = fetch as unknown as Fetcher; // default: global fetch
	let path = '';

	if (wire === 'anthropic') {
		headers['x-api-key'] = apiKey;
		headers['anthropic-version'] = rawBody['anthropic-version'] as string ?? '2023-06-01';
		payload = toAnthropic(neutral);
		endpoint = 'https://api.anthropic.com/v1/messages';
	} else if (wire === 'gemini') {
		endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${neutral.model}:generateContent`;
		payload = toGemini(neutral);
		if (neutral.stream) {
			endpoint += '?alt=sse';
		}
		endpoint += (endpoint.includes('?') ? '&' : '?') + `key=${apiKey}`;
	} else {
		// OpenAI-family: custom base URL, OpenRouter, or the internal mock binding
		const base = normalizeBase(resolved.provider_base_url);
		headers['Authorization'] = `Bearer ${apiKey}`;
		if (resolved.provider_kind === 'openrouter') {
			headers['HTTP-Referer'] = 'https://nexor.ai';
			headers['X-Title'] = 'Nexor AI';
		}
		payload = toOpenAI(neutral);
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
async function listModels(): Promise<Response> {
	const rows = await postgrestQuery<Array<{ upstream_model_id: string; context_window: number | null; display_name: string }>>(
		'models?enabled_for_users=eq.true&select=upstream_model_id,context_window,display_name',
	);
	const data = (rows ?? []).map((m) => ({
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
	reservation: Awaited<ReturnType<typeof reserve>> & { ok: true },
	usage: Usage | number,
	logExtra: Record<string, unknown>,
): Promise<void> {
	try {
		const raw = typeof usage === 'number' ? usage : usage.input + usage.output - (usage.cacheRead ?? 0);
		await settle(reservation.reservation, Math.max(raw, 1), {
			...logExtra,
			tokens_in: typeof usage === 'object' ? usage.input : 0,
			tokens_out: typeof usage === 'object' ? usage.output : 0,
			cache_read_tokens: typeof usage === 'object' ? (usage.cacheRead ?? 0) : 0,
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
