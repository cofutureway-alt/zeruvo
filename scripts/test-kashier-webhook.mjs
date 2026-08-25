/**
 * Kashier webhook E2E — simulates a REAL Kashier notification against our
 * deployed route: valid signature activates the subscription; tampered is 401.
 */
import fs from 'fs';
import crypto from 'crypto';

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const svc = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const dek = env.match(/NEXOR_ENCRYPTION_KEY=(.+)/)[1].trim();
const BASE = 'http://localhost:3100';
const H = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' };

function rfc3986(v) {
	return encodeURIComponent(String(v)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
function sign(apiKey, data, keys) {
	const qs = keys.map((k) => `${k}=${rfc3986(data[k] ?? '')}`).join('&');
	return crypto.createHmac('sha256', apiKey).update(qs).digest('hex');
}
async function encryptKey(plaintext) {
	const raw = Buffer.from(dek, 'base64');
	const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(plaintext));
	return Buffer.from(Buffer.concat([Buffer.from(nonce), Buffer.from(ct)])).toString('base64');
}

(async () => {
	// setup: gateway config with known apiKey + paid test plan + pending payment
	const API_KEY = 'test-api-key-' + Date.now();
	const encKey = await encryptKey(API_KEY);
	await fetch(`${url}/rest/v1/payment_gateways`, {
		method: 'POST',
		headers: { ...H, Prefer: 'resolution=merge-duplicates' },
		body: JSON.stringify({
			gateway: 'kashier', enabled: true, mode: 'test',
			merchant_id: 'MID-TEST-0001', encrypted_api_key: encKey,
			encrypted_secret_key: encKey,
		}),
	});

	// find or create Pro-like paid plan
	let plans = await (await fetch(`${url}/rest/v1/plans?is_free=eq.false&active=eq.true&select=id,name,price_usd,duration_unit,duration_count&limit=1`, { headers: H })).json();
	let plan = plans[0];
	if (!plan) {
		const ins = await fetch(`${url}/rest/v1/plans`, {
			method: 'POST', headers: { ...H, Prefer: 'return=representation' },
			body: JSON.stringify({ name: { en: 'WebhookTest' }, daily_weighted_tokens: 1000000, price_usd: 15, duration_unit: 'days', duration_count: 30 }),
		});
		plan = (await ins.json())[0];
	}
	console.log('plan:', plan.name.en, '$' + plan.price_usd);

	// user
	const email = `pay-${Date.now()}@nexor.dev`;
	const uid = (await (await fetch(`${url}/auth/v1/admin/users`, {
		method: 'POST', headers: H,
		body: JSON.stringify({ email, password: 'Demo1234!pass', email_confirm: true }),
	})).json()).id;

	// pending payment row (as /api/checkout would create)
	const orderId = `nx-${uid.slice(0, 8)}-${plan.id.slice(0, 8)}-${Date.now().toString(36)}`;
	await fetch(`${url}/rest/v1/payments`, {
		method: 'POST', headers: H,
		body: JSON.stringify({
			user_id: uid, amount_egp: Number(plan.price_usd), amount_usd_display: Number(plan.price_usd),
			method: 'card', gateway_ref: orderId, status: 'pending',
			meta: { plan_id: plan.id },
		}),
	});
	console.log('pending payment created:', orderId);

	// build webhook body exactly like Kashier sends
	const webhookBody = {
		event: 'pay',
		data: {
			merchantOrderId: orderId,
			kashierOrderId: 'KO-' + Date.now(),
			orderReference: orderId,
			transactionId: 'TX-' + Math.floor(Math.random() * 1e9),
			status: 'SUCCESS',
			method: 'card',
			amount: Math.round(Number(plan.price_usd) * 100),
			currency: 'EGP',
			card: { cardInfo: { maskedCard: '4547******0001', cardBrand: 'VISA' } },
			signatureKeys: ['merchantOrderId', 'amount', 'currency', 'status'],
		},
	};
	const sig = sign(API_KEY, webhookBody.data, webhookBody.data.signatureKeys);
	void sig;

	// 1) TAMPERED signature must be rejected
	let res = await fetch(`${BASE}/api/webhooks/kashier`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'x-kashier-signature': 'deadbeef'.repeat(8) },
		body: JSON.stringify(webhookBody),
	});
	console.log('tampered signature →', res.status, '(expect 401)');

	// 2) VALID signature → subscription activated
	res = await fetch(`${BASE}/api/webhooks/kashier`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'x-kashier-signature': sig },
		body: JSON.stringify(webhookBody),
	});
	console.log('valid signature →', res.status, await res.text(), '(expect handled:"paid")');

	// 3) REPLAY of same success → idempotent ack
	res = await fetch(`${BASE}/api/webhooks/kashier`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'x-kashier-signature': sig },
		body: JSON.stringify(webhookBody),
	});
	console.log('replay →', res.status, await res.text(), '(expect already-paid)');

	// verify DB state
	const subs = await (await fetch(`${url}/rest/v1/subscriptions?user_id=eq.${uid}&status=eq.active&select=status,expires_at`, { headers: H })).json();
	console.log('subscription activated:', subs.length === 1, '| expires:', subs[0]?.expires_at?.slice(0, 10));
	const pays = await (await fetch(`${url}/rest/v1/payments?gateway_ref=eq.${orderId}&select=status,method`, { headers: H })).json();
	console.log('payment marked:', JSON.stringify(pays));

	// cleanup
	await fetch(`${url}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: H });
})();
