/**
 * Provider key decryption (AES-256-GCM envelope, DEK from Worker secret)
 * and weighted selection with dead-key tracking.
 * Storage format: base64(nonce(12) || ciphertext) — matches admin-api writer.
 */
import { postgrestRpc } from './db';

export interface ProviderKeyRow {
	id: string;
	provider_id: string;
	encrypted_key: string;
	weight: string; // numeric comes as string
	dead_until: string | null;
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

/** Weighted random among live keys (dead_until in the past). */
export function pickWeighted(keys: ProviderKeyRow[]): ProviderKeyRow | null {
	const now = Date.now();
	const live = keys.filter((k) => !k.dead_until || new Date(k.dead_until).getTime() <= now);
	if (live.length === 0) return null;
	const total = live.reduce((s, k) => s + Number(k.weight), 0);
	let roll = Math.random() * total;
	for (const k of live) {
		roll -= Number(k.weight);
		if (roll <= 0) return k;
	}
	return live[live.length - 1];
}

export async function loadProviderKeys(providerId: string): Promise<ProviderKeyRow[]> {
	const keys =
		(await postgrestRpc<ProviderKeyRow[]>('get_provider_keys', { p_provider_id: providerId })) ?? [];

	// self-healing: if every key is marked dead but its window already
	// expired, clear the stale markers and retry once — otherwise a single
	// transient outage permanently locks the provider until manual cleanup
	if (keys.length > 0 && !pickWeighted(keys)) {
		const now = Date.now();
		const stale = keys.filter(
			(k) => k.dead_until && new Date(k.dead_until).getTime() <= now,
		);
		if (stale.length) {
			await Promise.all(stale.map((k) => postgrestRpc('revive_provider_key', { p_key_id: k.id })));
			return (
				(await postgrestRpc<ProviderKeyRow[]>('get_provider_keys', { p_provider_id: providerId })) ?? []
			);
		}
	}
	return keys;
}

/** Mark a key dead after auth/billing errors (401/402/403). */
export async function markDead(keyId: string, minutes: number): Promise<void> {
	await postgrestRpc('mark_provider_key_dead', {
		p_key_id: keyId,
		p_dead_until: new Date(Date.now() + minutes * 60_000).toISOString(),
	});
}
