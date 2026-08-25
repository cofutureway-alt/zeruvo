import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** GET /api/admin/providers — list providers + key counts + model counts */
export async function GET() {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
	const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
	if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

	const admin = createAdminClient();
	const [{ data: providers }, { data: keys }, { data: models }] = await Promise.all([
		admin.from('providers').select('*').order('created_at', { ascending: false }),
		admin.from('provider_keys').select('id,provider_id,dead_until'),
		admin.from('models').select('id,provider_id,enabled_for_users'),
	]);

	return NextResponse.json({
		providers: (providers ?? []).map((p) => ({
			...p,
			keys_total: keys?.filter((k) => k.provider_id === p.id).length ?? 0,
			models_total: models?.filter((m) => m.provider_id === p.id).length ?? 0,
			models_enabled: models?.filter((m) => m.provider_id === p.id && m.enabled_for_users).length ?? 0,
		})),
	});
}

/** POST /api/admin/providers — create provider with encrypted keys. */
export async function POST(request: Request) {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
	const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
	if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

	const body = (await request.json()) as {
		kind: 'custom' | 'openrouter';
		display_name: string;
		base_url: string;
		keys: string[];
	};
	if (!body.kind || !body.display_name || !body.keys?.length) {
		return NextResponse.json({ error: 'missing fields' }, { status: 400 });
	}

	const base =
		body.kind === 'openrouter'
			? 'https://openrouter.ai/api/v1'
			: body.base_url.replace(/\/+$/, '');
	if (!base) return NextResponse.json({ error: 'base_url required for custom kind' }, { status: 400 });

	const admin = createAdminClient();
	const { data: provider, error: perr } = await admin
		.from('providers')
		.insert({ kind: body.kind, display_name: body.display_name, base_url: base })
		.select()
		.single();
	if (perr || !provider) return NextResponse.json({ error: perr?.message }, { status: 500 });

	await insertKeys(admin, provider.id, body.keys);
	return NextResponse.json({ provider }, { status: 201 });
}

import { encryptProviderKey } from '@/lib/crypto';
import { db } from '@/lib/db-insert';

async function insertKeys(
	admin: ReturnType<typeof createAdminClient>,
	providerId: string,
	keys: string[],
) {
	for (const raw of keys.filter(Boolean)) {
		const encrypted = await encryptProviderKey(raw);
		await db.insertProviderKey(admin, providerId, encrypted);
	}
}
