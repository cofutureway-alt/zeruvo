import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface PlanPayload {
	name: Record<string, string>;
	description?: Record<string, string>;
	daily_weighted_tokens: number;
	price_usd: number;
	duration_unit: 'days' | 'months' | 'years';
	duration_count: number;
	is_free?: boolean;
	default_free?: boolean;
	active?: boolean;
	model_ids: string[];
}

async function requireAdmin() {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
	const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
	if (profile?.role !== 'admin') {
		return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
	}
	return { admin: createAdminClient() };
}

export async function GET() {
	const guard = await requireAdmin();
	if ('error' in guard) return guard.error;
	const { data } = await guard.admin
		.from('plans')
		.select('*, plan_models(model_id)')
		.order('price_usd');
	return NextResponse.json({
		plans: (data ?? []).map((p) => ({
			...p,
			model_ids: p.plan_models?.map((pm: { model_id: string }) => pm.model_id) ?? [],
			plan_models: undefined,
		})),
	});
}

export async function POST(request: Request) {
	const guard = await requireAdmin();
	if ('error' in guard) return guard.error;
	const admin = guard.admin;

	const body = (await request.json()) as PlanPayload;
	const validation = validate(body);
	if (validation) return NextResponse.json({ error: validation }, { status: 400 });

	// only one default free plan
	if (body.default_free) {
		await admin.from('plans').update({ default_free: false }).eq('default_free', true);
	}

	const { data: plan, error } = await admin
		.from('plans')
		.insert({
			name: body.name,
			description: body.description ?? {},
			daily_weighted_tokens: body.daily_weighted_tokens,
			price_usd: body.is_free ? 0 : body.price_usd,
			duration_unit: body.duration_unit,
			duration_count: body.duration_count,
			is_free: body.is_free ?? false,
			default_free: body.default_free ?? false,
			active: body.active ?? true,
		})
		.select()
		.single();
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });

	if (body.model_ids.length) {
		await admin
			.from('plan_models')
			.insert(body.model_ids.map((model_id) => ({ plan_id: plan.id, model_id })));
	}
	return NextResponse.json({ plan }, { status: 201 });
}

export async function PATCH(request: Request) {
	const guard = await requireAdmin();
	if ('error' in guard) return guard.error;
	const admin = guard.admin;

	const body = (await request.json()) as PlanPayload & { id: string };
	if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

	if (body.default_free) {
		await admin.from('plans').update({ default_free: false }).neq('id', body.id);
	}
	await admin.from('plan_models').delete().eq('plan_id', body.id);

	const { error } = await admin
		.from('plans')
		.update({
			name: body.name,
			description: body.description ?? {},
			daily_weighted_tokens: body.daily_weighted_tokens,
			price_usd: body.is_free ? 0 : body.price_usd,
			duration_unit: body.duration_unit,
			duration_count: body.duration_count,
			is_free: body.is_free ?? false,
			default_free: body.default_free ?? false,
			active: body.active ?? true,
		})
		.eq('id', body.id);
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });

	if (body.model_ids.length) {
		await admin
			.from('plan_models')
			.insert(body.model_ids.map((model_id) => ({ plan_id: body.id, model_id })));
	}
	return NextResponse.json({ ok: true });
}

function validate(p: PlanPayload): string | null {
	if (!p.name?.en?.trim()) return 'name required';
	if (!(p.daily_weighted_tokens > 0)) return 'daily_weighted_tokens must be positive';
	if (!(p.duration_count > 0)) return 'duration_count must be positive';
	if (!['days', 'months', 'years'].includes(p.duration_unit)) return 'invalid duration_unit';
	if (!p.is_free && !(p.price_usd >= 0)) return 'price required';
	return null;
}
