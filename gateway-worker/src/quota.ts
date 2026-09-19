/**
 * Atomic billing engine client.
 *
 * reserve  → reserve_request RPC: durable per-user-per-model rate-limit
 *            counters, then the billing-mode decision (plan quota vs wallet
 *            PAYG) with an atomic reservation (quota hold or USD hold).
 * settle   → settle_usage RPC: releases the hold and commits the actual
 *            spend (weighted tokens on plan, USD on wallet), writing the
 *            request_logs row with the cost.
 */
import { postgrestRpc, RpcError } from './db';

export interface Reservation {
	user_id: string;
	/** 'plan' = weighted-token quota, 'wallet' = USD Pay-As-You-Go */
	mode: 'plan' | 'wallet';
	reserved_weighted: number;
	hold_usd: number;
	multiplier: number;
}

/** Rough token estimate: chars/4 for input, explicit max_tokens or 1024 cap for output. */
export function estimateTokens(messages: unknown[], maxTokens?: number): {
	inputEstimate: number;
	outputEstimate: number;
} {
	let chars = 0;
	for (const m of messages) {
		const content = (m as { content?: unknown })?.content;
		if (typeof content === 'string') chars += content.length;
		else if (content != null) chars += JSON.stringify(content).length;
	}
	return {
		inputEstimate: Math.ceil(chars / 4) + 16,
		outputEstimate: Math.min(Math.max(maxTokens ?? 1024, 1), 8192),
	};
}

export type ReserveResult =
	| { ok: true; reservation: Reservation }
	| { ok: false; status: number; code: string; message: string };

/**
 * NOTE: there is intentionally NO module-level "active reservation" slot.
 * A previous single-slot design let concurrent requests on the same
 * isolate clobber each other, so the stranded-reservation safety net
 * settled (or stranded) the WRONG request's reservation. The reservation
 * now lives only in the request's own closure — index.ts settles it via
 * settleAfter(reservation, …) or the local error handler.
 */
export async function reserve(
	userId: string,
	apiKeyId: string,
	modelId: string,
	inputEstimate: number,
	outputEstimate: number,
): Promise<ReserveResult> {
	try {
		const row = await postgrestRpc<Record<string, unknown>>('reserve_request', {
			p_user_id: userId,
			p_api_key_id: apiKeyId,
			p_model_id: modelId,
			p_est_tokens_in: inputEstimate,
			p_est_tokens_out: outputEstimate,
		});
		if (!row) throw new Error('reserve_request returned no row');
		return {
			ok: true,
			reservation: {
				user_id: userId,
				mode: row.mode === 'wallet' ? 'wallet' : 'plan',
				reserved_weighted: Number(row.reserved_weighted ?? 0),
				hold_usd: Number(row.hold_usd ?? 0),
				multiplier: Number(row.multiplier ?? 1),
			},
		};
	} catch (err) {
		if (!(err instanceof RpcError)) throw err;
		const body = err.body;
		if (body.includes('QUOTA_EXCEEDED')) {
			return {
				ok: false,
				status: 429,
				code: 'insufficient_quota',
				message: 'Daily quota exhausted. Resets at 00:00 UTC.',
			};
		}
		if (body.includes('NO_ACTIVE_PLAN')) {
			return {
				ok: false,
				status: 403,
				code: 'no_active_plan',
				message: 'No active subscription or wallet credit. Purchase a plan or top up your wallet.',
			};
		}
		if (body.includes('MODEL_NOT_INCLUDED')) {
			return {
				ok: false,
				status: 403,
				code: 'model_not_in_plan',
				message: 'This model is not in your plan and has no Pay-As-You-Go price.',
			};
		}
		if (body.includes('OFFER_MODEL_RESTRICTED')) {
			return {
				ok: false,
				status: 403,
				code: 'offer_model_restricted',
				message: 'Your free credit only works on its offer models. Subscribe to a plan or top up your wallet to use this model.',
			};
		}
		if (body.includes('INSUFFICIENT_CREDITS')) {
			return {
				ok: false,
				status: 402,
				code: 'insufficient_credits',
				message: 'Wallet balance too low for this request. Top up your wallet to continue.',
			};
		}
		if (body.includes('SPEND_LIMIT_REACHED')) {
			return {
				ok: false,
				status: 402,
				code: 'spend_limit_reached',
				message: 'This API key reached its spending limit.',
			};
		}
		if (body.includes('MODEL_RATE_LIMITED')) {
			const which = body.split(':')[1] ?? '';
			return {
				ok: false,
				status: 429,
				code: 'model_rate_limited',
				message: `Model rate limit exceeded (${which || 'window'}). Slow down and retry.`,
			};
		}
		throw err;
	}
}

export interface UsageBreakdown {
	tokensIn: number;
	tokensOut: number;
	cacheRead: number;
	cacheWrite: number;
}

/** PAYG cost in USD from effective (post-discount) per-1M prices. */
export function costUsd(
	u: UsageBreakdown,
	prices: { in?: number | null; out?: number | null; cacheRead?: number | null; cacheWrite?: number | null },
): number {
	const raw =
		(prices.in ?? 0) * u.tokensIn +
		(prices.out ?? 0) * u.tokensOut +
		(prices.cacheRead ?? 0) * u.cacheRead +
		(prices.cacheWrite ?? 0) * u.cacheWrite;
	// micro-dollar rounding: never rounds in the customer's favor
	return Math.ceil(raw * 1_000_000) / 1_000_000;
}

export async function settle(
	res: Reservation,
	actualWeighted: number,
	actualCostUsd: number,
	logExtra: Record<string, unknown>,
): Promise<void> {
	await postgrestRpc('settle_usage', {
		p_user_id: res.user_id,
		p_mode: res.mode,
		p_hold_usd: res.hold_usd,
		p_reserved_weighted: res.reserved_weighted,
		p_actual_weighted: actualWeighted,
		p_actual_cost_usd: res.mode === 'wallet' ? actualCostUsd : 0,
		p_log: logExtra,
	});
}
