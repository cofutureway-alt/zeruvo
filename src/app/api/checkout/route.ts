import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptProviderKey } from '@/lib/crypto';
import { buildCheckoutUrl, type KashierCredentials } from '@/lib/kashier';

/**
 * POST /api/checkout — { plan_id }
 * Creates a pending payment row + signed Kashier checkout URL for the iframe.
 */
export async function POST(request: Request) {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

	const body = (await request.json()) as { plan_id?: string };
	if (!body.plan_id) return NextResponse.json({ error: 'plan_id required' }, { status: 400 });

	const admin = createAdminClient();

	// gateway must be enabled
	const { data: gwRows } = await admin
		.from('payment_gateways')
		.select('*')
		.eq('gateway', 'kashier')
		.eq('enabled', true)
		.single();
	const gw = gwRows as {
		mode: 'test' | 'live';
		merchant_id: string;
		encrypted_api_key: string;
		encrypted_secret_key: string;
		allowed_methods: string[];
		default_method: string;
	} | null;
	if (!gw?.merchant_id || !gw.encrypted_api_key) {
		return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 });
	}

	// resolve plan price
	const { data: plan } = await admin
		.from('plans')
		.select('id, name, price_usd, is_free')
		.eq('id', body.plan_id)
		.eq('active', true)
		.single();
	if (!plan) return NextResponse.json({ error: 'plan not found' }, { status: 404 });
	if (plan.is_free || Number(plan.price_usd) === 0) {
		return NextResponse.json({ error: 'plan is free — no checkout needed' }, { status: 400 });
	}

	// idempotent-ish order ref: user+plan+timestamp bucket (5s window)
	const orderId = `nx-${user.id.slice(0, 8)}-${body.plan_id.slice(0, 8)}-${Date.now().toString(36)}`;
	const amount = Number(plan.price_usd).toFixed(2);

	// record pending payment BEFORE redirecting to gateway
	const origin = new URL(request.url).origin;
	const webhookUrl = `${origin}/api/webhooks/kashier`;
	const merchantRedirect = `${origin}/${'en'}/dashboard/purchases?paid=1`;

	let apiKeyPlain: string;
	try {
		apiKeyPlain = await decryptProviderKey(gw.encrypted_api_key);
	} catch {
		return NextResponse.json({ error: 'gateway credential decrypt failed' }, { status: 500 });
	}

	const creds: KashierCredentials = {
		merchantId: gw.merchant_id,
		apiKey: apiKeyPlain,
		secretKey: '', // v3 sessions unused in direct-iframe flow
		mode: gw.mode,
	};

	try {
		const { url } = await buildCheckoutUrl(creds, {
			orderId,
			amount,
			currency: 'EGP',
			merchantRedirect,
			serverWebhook: webhookUrl,
			display: 'en',
			allowedMethods: gw.allowed_methods?.join(','),
			defaultMethod: gw.default_method,
			metaData: { userId: user.id, planId: body.plan_id },
		});

		const { error } = await admin.from('payments').insert({
			user_id: user.id,
			amount_egp: amount,
			amount_usd_display: Number(plan.price_usd),
			method: gw.default_method ?? 'card',
			gateway_ref: orderId,
			status: 'pending',
			meta: { plan_id: body.plan_id, mode: gw.mode },
		});
		if (error) return NextResponse.json({ error: error.message }, { status: 500 });

		return NextResponse.json({ checkout_url: url, order_id: orderId });
	} catch (err) {
		console.error('checkout build failed', err);
		return NextResponse.json({ error: 'checkout build failed' }, { status: 500 });
	}
}
