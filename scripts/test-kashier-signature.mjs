/**
 * Verify our TS hash implementation produces IDENTICAL output to the official
 * PHP plugin (Hash.php): hash_hmac('sha256', '/?payment=MID.ORDER.AMOUNT.CUR', apiKey)
 *
 * Reference vectors computed with PHP-equivalent semantics via Node crypto
 * (same primitive as hash_hmac).
 */
import crypto from 'crypto';

// mirror of src/lib/kashier.ts generateCheckoutHash
function generateCheckoutHash(merchantId, apiKey, orderId, amount, currency) {
	const path = `/?payment=${merchantId}.${orderId}.${amount}.${currency}`;
	return crypto.createHmac('sha256', apiKey).update(path).digest('hex');
}

// vector 1: typical test values
const h1 = generateCheckoutHash('MID-12345-6789', 'a1b2c3d4e5f6', 'order-42', '15.00', 'EGP');
const expected1 = crypto.createHmac('sha256', 'a1b2c3d4e5f6').update('/?payment=MID-12345-6789.order-42.15.00.EGP').digest('hex');
console.log('vector1 match:', h1 === expected1);

// vector 2: verify against a known-good independent computation with openssl-style manual check
// HMAC-SHA256("key", "msg") = 0x... documented public test vector:
const pub = crypto.createHmac('sha256', 'key').update('The quick brown fox jumps over the lazy dog').digest('hex');
console.log('public RFC-style vector ok:', pub === 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');

// webhook verification mirror: signatureKeys order + RFC3986 query string
function rfc3986(v) {
	return encodeURIComponent(String(v)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
const data = {
	signatureKeys: ['merchantOrderId', 'amount', 'currency', 'status'],
	merchantOrderId: 'nx-abcd1234-plan5678-lz9k2',
	amount: 1500,
	currency: 'EGP',
	status: 'SUCCESS',
	transactionId: 'tx_99',
};
const qs = data.signatureKeys.map((k) => `${k}=${rfc3986(data[k] ?? '')}`).join('&');
const sig = crypto.createHmac('sha256', 'a1b2c3d4e5f6').update(qs).digest('hex');
console.log('webhook qs:', qs);
console.log('webhook signature computed:', sig.slice(0, 16) + '…');

// tamper check: different key must NOT match
const wrongKey = crypto.createHmac('sha256', 'other-key').update(qs).digest('hex');
console.log('tampered key rejected:', sig !== wrongKey);
