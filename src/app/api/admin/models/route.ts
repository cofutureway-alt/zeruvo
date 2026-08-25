import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptProviderKey } from '@/lib/crypto';

/** POST /api/admin/models — { action: 'sync', provider_id } fetches upstream /models. */
export async function POST(request: Request) {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
	const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
	if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

	const body = (await request.json()) as {
		action: string;
		provider_id?: string;
		selected?: Array<{ upstream_model_id: string; usage_multiplier: number }>;
	};
	const admin = createAdminClient();

	if (body.action === 'sync' && body.provider_id) {
		return syncModels(admin, body.provider_id);
	}

	if (body.action === 'save_selection' && body.provider_id && Array.isArray(body.selected)) {
		return saveSelection(admin, body.provider_id, body.selected);
	}

	return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

/** Fetch upstream model list using the first live key of the provider. */
async function syncModels(admin: ReturnType<typeof createAdminClient>, providerId: string) {
	const { data: provider } = await admin
		.from('providers')
		.select('*')
		.eq('id', providerId)
		.single();
	if (!provider) return NextResponse.json({ error: 'provider not found' }, { status: 404 });

	const { data: keys } = await admin
		.from('provider_keys')
		.select('encrypted_key,dead_until')
		.eq('provider_id', providerId);
	const liveKey = (keys ?? []).find((k) => !k.dead_until || new Date(k.dead_until) <= new Date());
	if (!liveKey) return NextResponse.json({ error: 'no live keys' }, { status: 403 });

	let apiKey: string;
	try {
		apiKey = await decryptProviderKey(liveKey.encrypted_key);
	} catch {
		return NextResponse.json({ error: 'key decrypt failed' }, { status: 500 });
	}

	const base = provider.base_url.replace(/\/+$/, '');
	const res = await fetch(`${base}/models`, {
		headers:
			provider.kind === 'openrouter'
				? { Authorization: `Bearer ${apiKey}`, 'HTTP-Referer': 'https://nexor.ai' }
				: { Authorization: `Bearer ${apiKey}` },
	});
	if (!res.ok) {
		return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
	}
	const json = (await res.json()) as { data?: Array<{ id: string }> };
	const upstreamIds = (json.data ?? []).map((m) => m.id);

	// upsert into models (default multiplier 1, disabled until selected)
	const { data: existing } = await admin
		.from('models')
		.select('upstream_model_id,enabled_for_users')
		.eq('provider_id', providerId);
	const known = new Set((existing ?? []).map((m) => m.upstream_model_id));

	const toInsert = upstreamIds
		.filter((id) => !known.has(id))
		.map((id) => ({
			provider_id: providerId,
			upstream_model_id: id,
			display_name: id,
			slug: id,
			usage_multiplier: 1,
			enabled_for_users: false,
		}));
	if (toInsert.length) {
		const { error } = await admin.from('models').insert(toInsert);
		if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	}

	return NextResponse.json({ synced: upstreamIds.length, added: toInsert.length });
}

/** Persist chosen models + mandatory multipliers; enable for users. */
async function saveSelection(
	admin: ReturnType<typeof createAdminClient>,
	providerId: string,
	selected: Array<{ upstream_model_id: string; usage_multiplier: number }>,
) {
	for (const s of selected) {
		if (!(s.usage_multiplier >= 1)) {
			return NextResponse.json(
				{ error: `usage_multiplier >= 1 required for ${s.upstream_model_id}` },
				{ status: 400 },
			);
		}
	}

	// disable everything not selected, enable/update what is
	const { data: all } = await admin
		.from('models')
		.select('id,upstream_model_id')
		.eq('provider_id', providerId);
	const selMap = new Map(selected.map((s) => [s.upstream_model_id, s.usage_multiplier]));

	for (const m of all ?? []) {
		const mult = selMap.get(m.upstream_model_id);
		await admin
			.from('models')
			.update({ enabled_for_users: mult != null, usage_multiplier: mult ?? 1 })
			.eq('id', m.id);
	}
	return NextResponse.json({ saved: selected.length });
}
