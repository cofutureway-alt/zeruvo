// deno-lint-ignore-file no-explicit-any
/**
 * admin-sync-models — pulls the upstream provider /models catalog with
 * FULL metadata (context length, pricing, modality, capabilities) and maps
 * OpenRouter's rich model objects onto our models table.
 * Admin-only. New models are disabled by default; existing selections and
 * multipliers are preserved across syncs.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function b64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

async function decrypt(stored: string, dekB64: string): Promise<string> {
	const bytes = b64ToBytes(stored);
	const nonce = bytes.slice(0, 12), ct = bytes.slice(12);
	const raw = b64ToBytes(dekB64);
	const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
	return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
}

interface ORModel {
	id: string;
	name?: string;
	description?: string;
	context_length?: number;
	architecture?: {
		modality?: string;
		input_modalities?: string[];
		output_modalities?: string[];
	};
	pricing?: Record<string, string>;
	top_provider?: { max_completion_tokens?: number };
}

/** Capability tags from OpenRouter metadata (stored in our tags[] column). */
function deriveTags(m: ORModel): string[] {
	const tags: string[] = [];
	const mods = m.architecture?.input_modalities ?? [];
	if (mods.includes('image')) tags.push('vision');
	if ((m.architecture?.output_modalities ?? []).includes('image')) tags.push('image-output');
	if (/coder|code/i.test(m.id)) tags.push('coding');
	if (/reasoning|thinking/i.test(m.id) || m.pricing?.internal_reasoning) tags.push('reasoning');
	if (/free$|:free/i.test(m.id)) tags.push('free');
	const promptPrice = Number(m.pricing?.prompt ?? '1');
	if (promptPrice === 0) tags.push('free');
	else if (promptPrice < 0.0000005) tags.push('cheap');
	else if (promptPrice > 0.000003) tags.push('premium');
	return [...new Set(tags)];
}

Deno.serve(async (req) => {
// CORS: the SPA calls these functions directly from the browser
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kashier-signature',
};

if (req.method === 'OPTIONS') {
	return new Response('ok', { headers: CORS_HEADERS });
}

	if (req.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405, headers: CORS_HEADERS })
	const authHeader = req.headers.get('Authorization') ?? '';
	const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
		global: { headers: { Authorization: authHeader } },
	});
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS_HEADERS })

	const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
	const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
	if (profile?.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403, headers: CORS_HEADERS })

	let body: { provider_id?: string };
	try { body = await req.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400, headers: CORS_HEADERS }) }
	if (!body.provider_id) return Response.json({ error: 'provider_id required' }, { status: 400, headers: CORS_HEADERS })

	const { data: provider } = await admin.from('providers').select('*').eq('id', body.provider_id).single();
	if (!provider) return Response.json({ error: 'provider not found' }, { status: 404, headers: CORS_HEADERS })

	const { data: keys } = await admin.from('provider_keys')
		.select('id,encrypted_key,dead_until,label')
		.eq('provider_id', body.provider_id);

	// probe every key; keep the first live one for the catalog pull
	const keyResults: Array<{ label: string; ok: boolean; detail: string }> = [];
	let apiKey: string | null = null;
	for (const k of keys ?? []) {
		if (apiKey) break;
		if (k.dead_until && new Date(k.dead_until) > new Date()) {
			keyResults.push({ label: k.label, ok: false, detail: 'marked dead' });
			continue;
		}
		try {
			apiKey = await decrypt(k.encrypted_key, Deno.env.get('NEXOR_ENCRYPTION_KEY')!);
			keyResults.push({ label: k.label, ok: true, detail: 'loaded' });
		} catch {
			keyResults.push({ label: k.label, ok: false, detail: 'decrypt failed' });
		}
	}
	if (!apiKey) return Response.json({ error: 'no usable keys', keys: keyResults }, { status: 403, headers: CORS_HEADERS })

	const base = String(provider.base_url).replace(/\/+$/, '');
	const res = await fetch(`${base}/models`, {
		headers: provider.kind === 'openrouter'
			? { Authorization: `Bearer ${apiKey}`, 'HTTP-Referer': 'https://zeruvo.online' }
			: { Authorization: `Bearer ${apiKey}` },
	});
	if (!res.ok) return Response.json({ error: `upstream ${res.status}` }, { status: 502, headers: CORS_HEADERS })
	const json = await res.json();

	type AnyModel = Record<string, any>;
	// Handle both OpenRouter shape {data: [...]} and flat arrays [...]
	const upstream: AnyModel[] = Array.isArray(json) ? json : (json.data ?? []);
	if (upstream.length === 0) {
		return Response.json({ synced: 0, added: 0, updated_meta: 0, rich_metadata: false, keys_probed: keyResults, note: 'upstream returned 0 models (response shape may differ from expected {data: [...]})' }, { headers: CORS_HEADERS });
	}
	const isRich = upstream.some((m) => m.context_length != null || m.pricing != null);

	const { data: existing } = await admin
		.from('models')
		.select('id,upstream_model_id,enabled_for_users,usage_multiplier,tags')
		.eq('provider_id', body.provider_id);
	const byUpstream = new Map((existing ?? []).map((m) => [m.upstream_model_id, m]));

	let added = 0, updatedMeta = 0;
	const rows: any[] = [];
	const slugSeen = new Map<string, number>(); // track slug collisions

	for (const m of upstream) {
		const prev = byUpstream.get(m.id);
		// build metadata-rich row
		let slug = m.id.replace(/[^a-zA-Z0-9._:-]/g, '-').replace(/^-+/, '');
		const dup = slugSeen.get(slug) ?? 0;
		slugSeen.set(slug, dup + 1);
		if (dup > 0) slug = `${slug}-${dup + 1}`; // append suffix on collision

		const row: any = {
			provider_id: body.provider_id,
			upstream_model_id: m.id,
			slug,
		};

		if (isRich) {
			const orm = m as unknown as ORModel;
			row.display_name = orm.name ?? orm.id;
			row.description = orm.description ? orm.description.slice(0, 500) : null;
			row.context_window = orm.context_length ?? null;
			row.tags = deriveTags(orm);
		} else {
			row.display_name = m.id;
		}

		if (!prev) {
			row.enabled_for_users = false;
			row.usage_multiplier = 1;
			rows.push(row);
			added++;
		} else if (isRich) {
			// refresh metadata but preserve admin choices
			const { error: updErr } = await admin.from('models').update({
				display_name: row.display_name,
				description: row.description,
				context_window: row.context_window,
				tags: row.tags,
			}).eq('id', prev.id);
			if (updErr) console.error('metadata update failed', m.id, updErr.message);
			else updatedMeta++;
		}
	}

	if (rows.length) {
		const { error: insErr } = await admin.from('models').insert(rows);
		if (insErr) {
			console.error('bulk insert failed', insErr.message, 'attempting one-by-one');
			// fallback: insert one by one, skip duplicates
			let inserted = 0;
			for (const r of rows) {
				const { error } = await admin.from('models').insert(r);
				if (!error) inserted++;
				else console.error('skip', r.upstream_model_id, error.message);
			}
			added = inserted;
		}
	}

	return Response.json({
		synced: upstream.length,
		added,
		updated_meta: updatedMeta,
		rich_metadata: isRich,
		keys_probed: keyResults,
	}, { headers: CORS_HEADERS });
});
