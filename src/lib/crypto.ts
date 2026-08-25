import 'server-only';

/**
 * AES-256-GCM envelope encryption for provider keys.
 * Format: base64(nonce(12) || ciphertext) — matches the gateway Worker reader.
 */
function b64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64');
}

export async function encryptProviderKey(plaintext: string): Promise<string> {
	const secret = process.env.NEXOR_ENCRYPTION_KEY;
	if (!secret) throw new Error('NEXOR_ENCRYPTION_KEY not set');
	const raw = Buffer.from(secret, 'base64');
	const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: nonce },
		key,
		new TextEncoder().encode(plaintext),
	);
	const merged = new Uint8Array(nonce.length + ct.byteLength);
	merged.set(nonce);
	merged.set(new Uint8Array(ct), nonce.length);
	return b64(merged);
}

export async function decryptProviderKey(stored: string): Promise<string> {
	const secret = process.env.NEXOR_ENCRYPTION_KEY;
	if (!secret) throw new Error('NEXOR_ENCRYPTION_KEY not set');
	const raw = Buffer.from(secret, 'base64');
	const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
	const bytes = Buffer.from(stored, 'base64');
	const nonce = bytes.subarray(0, 12);
	const ciphertext = bytes.subarray(12);
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext);
	return new TextDecoder().decode(plain);
}
