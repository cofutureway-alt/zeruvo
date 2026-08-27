// deno-lint-ignore-file no-explicit-any
/**
 * checkout — creates a pending payment + signed Kashier iframe URL.
 * Called from the SPA with the user's JWT. Signature scheme per official
 * Kashier plugin: HMAC-SHA256('/?payment=MID.ORDER.AMOUNT.CUR', apiKey).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const enc = new TextEncoder();

async function hmacHex(key: string, payload: string): Promise<string> {
	const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', k, enc.encode(payload));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kashier-signature',
};

if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
if (req.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405, headers: CORS_HEADERS });

try {
	const authHeader = req.headers.get('Authorization') ?? '';
	const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
		global: { headers: { Authorization: authHeader } },
	});
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS_HEADERS })

	let body: { plan_id?: string; coupon_code?: string };
	try { body = await req.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400, headers: CORS_HEADERS }) }
	if (!body.plan_id) return Response.json({ error: 'plan_id required' }, { status: 400, headers: CORS_HEADERS })

	const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

	const { data: gw } = await admin.from('payment_gateways')
		.select('*').eq('gateway', 'kashier').eq('enabled', true).single();
	if (!gw?.merchant_id || !gw.encrypted_api_key) {
		return Response.json({ error: 'Payment gateway not configured' }, { status: 503, headers: CORS_HEADERS })
	}

	const { data: plan } = await admin.from('plans')
		.select('id,name,price_usd,is_free').eq('id', body.plan_id).eq('active', true).single();
	if (!plan) return Response.json({ error: 'plan not found' }, { status: 404, headers: CORS_HEADERS })
	if (plan.is_free || Number(plan.price_usd) === 0) {
		return Response.json({ error: 'plan is free — no checkout needed' }, { status: 400, headers: CORS_HEADERS })
	}

	// ---------- coupon validation (server-side source of truth) ----------
	const couponCode = String(body.coupon_code ?? '').trim().toUpperCase();
	let discountPct = 0;
	let appliedCoupon: string | null = null;
	if (couponCode) {
		const { data: coupon, error: couponErr } = await admin.from('coupons')
			.select('*').eq('code', couponCode).eq('active', true).maybeSingle();
		if (couponErr) {
			console.error('coupon query error:', JSON.stringify(couponErr));
			return Response.json({ error: 'coupon lookup failed' }, { status: 500, headers: CORS_HEADERS })
		}
		const now = new Date();
		if (
			coupon &&
			new Date(coupon.valid_from) <= now &&
			new Date(coupon.valid_to) > now &&
			coupon.times_redeemed < coupon.max_redemptions
		) {
			discountPct = Number(coupon.percent_off);
			appliedCoupon = coupon.code;
		} else {
			return Response.json({ error: 'Invalid, expired, or exhausted coupon' }, { status: 400, headers: CORS_HEADERS })
		}
	}

	const priceUsd = Number(plan.price_usd);
	const finalUsd = Math.max(priceUsd * (1 - discountPct / 100), 0.5); // Kashier min charge guard

	// convert USD → EGP using the gateway-configured exchange rate
	const egpRate = Number(gw.egp_rate ?? 50);
	const finalEgp = Math.round(finalUsd * egpRate * 100) / 100; // 2 decimal places

	const orderId = `nx-${user.id.slice(0, 8)}-${body.plan_id.slice(0, 8)}-${Date.now().toString(36)}`;
	const amount = finalEgp.toFixed(2);
	let apiKey: string;
	try {
		apiKey = await decrypt(gw.encrypted_api_key, Deno.env.get('NEXOR_ENCRYPTION_KEY')!);
	} catch {
		console.error('checkout: failed to decrypt payment gateway key — DEK may have been rotated');
		return Response.json({ error: 'Payment gateway misconfigured — admin must re-save the Kashier API key' }, { status: 503, headers: CORS_HEADERS })
	}

	// official Hash.php scheme
	const path = `/?payment=${gw.merchant_id}.${orderId}.${amount}.EGP`;
	const hash = await hmacHex(apiKey, path);

	const origin = req.headers.get('origin') ?? new URL(req.url).origin;
	const q = new URLSearchParams({
		merchantId: gw.merchant_id,
		orderId,
		amount,
		currency: 'EGP',
		hash,
		mode: gw.mode,
		display: 'en',
		failureRedirect: 'true',
		redirectMethod: 'get',
		merchantRedirect: `${origin}/dashboard/purchases?paid=1`,
		serverWebhook: `${Deno.env.get('SUPABASE_URL')}/functions/v1/kashier-webhook`,
		allowedMethods: (gw.allowed_methods ?? ['card']).join(','),
		defaultMethod: gw.default_method ?? 'card',
		metaData: encodeURIComponent(JSON.stringify({ userId: user.id, planId: body.plan_id })),
	});

	const { error: insertErr } = await admin.from('payments').insert({
		user_id: user.id,
		amount_egp: amount,
		amount_usd_display: finalUsd,
		method: gw.default_method ?? 'card',
		gateway_ref: orderId,
		status: 'pending',
		coupon_code: appliedCoupon,
		meta: { plan_id: body.plan_id, mode: gw.mode, discount_pct: discountPct, list_price_usd: priceUsd, egp_rate: egpRate },
	});
	if (insertErr) {
		console.error('payment insert error:', JSON.stringify(insertErr));
		return Response.json({ error: 'failed to create payment record' }, { status: 500, headers: CORS_HEADERS })
	}
	// note: coupon_redemptions + times_redeemed increment happen in the
	// kashier-webhook on SUCCESS — reserving at checkout would burn the
	// coupon if the payment never completes

	return Response.json({
		checkout_url: `https://payments.kashier.io/?${q.toString()}`,
		order_id: orderId,
	}, { headers: CORS_HEADERS });
} catch (err) {
	console.error('checkout unhandled:', err);
	return Response.json({ error: 'Internal Server Error', detail: String(err?.message ?? err) }, { status: 500, headers: CORS_HEADERS })
}
});
