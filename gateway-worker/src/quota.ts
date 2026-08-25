/**
 * Atomic quota reservation against the Postgres engine (reserve_quota RPC).
 * Estimate = weighted input tokens + max_tokens × multiplier headroom;
 * settled to actual usage after the provider responds.
 */
import { postgrestRpc, RpcError } from './db';

export interface Reservation {
	user_id: string;
	reserved_amount: number;
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

export async function reserve(
	userId: string,
	multiplier: number,
	inputEstimate: number,
	outputEstimate: number,
): Promise<ReserveResult> {
	const estimate = Math.ceil((inputEstimate + outputEstimate) * multiplier);
	try {
		await postgrestRpc('reserve_quota', {
			p_user_id: userId,
			p_estimate_weighted: estimate,
		});
		return { ok: true, reservation: { user_id: userId, reserved_amount: estimate, multiplier } };
	} catch (err) {
		if (err instanceof RpcError && err.body.includes('QUOTA_EXCEEDED')) {
			return {
				ok: false,
				status: 429,
				code: 'insufficient_quota',
				message: 'Daily quota exhausted. Resets at 00:00 UTC.',
			};
		}
		if (err instanceof RpcError && err.body.includes('NO_ACTIVE_PLAN')) {
			return { ok: false, status: 403, code: 'no_active_plan', message: 'No active plan' };
		}
		throw err;
	}
}

export async function settle(res: Reservation, actualRaw: number, logExtra: Record<string, unknown>) {
	const actualWeighted = Math.ceil(actualRaw * res.multiplier);
	await postgrestRpc('settle_quota', {
		p_user_id: res.user_id,
		p_reserved_amount: res.reserved_amount,
		p_actual_weighted: actualWeighted,
		p_log: logExtra,
	});
}
