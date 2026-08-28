// deno-lint-ignore-file no-explicit-any
/**
 * kashier-webhook — server-to-server payment notification.
 * Signature verified per official Kashier scheme: x-kashier-signature header,
 * HMAC-SHA256 of the RFC3986 query string built from data.signatureKeys
 * (in the order given) using the merchant API key.
 * Success = event==='pay' && data.status.toUpperCase()==='SUCCESS'.
 * Idempotent via payments.gateway_ref UNIQUE + paid short-circuit.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const enc = new TextEncoder();

function rfc3986(v: string): string {
	return encodeURIComponent(v).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

async function hmacHex(key: string, payload: string): Promise<string> {
	const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', k, enc.encode(payload));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time hex string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

function b64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

async function decrypt(stored: string, dekB64: string): Promise<string> {
	const bytes = b64ToBytes(stored);
	const nonce = bytes.slice(0, 12), ct = bytes.slice(12);
	const raw = b64ToBytes(dekB64);
	const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
	return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
}

Deno.serve(async (req) => {
// CORS: the SPA calls these functions directly from the browser
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kashier-signature',
};

if (req.method === 'OPTIONS') {
	return new Response('ok', { headers: CORS_HEADERS });
}

	if (req.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405, headers: CORS_HEADERS })

	const raw = await req.text();
	let body: any;
	try { body = JSON.parse(raw); } catch { return Response.json({ error: 'invalid json' }, { status: 400, headers: CORS_HEADERS }) }

	const signature = req.headers.get('x-kashier-signature') ?? '';
	if (!body?.data?.signatureKeys?.length || !signature) {
		return Response.json({ error: 'missing signature' }, { status: 400, headers: CORS_HEADERS })
	}

	const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
	const { data: gw } = await admin.from('payment_gateways')
		.select('encrypted_api_key').eq('gateway', 'kashier').single();
	if (!gw?.encrypted_api_key) return Response.json({ error: 'gateway not configured' }, { status: 503, headers: CORS_HEADERS })

	let apiKey: string;
	try {
		apiKey = await decrypt(gw.encrypted_api_key, Deno.env.get('NEXOR_ENCRYPTION_KEY')!);
	} catch {
		return Response.json({ error: 'credential decrypt failed' }, { status: 500, headers: CORS_HEADERS })
	}

	// verify: query string from signatureKeys IN GIVEN ORDER, RFC3986-encoded
	const pairs = body.data.signatureKeys.map((key: string) => {
		const v = body.data[key];
		return `${key}=${rfc3986(v == null ? '' : String(v))}`;
	});
	const expected = await hmacHex(apiKey, pairs.join('&'));
	if (!timingSafeEqual(expected, signature.toLowerCase())) {
		console.warn('kashier webhook: bad signature');
		return Response.json({ error: 'invalid signature' }, { status: 401, headers: CORS_HEADERS })
	}

	const orderId: string = body.data.merchantOrderId;
	const { data: payment } = await admin.from('payments')
		.select('id,user_id,status,amount_egp,meta').eq('gateway_ref', orderId).single();
	if (!payment) return Response.json({ error: 'unknown order' }, { status: 404, headers: CORS_HEADERS })

	const success = body.event === 'pay' && String(body.data.status).toUpperCase() === 'SUCCESS';
	if (!success) {
		// only downgrade PENDING orders — never overwrite a PAID one
		// (a forged/late failure event must not un-grant a real payment)
		if (payment.status === 'pending') {
			await admin.from('payments').update({ status: 'failed' }).eq('id', payment.id);
		}
		return Response.json({ ok: true, handled: 'failed-ignored' }, { headers: CORS_HEADERS })
	}
	if (payment.status === 'paid') return Response.json({ ok: true, handled: 'already-paid' }, { headers: CORS_HEADERS })

	// amount validation: Kashier sends piasters; compare against stored EGP amount
	const paidAmount = Number(body.data.amount ?? 0) / 100;
	const expectedAmount = Number(payment.amount_egp);
	if (!(Math.abs(paidAmount - expectedAmount) < 0.01)) {
		console.warn(`kashier webhook: amount mismatch paid=${paidAmount} expected=${expectedAmount}`);
		await admin.from('payments').update({
			status: 'failed',
			meta: { ...(payment.meta as object), fraud_flag: 'amount_mismatch', paid_amount: paidAmount },
		}).eq('id', payment.id);
		return Response.json({ error: 'amount mismatch' }, { status: 400, headers: CORS_HEADERS })
	}

	const planId = (payment.meta as any)?.plan_id;
	if (!planId) return Response.json({ error: 'payment missing plan meta' }, { status: 500, headers: CORS_HEADERS })
	const { data: plan } = await admin.from('plans')
		.select('duration_unit,duration_count').eq('id', planId).single();
	if (!plan) return Response.json({ error: 'plan missing' }, { status: 500, headers: CORS_HEADERS })

	const paidMeta = payment.meta as any;
	const now = new Date();
	// Renewals extend from the current subscription's expiry (never earlier
	// than now), so an early renewal stacks on top of the remaining time.
	const renew = Boolean(paidMeta?.renew);
	let base = now;
	if (renew) {
		const { data: current } = await admin.from('subscriptions')
			.select('expires_at').eq('user_id', payment.user_id).eq('plan_id', planId)
			.eq('status', 'active').gt('expires_at', now.toISOString())
			.order('expires_at', { ascending: false }).limit(1).maybeSingle();
		if (current?.expires_at) {
			const cur = new Date(current.expires_at);
			if (cur > now) base = cur;
		}
	}
	const expires = new Date(base);
	if (plan.duration_unit === 'days') expires.setDate(expires.getDate() + plan.duration_count);
	else if (plan.duration_unit === 'months') expires.setMonth(expires.getMonth() + plan.duration_count);
	else expires.setFullYear(expires.getFullYear() + plan.duration_count);

	await admin.from('subscriptions').update({ status: 'canceled' })
		.eq('user_id', payment.user_id).eq('status', 'active');
	await admin.from('subscriptions').insert({
		user_id: payment.user_id, plan_id: planId,
		started_at: now.toISOString(), expires_at: expires.toISOString(), status: 'active',
	});

	await admin.from('payments').update({
		status: 'paid',
		method: body.data.method ?? 'card',
		meta: { ...(payment.meta as object), transaction_id: body.data.transactionId },
	}).eq('id', payment.id);

	// record coupon redemption only on successful payment
	if (paidMeta?.coupon_code) {
		await admin.from('coupon_redemptions')
			.insert({ coupon_code: paidMeta.coupon_code, user_id: payment.user_id, payment_id: payment.id })
			.then(({ error }) => {
				// duplicate redemption (same user+code) — ignore, the discount already applied
				void error;
			});
		await admin.rpc('increment_coupon_redeemed', { p_code: paidMeta.coupon_code });
	}

	return Response.json({ ok: true, handled: 'paid' }, { headers: CORS_HEADERS })
});
