import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { encryptProviderKey } from '@/lib/crypto';

/** GET — return gateway config with masked secrets for the admin UI. */
export async function GET() {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
	const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
	if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

	const admin = createAdminClient();
	const { data: rows } = await admin.from('payment_gateways').select('*').eq('gateway', 'kashier');
	const row = rows?.[0] ?? null;

	return NextResponse.json({
		gateway: row
			? {
					enabled: row.enabled,
					mode: row.mode,
					merchant_id: row.merchant_id ?? '',
					api_key_masked: row.encrypted_api_key
						? '••••' + (row.api_key_last4 ?? '')
						: '',
					secret_key_masked: row.encrypted_secret_key ? 'configured' : '',
					allowed_methods: row.allowed_methods,
					default_method: row.default_method,
					brand_color: row.brand_color,
				}
			: null,
	});
}

/** POST/PUT — upsert Kashier credentials (encrypted at rest) + options. */
export async function PUT(request: Request) {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
	const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
	if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

	const body = (await request.json()) as {
		enabled?: boolean;
		mode?: 'test' | 'live';
		merchant_id?: string;
		api_key?: string; // plaintext only when the admin is (re)setting it
		secret_key?: string;
		allowed_methods?: string[];
		default_method?: string;
		brand_color?: string;
	};

	const admin = createAdminClient();

	const update: Record<string, unknown> = {
		enabled: body.enabled ?? false,
		mode: body.mode ?? 'test',
		merchant_id: body.merchant_id ?? null,
	};
	if (body.allowed_methods) update.allowed_methods = body.allowed_methods;
	if (body.default_method) update.default_method = body.default_method;
	if (body.brand_color) update.brand_color = body.brand_color;

	if (body.api_key && body.api_key !== '••••') {
		update.encrypted_api_key = await encryptProviderKey(body.api_key);
		update.api_key_last4 = body.api_key.slice(-4);
	}
	if (body.secret_key && body.secret_key !== 'configured') {
		update.encrypted_secret_key = await encryptProviderKey(body.secret_key);
	}

	const { error } = await admin.from('payment_gateways').upsert(
		{ gateway: 'kashier', ...update },
		{ onConflict: 'gateway' },
	);
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ ok: true });
}

/** PATCH column addition helper — store last4 alongside ciphertext. */
