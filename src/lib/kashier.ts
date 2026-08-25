import 'server-only';

/**
 * Kashier payment gateway library — signature schemes verified against the
 * OFFICIAL Kashier-WooCommerce-Plugin source (Kashier-payments GitHub):
 *
 * 1. Checkout (iframe / redirect) hash  — lib/src/Security/Hash.php:
 *      path = '/?payment=' + merchantId + '.' + orderId + '.' + amount + '.' + currency
 *      hash = HMAC-SHA256(path, apiKey) as lowercase hex
 *    URL: https://payments.kashier.io/?merchantId=..&orderId=..&amount=..
 *           &currency=..&hash=..&mode=test|live&merchantRedirect=..
 *           &serverWebhook=..&allowedMethods=..&display=..
 *
 * 2. Webhook verification — check_response() in class-kashier-gateway.php:
 *      header: x-kashier-signature
 *      body:   { event: 'pay'|'refund', data: { signatureKeys[], ... } }
 *      Build query string from data[signatureKeys] in the order given,
 *      RFC3986-encoded, joined with '&'.
 *      expected = HMAC-SHA256(queryString, apiKey) hex — compare exact.
 *      Success = event === 'pay' && data.status.toUpperCase() === 'SUCCESS'
 */

export interface KashierCredentials {
	merchantId: string;
	apiKey: string;
	secretKey: string; // Authorization header for Payment Sessions API (v3)
	mode: 'test' | 'live';
}

async function hmacSha256Hex(key: string, payload: string): Promise<string> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(key),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(payload));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Official Hash.php scheme — dot-separated path signed with API key. */
export async function generateCheckoutHash(
	creds: Pick<KashierCredentials, 'merchantId' | 'apiKey'>,
	params: { orderId: string; amount: string; currency: string },
): Promise<string> {
	const path = `/?payment=${creds.merchantId}.${params.orderId}.${params.amount}.${params.currency}`;
	return hmacSha256Hex(creds.apiKey, path);
}

export interface CheckoutUrlParams {
	orderId: string;
	amount: string; // "15.00" — exactly 2 decimals as sent to the hasher
	currency: string;
	merchantRedirect: string;
	serverWebhook?: string;
	display?: 'en' | 'ar';
	modeOverride?: 'test' | 'live';
	allowedMethods?: string; // e.g. 'card,wallet,fawry'
	defaultMethod?: string;
	metaData?: Record<string, unknown>;
}

const IFRAME_BASE_URL = 'https://payments.kashier.io';

export async function buildCheckoutUrl(
	creds: KashierCredentials,
	p: CheckoutUrlParams,
): Promise<{ url: string; hash: string }> {
	const hash = await generateCheckoutHash(creds, {
		orderId: p.orderId,
		amount: p.amount,
		currency: p.currency,
	});

	const q = new URLSearchParams({
		merchantId: creds.merchantId,
		orderId: p.orderId,
		amount: p.amount,
		currency: p.currency,
		hash,
		mode: p.modeOverride ?? creds.mode,
		display: p.display ?? 'en',
		failureRedirect: 'true',
		redirectMethod: 'get',
	});
	if (p.merchantRedirect) q.set('merchantRedirect', p.merchantRedirect);
	if (p.serverWebhook) q.set('serverWebhook', p.serverWebhook);
	if (p.allowedMethods) q.set('allowedMethods', p.allowedMethods);
	if (p.defaultMethod) q.set('defaultMethod', p.defaultMethod);
	if (p.metaData) q.set('metaData', encodeURIComponent(JSON.stringify(p.metaData)));

	return { url: `${IFRAME_BASE_URL}/?${q.toString()}`, hash };
}

// ---------- webhook verification ----------

export interface KashierWebhookBody {
	event: string;
	data: {
		signatureKeys: string[];
		merchantOrderId: string;
		status: string;
		transactionId?: string;
		kashierOrderId?: string;
		amount?: number | string;
		currency?: string;
		method?: string;
		card?: { cardInfo?: { maskedCard?: string; cardBrand?: string } };
		[key: string]: unknown;
	};
}

/** RFC3986 percent-encoding (matches PHP http_build_query default flags used by Kashier's plugin). */
function rfc3986Encode(v: string): string {
	return encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Verify x-kashier-signature per official plugin:
 * query string built from signatureKeys IN THE GIVEN ORDER, RFC3986 encoded.
 */
export async function verifyWebhookSignature(
	body: KashierWebhookBody,
	signatureHeader: string,
	apiKey: string,
): Promise<boolean> {
	if (!body?.data?.signatureKeys?.length || !signatureHeader) return false;

	const pairs = body.data.signatureKeys.map((key) => {
		const value = (body.data as Record<string, unknown>)[key];
		return `${key}=${rfc3986Encode(value == null ? '' : String(value))}`;
	});
	const queryString = pairs.join('&');

	const expected = await hmacSha256Hex(apiKey, queryString);
	return expected === signatureHeader.toLowerCase();
}

export function isPaymentSuccess(body: KashierWebhookBody): boolean {
	return body.event === 'pay' && String(body.data.status).toUpperCase() === 'SUCCESS';
}
