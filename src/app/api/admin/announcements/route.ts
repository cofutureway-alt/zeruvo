import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface AnnouncementPayload {
	id?: string;
	type: 'popup' | 'marquee';
	placement_routes: string[];
	audience_type: 'everyone' | 'anonymous' | 'logged_in' | 'plans';
	plan_ids: string[];
	media_type: 'image' | 'youtube' | 'button';
	image_url?: string;
	youtube_id?: string;
	body_text: Record<string, string>;
	cta_label: Record<string, string>;
	cta_url?: string;
	starts_at?: string;
	ends_at?: string;
	active: boolean;
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
		.from('announcements')
		.select('*')
		.order('created_at', { ascending: false });
	return NextResponse.json({ announcements: data ?? [] });
}

export async function POST(request: Request) {
	const guard = await requireAdmin();
	if ('error' in guard) return guard.error;
	const body = (await request.json()) as AnnouncementPayload;
	const { id, ...insert } = body;
	const { data, error } = await guard.admin.from('announcements').insert(insert).select().single();
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ announcement: data }, { status: 201 });
}

export async function PATCH(request: Request) {
	const guard = await requireAdmin();
	if ('error' in guard) return guard.error;
	const body = (await request.json()) as AnnouncementPayload;
	if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
	const { id, ...updates } = body;
	const { error } = await guard.admin.from('announcements').update(updates).eq('id', id);
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
	const guard = await requireAdmin();
	if ('error' in guard) return guard.error;
	const { searchParams } = new URL(request.url);
	const id = searchParams.get('id');
	if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
	const { error } = await guard.admin.from('announcements').delete().eq('id', id);
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ ok: true });
}
