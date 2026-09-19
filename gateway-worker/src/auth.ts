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
	wallet_balance_usd: string | null; // numeric comes back as string over JSON
	billing_preference: 'plan_first' | 'wallet_first' | null;
	spend_limit_usd: string | null;
	total_spent_usd: string | null;
	/** true = GitHub user whose account is younger than the configured minimum → locked */
	is_pending: boolean;
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
	// read-only lookup → safe to retry through a transient pooler blip
	const rows = await postgrestRpc<AuthContext[]>('auth_key_lookup', { p_key_hash: hash }, { retry: true });
	const ctx = rows?.[0];

	if (!ctx) {
		return { ok: false, status: 401, code: 'invalid_api_key', message: 'Unknown or revoked key' };
	}
	// A key is usable with EITHER an active subscription (plan quota) OR a
	// funded wallet (Pay-As-You-Go). The definitive mode decision — and the
	// rejection when neither is possible — happens inside reserve_request.
	const hasPlan = ctx.subscription_status === 'active'
		&& (!ctx.plan_expires_at || new Date(ctx.plan_expires_at).getTime() > Date.now());
	const hasCredit = Number(ctx.wallet_balance_usd ?? 0) > 0;
	if (!hasPlan && !hasCredit) {
		return {
			ok: false,
			status: 403,
			code: 'no_active_plan',
			message: 'No active subscription or wallet credit. Purchase a plan or top up your wallet.',
		};
	}

	// H4 fix: reject pending GitHub users at the gateway level.
	// The client-side pending gate is bypassable with raw curl; the server
	// must enforce it here where quota/billing lives.
	if (ctx.is_pending) {
		return {
			ok: false,
			status: 403,
			code: 'github_pending',
			message: 'GitHub account too new to access the API. Please wait until your account meets the age requirement.',
		};
	}

	return { ok: true, ctx };
}
