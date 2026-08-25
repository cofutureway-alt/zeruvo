/**
 * Key authentication — resolves sk-nexor-* keys via the auth_key_lookup RPC.
 * Keys are stored as SHA-256 hex hashes only; lookup is a single indexed
 * equality (constant-time in practice; timing oracle on hash preimage is moot).
 */
import { postgrestRpc } from './db';

export interface AuthContext {
	api_key_id: string;
	user_id: string;
	user_status: string;
	subscription_status: string | null;
	plan_expires_at: string | null;
	plan_daily_weighted: string | null; // bigint comes back as string over JSON
	allowed_models: string[] | null; // plan model ids, null if plan has none configured
	api_allowed_models: string[] | null;
	rate_limit_per_min: number;
}

export const KEY_PREFIX = 'sk-nexor-';

export async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type AuthResult =
	| { ok: true; ctx: AuthContext }
	| { ok: false; status: number; code: string; message: string };

/** Validate the presented key and the caller's subscription state. */
export async function authenticate(request: Request): Promise<AuthResult> {
	const header =
		request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
		request.headers.get('x-api-key') ??
		request.headers.get('x-goog-api-key') ??
		'';

	if (!header.startsWith(KEY_PREFIX)) {
		return {
			ok: false,
			status: 401,
			code: 'invalid_api_key',
			message: `Missing ${KEY_PREFIX} key`,
		};
	}

	const hash = await sha256Hex(header);
	const rows = await postgrestRpc<AuthContext[]>('auth_key_lookup', { p_key_hash: hash });
	const ctx = rows?.[0];

	if (!ctx) {
		return { ok: false, status: 401, code: 'invalid_api_key', message: 'Unknown or revoked key' };
	}
	if (!ctx.subscription_status || ctx.subscription_status !== 'active') {
		return {
			ok: false,
			status: 403,
			code: 'subscription_inactive',
			message: 'No active subscription. Purchase a plan to use the API.',
		};
	}
	if (ctx.plan_expires_at && new Date(ctx.plan_expires_at).getTime() <= Date.now()) {
		return {
			ok: false,
			status: 403,
			code: 'plan_expired',
			message: 'Plan expired. Renew to continue.',
		};
	}

	return { ok: true, ctx };
}
