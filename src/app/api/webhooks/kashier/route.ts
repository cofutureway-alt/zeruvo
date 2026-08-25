import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptProviderKey } from '@/lib/crypto';
import {
	verifyWebhookSignature,
	isPaymentSuccess,
	type KashierWebhookBody,
} from '@/lib/kashier';

/**
 * POST /api/webhooks/kashier — server-to-server payment notification.
 * Signature verified per official Kashier scheme (x-kashier-signature header,
 * HMAC-SHA256 of RFC3986 query string built from data.signatureKeys with API key).
 *
 * On verified SUCCESS: mark payment paid + activate/extend subscription.
 * Idempotent: gateway_ref (orderId) is UNIQUE; already-paid orders short-circuit.
 */
export async function POST(request: Request) {
	const raw = await request.text();

	let body: KashierWebhookBody;
	try {
		body = JSON.parse(raw);
	} catch {
		return NextResponse.json({ error: 'invalid json' }, { status: 400 });
	}

	const signature = request.headers.get('x-kashier-signature') ?? '';

	const admin = createAdminClient();

	// resolve the gateway credentials for verification
	const { data: gwRows } = await admin
		.from('payment_gateways')
		.select('encrypted_api_key')
		.eq('gateway', 'kashier')
		.single();
	if (!gwRows?.encrypted_api_key) {
		return NextResponse.json({ error: 'gateway not configured' }, { status: 503 });
	}

	let apiKey: string;
	try {
		apiKey = await decryptProviderKey(gwRows.encrypted_api_key);
	} catch {
		return NextResponse.json({ error: 'credential decrypt failed' }, { status: 500 });
	}

	const valid = await verifyWebhookSignature(body, signature, apiKey);
	if (!valid) {
		console.warn('kashier webhook: bad signature');
		return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
	}

	const orderId = body.data.merchantOrderId;

	// fetch pending payment by gateway_ref
	const { data: payment } = await admin
		.from('payments')
		.select('id, user_id, status, amount_egp, meta')
		.eq('gateway_ref', orderId)
		.single();
	if (!payment) return NextResponse.json({ error: 'unknown order' }, { status: 404 });

	if (!isPaymentSuccess(body)) {
		await admin.from('payments').update({ status: 'failed' }).eq('id', payment.id);
		return NextResponse.json({ ok: true, handled: 'failed' });
	}

	// idempotency: if already paid, just ack
	if (payment.status === 'paid') {
		return NextResponse.json({ ok: true, handled: 'already-paid' });
	}

	const planId = (payment.meta as { plan_id?: string })?.plan_id;
	if (!planId) return NextResponse.json({ error: 'payment missing plan meta' }, { status: 500 });

	// plan duration -> expiry
	const { data: plan } = await admin
		.from('plans')
		.select('id, duration_unit, duration_count')
		.eq('id', planId)
		.single();
	if (!plan) return NextResponse.json({ error: 'plan missing' }, { status: 500 });

	const now = new Date();
	const expires = new Date(now);
	if (plan.duration_unit === 'days') expires.setDate(expires.getDate() + plan.duration_count);
	else if (plan.duration_unit === 'months') expires.setMonth(expires.getMonth() + plan.duration_count);
	else expires.setFullYear(expires.getFullYear() + plan.duration_count);

	// cancel other active subs, insert new one
	await admin
		.from('subscriptions')
		.update({ status: 'canceled' })
		.eq('user_id', payment.user_id)
		.eq('status', 'active');
	await admin.from('subscriptions').insert({
		user_id: payment.user_id,
		plan_id: planId,
		started_at: now.toISOString(),
		expires_at: expires.toISOString(),
		status: 'active',
	});

	await admin
		.from('payments')
		.update({
			status: 'paid',
			method: body.data.method ?? 'card',
			coupon_code: null,
			meta: { ...(payment.meta as object), transaction_id: body.data.transactionId },
		})
		.eq('id', payment.id);

	return NextResponse.json({ ok: true, handled: 'paid' });
}
