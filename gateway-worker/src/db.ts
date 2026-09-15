/**
 * Minimal PostgREST access from the Worker.
 * Uses service_role for the three locked-down RPCs only
 * (auth_key_lookup / reserve_quota / settle_quota) and one read of
 * provider_keys + models for forwarding decisions.
 */
import type { Env } from './index';

const SUPAVISOR_POOL = true; // transaction-mode pooling keeps connections short

let cachedToken: { token: string; exp: number } | null = null;

async function serviceHeaders(env: Env): Promise<Record<string, string>> {
	return {
		apikey: env.SUPABASE_SERVICE_ROLE_KEY,
		Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
		'Content-Type': 'application/json',
	};
}

export async function postgrestRpc<T>(
	fn: string,
	body: unknown,
	opts?: { retry?: boolean },
): Promise<T | null> {
	// env is threaded through a module-level set by index before first call
	const env = currentEnv();
	const attempts = opts?.retry ? 3 : 1;
	const backoffs = [150, 400];

	let lastErr: unknown;
	for (let i = 0; i < attempts; i++) {
		if (i > 0) await new Promise((r) => setTimeout(r, backoffs[i - 1] ?? 400));
		try {
			const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
				method: 'POST',
				headers: await serviceHeaders(env),
				body: JSON.stringify(body),
				// a wedged pooler connection must never hang a user's turn
				signal: AbortSignal.timeout(15_000),
			});
			if (res.ok) {
				const text = await res.text();
				return text ? (JSON.parse(text) as T) : null;
			}
			const err = new RpcError(res.status, await res.text());
			if (i < attempts - 1 && isRetryable(err)) {
				lastErr = err;
				continue;
			}
			throw err;
		} catch (err) {
			if (err instanceof RpcError) throw err; // classified above; non-retryable stop
			lastErr = err;
			// fetch rejections (TimeoutError from the signal / TypeError network)
			// are blips — retryable only for idempotent read-only callers
			if (i < attempts - 1 && isRetryableThrow(err)) continue;
			throw err;
		}
	}
	throw lastErr;
}

/** PostgREST/HTTP failures that a retry can plausibly fix (pooler blips). */
function isRetryable(err: RpcError): boolean {
	if ([502, 503, 504].includes(err.status)) return true;
	// connection-class SQLSTATEs + PostgREST transport error
	return /"code":"(08\w{3}|57P0\d|53300|PGRST999)/.test(err.body) || err.body.includes('PGRST999');
}

function isRetryableThrow(err: unknown): boolean {
	const name = (err as Error)?.name;
	return name === 'AbortError' || name === 'TimeoutError' || name === 'TypeError';
}

export class RpcError extends Error {
	constructor(
		public status: number,
		public body: string,
	) {
		super(`RPC failed ${status}: ${body}`);
	}
}

// ---- tiny per-isolate env holder (Workers isolate per colo) ----
let envRef: Env | null = null;
export function setEnv(env: Env) {
	envRef = env;
}
function currentEnv(): Env {
	if (!envRef) throw new Error('setEnv not called');
	return envRef;
}

void SUPAVISOR_POOL;
void cachedToken;
