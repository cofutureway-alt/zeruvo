/**
 * Provider key decryption (AES-256-GCM envelope, DEK from Worker secret)
 * and weighted selection.
 * Storage format: base64(nonce(12) || ciphertext) — matches admin-api writer.
 */
import { postgrestRpc } from './db';

export interface ProviderKeyRow {
	id: string;
	provider_id: string;
	encrypted_key: string;
	weight: string; // numeric comes as string
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
	const bin = atob(b64);
	const buffer = new ArrayBuffer(bin.length);
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

export async function importDek(secretB64: string): Promise<CryptoKey> {
	const raw = b64ToBytes(secretB64);
	return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
}

export async function decryptProviderKey(dek: CryptoKey, stored: string): Promise<string> {
	const bytes = b64ToBytes(stored);
	const nonce = bytes.slice(0, 12);
	const ciphertext = bytes.slice(12);
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, dek, ciphertext);
	return new TextDecoder().decode(plain);
}

/** Weighted random among the provider's keys. */
export function pickWeighted(keys: ProviderKeyRow[]): ProviderKeyRow | null {
	if (keys.length === 0) return null;
	const total = keys.reduce((s, k) => s + Number(k.weight), 0);
	let roll = Math.random() * total;
	for (const k of keys) {
		roll -= Number(k.weight);
		if (roll <= 0) return k;
	}
	return keys[keys.length - 1];
}

export async function loadProviderKeys(providerId: string): Promise<ProviderKeyRow[]> {
	// read-only → safe to retry through a transient pooler blip
	return (
		(await postgrestRpc<ProviderKeyRow[]>('get_provider_keys', { p_provider_id: providerId }, { retry: true })) ?? []
	);
}
