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
import { estimateTokens, reserve, settle, costUsd, type Reservation, type UsageBreakdown } from './quota';
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
  type ProviderKeyRow,
} from './keys';
import type { Wire } from './stream';
import { startFailoverStream, DECISION_GRACE_MS, type RouteRow, type FailoverDeps, type FailoverOutcome } from './failover';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  NEXOR_ENCRYPTION_KEY: string;
  MOCK_LLM?: Fetcher;
  /** tunable header-wait deadlines for the failover stream (ms) */
  GATEWAY_HEADER_WAIT_FIRST_MS?: string;
  GATEWAY_HEADER_WAIT_LATER_MS?: string;
  /** ms to wait for a fast pre-body HTTP decision before heartbeat-streaming */
  GATEWAY_DECISION_GRACE_MS?: string;
}

/** Row shape of the resolve_model_v2 RPC. */
interface ResolvedModel {
  model_id: string;
  provider_id: string;
  provider_kind: string; // custom | openrouter
  provider_base_url: string;
  /** id actually sent upstream — custom models route via their parent */
  upstream_id: string;
  /** models.id of the REAL model behind a custom alias (null for normal models) */
  parent_model_id: string | null;
  usage_multiplier: string;
  context_window: number | null;
  enabled: boolean;
  system_prompt: string | null; // custom models only
  payg_enabled: boolean;
  price_in: string | null;
  price_out: string | null;
  price_cache_read: string | null;
  price_cache_write: string | null;
  discount_percent: string | null;
  display_name: string;
  vendor_slug: string | null;
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
        headers: CORS_HEADERS,
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

/**
 * Make pre-commit rejections visible in request_logs. Reuses settle_usage's
 * log branch with zero amounts — the daily_usage update becomes a no-op and
 * exactly one audit row lands (user_id is NOT NULL, so this is only callable
 * after auth succeeded). Fire-and-forget: a dead DB can't fail the response
 * twice.
 */
function logRejection(ctx: ExecutionContext, userId: string, startedAt: number, extra: Record<string, unknown>): void {
  ctx.waitUntil(postgrestRpc('settle_usage', {
    p_user_id: userId,
    p_mode: 'plan',
    p_hold_usd: 0,
    p_reserved_weighted: 0,
    p_actual_weighted: 0,
    p_actual_cost_usd: 0,
    p_log: {
      tokens_in: 0,
      tokens_out: 0,
      cache_read_tokens: 0,
      latency_ms: Date.now() - startedAt,
      ...extra,
    },
  }).catch((e) => console.error('early log failed', e)));
}

// ---------- chat pipeline ----------
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

/** Simple in-memory token bucket for rate limiting (1 min window). */
const rateBuckets = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(userId: string, limitPerMin: number): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);
  const windowMs = 60_000;
  if (!bucket || bucket.resetTime <= now) {
    rateBuckets.set(userId, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: Math.max(0, limitPerMin - 1), resetIn: windowMs };
  }
  if (bucket.count >= limitPerMin) {
    return { allowed: false, remaining: 0, resetIn: bucket.resetTime - now };
  }
  bucket.count++;
  return { allowed: true, remaining: limitPerMin - bucket.count, resetIn: bucket.resetTime - now };
}

