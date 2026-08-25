import type { SupabaseClient } from '@supabase/supabase-js';

/** Small helpers for service-role inserts used by admin API routes. */
export const db = {
	async insertProviderKey(
		admin: SupabaseClient,
		providerId: string,
		encrypted: string,
		label = 'key',
	) {
		const { error } = await admin
			.from('provider_keys')
			.insert({ provider_id: providerId, encrypted_key: encrypted, label });
		if (error) throw new Error(error.message);
	},
};
