import { edgeCall } from './admin-api';

/**
 * Client-side secret encryption — delegates to the admin-crypto Edge
 * Function so the DEK never reaches the browser.
 */
export async function encryptForStorage(plaintext: string): Promise<string> {
	const res = await edgeCall<{ encrypted: string[] }>('admin-crypto', { values: [plaintext] });
	if (!res?.encrypted?.[0]) throw new Error('encryption failed');
	return res.encrypted[0];
}

export async function encryptMany(values: string[]): Promise<string[]> {
	const res = await edgeCall<{ encrypted: string[] }>('admin-crypto', { values });
	return res?.encrypted ?? [];
}