async function handleChat(
  request: Request,
  clientWire: Wire,
  ctx: ExecutionContext,
  geminiModel?: string,
  geminiWantsStream?: boolean,
): Promise<Response> {
  const startedAt = Date.now();
  const dependency503 = () =>
    json({ error: { type: 'gateway_dependency_error', message: 'Gateway could not reach its database, retry shortly' } }, 503);

  // DoS protection: reject oversized bodies BEFORE parsing JSON.
  // Auth must succeed before we allocate/parse the body — an unauthenticated
  // request to a large body must never trigger parsing.
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return json({ error: { type: 'payload_too_large', message: 'Request body too large' } }, 413);
  }

  // Authenticate FIRST (before body allocation)
  const authRaw = await authenticate(request).catch((e) => {
    console.error('auth rpc failed', e);
    return null;
  });
  if (authRaw === null) return dependency503();
  const auth = authRaw;
  if (!auth.ok) return json({ error: { type: auth.code, message: auth.message } }, auth.status);

  // Rate limit enforcement (post-auth, pre-body-parse)
  const rl = checkRateLimit(auth.ctx.user_id, auth.ctx.rate_limit_per_min);
  if (!rl.allowed) {
    logRejection(ctx, auth.ctx.user_id, startedAt, { api_key_id: auth.ctx.api_key_id, status: 429, error_code: 'rate_limited', reset_in_ms: rl.resetIn });
    return json({ error: { type: 'rate_limited', message: 'Rate limit exceeded' } }, 429);
  }

  // NOW safe to read the body
  const rawBody = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!rawBody) return json({ error: { type: 'bad_request', message: 'Invalid JSON' } }, 400);

  // model resolution (retryable on DB blips). Custom (aliased) models carry
  // their own public id in upstream_model_id and resolve to the parent's
  // provider + upstream id + an optional system prompt.
  const requestedModel = clientWire === 'gemini' ? (geminiModel ?? '') : String(rawBody.model ?? '');
  const resolvedRaw = await postgrestRpc<ResolvedModel[]>('resolve_model_v2', { p_upstream_model: requestedModel }, { retry: true })
    .then((rows) => rows ?? [])
    .catch((e) => {
      console.error('resolve_model_v2 rpc failed', e);
      return null;
    });
  if (resolvedRaw === null) {
    logRejection(ctx, auth.ctx.user_id, startedAt, { api_key_id: auth.ctx.api_key_id, status: 503, error_code: 'gateway_dependency_error' });
    return dependency503();
  }
  const resolved = resolvedRaw[0];
  if (!resolved) {
    logRejection(ctx, auth.ctx.user_id, startedAt, { api_key_id: auth.ctx.api_key_id, status: 404, error_code: 'model_not_found', upstream_model: requestedModel });
    return json({ error: { type: 'model_not_found', message: `Unknown model ${requestedModel}` } }, 404);
  }
  if (!resolved.enabled) {
    logRejection(ctx, auth.ctx.user_id, startedAt, { api_key_id: auth.ctx.api_key_id, status: 403, error_code: 'model_disabled', model_id: resolved.model_id, upstream_model: requestedModel });
    return json({ error: { type: 'model_disabled', message: 'Model not available' } }, 403);
  }
  // ×0 is a legal value ("free on plans") — only null/NaN falls back to ×1
  const n = Number(resolved.usage_multiplier);
  const multiplier = Number.isFinite(n) ? n : 1;
  const paygPrices = {
    in: resolved.price_in != null ? Number(resolved.price_in) : null,
    out: resolved.price_out != null ? Number(resolved.price_out) : null,
    cacheRead: resolved.price_cache_read != null ? Number(resolved.price_cache_read) : null,
    cacheWrite: resolved.price_cache_write != null ? Number(resolved.price_cache_write) : null,
  };

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

  // custom-model rewrite: route to the parent's upstream id and prepend the
  // admin-defined system prompt (client prompt is kept, custom prompt first)
  neutral.model = resolved.upstream_id;
  if (resolved.system_prompt) {
    neutral.system = resolved.system_prompt + (neutral.system ? '\n' + neutral.system : '');
  }
  const upstreamModel = resolved.upstream_id;

  // plan/model gating — a custom ALIAS model is NOT gated by the plan list
  // here: entitlement (plan membership if any, otherwise PAYG from the
  // wallet) is decided atomically by reserve_request, so a wallet-only
  // alias isn't rejected with model_not_in_plan before the billing path.
  // Normal (non-alias) models keep the plan gate.
  const allowed = auth.ctx.allowed_models ?? [];
  const isAlias = resolved.parent_model_id != null;
  const gateId = resolved.parent_model_id ?? resolved.model_id;
  if (!isAlias && allowed.length && !allowed.includes(resolved.model_id)) {
    logRejection(ctx, auth.ctx.user_id, startedAt, { api_key_id: auth.ctx.api_key_id, status: 403, error_code: 'model_not_in_plan', model_id: resolved.model_id, upstream_model: upstreamModel });
    return json({ error: { type: 'model_not_in_plan', message: 'Model not included in your plan' } }, 403);
  }
  const keyAllowed = auth.ctx.api_allowed_models ?? [];
  if (keyAllowed.length && !keyAllowed.includes(gateId) && !keyAllowed.includes(resolved.model_id)) {
    logRejection(ctx, auth.ctx.user_id, startedAt, { api_key_id: auth.ctx.api_key_id, status: 403, error_code: 'model_not_allowed_for_key', model_id: resolved.model_id, upstream_model: upstreamModel });
    return json({ error: { type: 'model_not_allowed_for_key', message: 'Key may not call this model' } }, 403);
  }

  // atomic reservation BEFORE touching the provider — run it in parallel
  // with the key material it doesn't depend on (dek import)
  const maxTok =
    clientWire === 'gemini'
      ? ((rawBody.generationConfig as { maxOutputTokens?: number })?.maxOutputTokens ?? undefined)
      : typeof rawBody.max_tokens === 'number'
        ? rawBody.max_tokens
        : undefined;
  const est = estimateTokens(neutral.messages, maxTok);
  let reservation;
  let dek: CryptoKey;
  try {
    [reservation, dek] = await Promise.all([
      reserve(
        auth.ctx.user_id,
        auth.ctx.api_key_id,
        resolved.model_id,
        est.inputEstimate,
        est.outputEstimate,
      ),
      importDek(envNow().NEXOR_ENCRYPTION_KEY),
    ]);
  } catch (e) {
    // reserve re-throws anything that isn't a billing verdict → the DB is
    // unhealthy. Fail visibly, and never blindly retry the call:
    // reserve_request's SQL is a non-idempotent hold.
    console.error('reserve failed', e);
    logRejection(ctx, auth.ctx.user_id, startedAt, { api_key_id: auth.ctx.api_key_id, status: 503, error_code: 'gateway_dependency_error', model_id: resolved.model_id, upstream_model: upstreamModel });
    return dependency503();
  }
  if (!reservation.ok) {
    logRejection(ctx, auth.ctx.user_id, startedAt, { api_key_id: auth.ctx.api_key_id, status: reservation.status, error_code: reservation.code, model_id: resolved.model_id, upstream_model: upstreamModel });
    return json({ error: { type: reservation.code, message: reservation.message } }, reservation.status);
  }
  const resv = reservation.reservation;

  // ---- committed: the durable stream owns everything after here.
  // The client Response exists from byte 0 (no more Cloudflare 524 during
  // the provider header wait), keep-alive frames cover the stall windows,
  // and a key that fails BEFORE any content flows is rotated for the next
  // live key of the SAME provider — provider choice stays the admin's.
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
  };

  const isStream = clientWire === 'gemini' ? !!geminiWantsStream : neutral.stream;
  const mode = isStream ? 'sse' : clientWire === 'gemini' ? 'buffer' : 'aggregate';
  const { body, outcome, decision, begin } = startFailoverStream({
    clientWire,
    mode,
    route,
    deps,
    headerWaitFirstMs: Number(envNow().GATEWAY_HEADER_WAIT_FIRST_MS) || undefined,
    headerWaitLaterMs: Number(envNow().GATEWAY_HEADER_WAIT_LATER_MS) || undefined,
  });

  // Settle is registered BEFORE the decision wait — every path (early HTTP
  // error or committed stream) must release the reservation exactly once.
  ctx.waitUntil(
    outcome
      .then((o) => {
        const usage = usageBreakdownFor(o, est, neutral.stream);
        const weighted = resv.mode === 'plan'
          ? Math.ceil((usage.tokensIn + usage.tokensOut) * multiplier)
          : 0;
        const cost = resv.mode === 'wallet' ? costUsd(usage, paygPrices) : 0;
        return settleAfter(resv, weighted, cost, {
          api_key_id: auth.ctx.api_key_id,
          model_id: resolved.model_id,
          // log the id the CLIENT asked for — custom models show their new name
          upstream_model: requestedModel,
          ...logMeta(o, startedAt, usage),
        });
      })
      .catch((e) => console.error('settle failed', e)),
  );

  // Decision gate: if the provider fails fast (auth/5xx/429 on every key)
  // or answers with a client-shaped 4xx, return a REAL HTTP status so SDKs
  // and agent loops retry per Retry-After. Only a provider still silent
  // after the grace window gets the durable heartbeat stream.
  const graceMs = Number(envNow().GATEWAY_DECISION_GRACE_MS) || DECISION_GRACE_MS;
  const decided = await Promise.race([
    decision,
    new Promise<null>((r) => setTimeout(() => r(null), graceMs)),
  ]);
  if (decided && decided.status >= 400) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      'Access-Control-Expose-Headers': 'Retry-After',
    };
    if (decided.retryAfterSeconds) headers['Retry-After'] = String(decided.retryAfterSeconds);
    return new Response(decided.errorText, { status: decided.status, headers });
  }
  begin();

  return new Response(body, {
    status: 200,
    headers: mode === 'sse' ? sseHeaders() : { 'Content-Type': 'application/json' },
  });
}

