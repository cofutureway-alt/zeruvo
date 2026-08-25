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

export async function postgrestRpc<T>(fn: string, body: unknown): Promise<T | null> {
	// env is threaded through a module-level set by index before first call
	const env = currentEnv();
	const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
		method: 'POST',
		headers: await serviceHeaders(env),
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new RpcError(res.status, text);
	}
	const text = await res.text();
	return text ? (JSON.parse(text) as T) : null;
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