/**
 * Settlement policy (anti-quota-burn), unchanged in spirit:
 *  1. total failure before any content, or client-gone with 0 bytes → 0
 *  2. provider reported usage → actual tokens (+ cache split)
 *  3. otherwise → provable volume only: input estimate + streamed bytes / 4.
 *     The speculative output estimate is NEVER billed.
 * The same breakdown feeds the request log, the weighted quota and the
 * PAYG USD cost, so tokens and money can never disagree.
 */
function usageBreakdownFor(
  o: FailoverOutcome,
  est: { inputEstimate: number; outputEstimate: number },
  stream: boolean,
): UsageBreakdown {
  const zero: UsageBreakdown = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 };
  if (o.finalError && o.streamedBytes === 0) return zero;
  const usage = o.usage;
  if (usage && (usage.input > 0 || usage.output > 0)) {
    return {
      tokensIn: usage.input,
      tokensOut: usage.output,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
    };
  }
  if (!stream && o.finalError) return zero;
  return {
    tokensIn: est.inputEstimate,
    tokensOut: Math.ceil(o.streamedBytes / 4),
    cacheRead: 0,
    cacheWrite: 0,
  };
}

/** request_logs fields — same status/error_code vocabulary as before failover */
function logMeta(
  o: FailoverOutcome,
  startedAt: number,
  usage: UsageBreakdown,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    latency_ms: Date.now() - startedAt,
    ttft_ms: o.ttftMs ?? null,
    tokens_in: usage.tokensIn,
    tokens_out: usage.tokensOut,
    cache_read_tokens: usage.cacheRead,
    cache_write_tokens: usage.cacheWrite,
  };
  if (o.finalError) {
    // finalError.status is already the real HTTP status the client got
    // (decision gate: 429/503/4xx; committed stream: neutral 502/504)
    return {
      status: o.finalError.status,
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
          : !o.usage
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

  const enabled = await postgrestQuery<Array<{
    id: string;
    upstream_model_id: string;
    parent_model_id: string | null;
    context_window: number | null;
    display_name: string;
    vendor_slug: string | null;
    payg_enabled: boolean;
    input_price_per_m: string | null;
    output_price_per_m: string | null;
    input_modalities: string[] | null;
    output_modalities: string[] | null;
    supports_reasoning: boolean;
  }>>(
    'models?enabled_for_users=eq.true'
    + '&select=id,upstream_model_id,parent_model_id,context_window,display_name,vendor_slug,payg_enabled,input_price_per_m,output_price_per_m,input_modalities,output_modalities,supports_reasoning',
  );
  // plan gating: allowed_models is the plan's model list; empty = no
  // restriction, so every enabled model is listed. Custom aliases list
  // under their public name when their parent is in the plan OR when they
  // are wallet-billable (PAYG) — the latter are sold from the wallet, not
  // a plan, and must still be discoverable by clients.
  // Key scoping (api_allowed_models) applies here too: a key restricted
  // to a model subset must only see that subset — same rule the chat path
  // enforces (parent-or-alias accepted).
  const allowed = auth.ctx.allowed_models ?? [];
  const keyAllowed = auth.ctx.api_allowed_models ?? [];
  const data = (enabled ?? [])
    .filter((m) => {
      if (allowed.length && !allowed.includes(m.id) && !(m.parent_model_id && (allowed.includes(m.parent_model_id) || m.payg_enabled))) {
        return false;
      }
      if (keyAllowed.length && !keyAllowed.includes(m.id) && !(m.parent_model_id && keyAllowed.includes(m.parent_model_id))) {
        return false;
      }
      return true;
    })
    // one entry per public model id: the same upstream id can exist on
    // several provider rows; agents expect a catalog without duplicates
    .filter((m, i, arr) => arr.findIndex((x) => x.upstream_model_id === m.upstream_model_id) === i)
    .map((m) => ({
      id: m.upstream_model_id,
      object: 'model',
      owned_by: m.vendor_slug ?? m.upstream_model_id.split('/')[0] ?? 'nexor',
      context_length: m.context_window ?? undefined,
      display_name: m.display_name,
      // PAYG list price (before active discounts) for agent-side cost display
      pricing: m.payg_enabled
        ? {
            prompt: m.input_price_per_m != null ? `$${Number(m.input_price_per_m).toFixed(2)}/M` : undefined,
            completion: m.output_price_per_m != null ? `$${Number(m.output_price_per_m).toFixed(2)}/M` : undefined,
          }
        : undefined,
      capabilities: {
        input_modalities: m.input_modalities ?? ['text'],
        output_modalities: m.output_modalities ?? ['text'],
        reasoning: m.supports_reasoning,
      },
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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, x-goog-api-key, content-type, anthropic-version',
  'Access-Control-Max-Age': '86400',
};

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function settleAfter(
  resv: Reservation,
  weightedBill: number,
  costBill: number,
  logExtra: Record<string, unknown>,
): Promise<void> {
  try {
    await settle(resv, weightedBill, costBill, {
      ...logExtra,
      // callers always provide tokens_in/tokens_out/cache_read_tokens in
      // logExtra — default to 0 only if omitted
      tokens_in: logExtra.tokens_in ?? 0,
      tokens_out: logExtra.tokens_out ?? 0,
      cache_read_tokens: logExtra.cache_read_tokens ?? 0,
      cache_write_tokens: logExtra.cache_write_tokens ?? 0,
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
