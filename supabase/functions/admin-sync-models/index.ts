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
	supported_parameters?: string[];
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

/** Full metadata projection onto our models columns (pricing left untouched). */
function metadataRow(m: ORModel, vendorSlug: string, categoryId: string | null) {
	const mods = m.architecture?.input_modalities ?? ['text'];
	const outMods = m.architecture?.output_modalities ?? ['text'];
	return {
		display_name: m.name ?? m.id,
		description: m.description ? m.description.slice(0, 500) : null,
		context_window: m.context_length ?? null,
		tags: deriveTags(m),
		input_modalities: mods.length ? mods : ['text'],
		output_modalities: outMods.length ? outMods : ['text'],
		supports_reasoning: /reasoning|thinking/i.test(m.id) || !!m.pricing?.internal_reasoning,
		supports_effort: (m.supported_parameters ?? []).includes('reasoning_effort'),
		max_output_tokens: m.top_provider?.max_completion_tokens ?? null,
		vendor_slug: vendorSlug,
		category_id: categoryId,
	};
}

// ---- OpenRouter public catalog: fallback context/metadata for providers
// whose /models endpoint carries no context_length (custom gateways etc.)
let orCatalog: Promise<Map<string, ORModel>> | null = null;
function orMap(): Promise<Map<string, ORModel>> {
	if (!orCatalog) {
		orCatalog = (async () => {
			const map = new Map<string, ORModel>();
			try {
				const r = await fetch('https://openrouter.ai/api/v1/models', {
					headers: { 'HTTP-Referer': 'https://zeruvo.online' },
				});
				if (r.ok) {
					const j = await r.json();
					for (const m of (j.data ?? []) as ORModel[]) {
						if (m.context_length == null) continue;
						const norm = m.id.toLowerCase().replace(/[^a-z0-9]/g, '');
						if (!map.has(m.id)) map.set(m.id, m);
						const short = m.id.split('/').pop() ?? m.id;
						// prefer the non-variant id for a short name ("x" over "x:free")
						if (!map.has(short) && !short.includes(':')) map.set(short, m);
						if (!map.has(`bare:${short.split(':')[0]}`)) map.set(`bare:${short.split(':')[0]}`, m);
						if (!map.has(`norm:${norm}`)) map.set(`norm:${norm}`, m);
					}
				}
			} catch {
				// catalog unavailable — enrichment silently skips
			}
			return map;
		})();
	}
	return orCatalog;
}

async function orLookup(modelId: string): Promise<ORModel | null> {
	const map = await orMap();
	if (map.size === 0) return null;
	const short = modelId.split('/').pop() ?? modelId;
	return map.get(modelId)
		?? map.get(short)
		?? map.get(`bare:${short.split(':')[0]}`)
		?? map.get(`norm:${modelId.toLowerCase().replace(/[^a-z0-9]/g, '')}`)
		?? null;
}

Deno.serve(async (req) => {
// CORS: the SPA calls these functions directly from the browser
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kashier-signature',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

	let body: { provider_id?: string; action?: string };
	try { body = await req.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400, headers: CORS_HEADERS }) }

	// stand-alone sweep: fill every model that lacks a context window from
	// OpenRouter's public catalog (no provider/key needed)
	if (body.action === 'enrich_context') {
		const { data: targets } = await admin
			.from('models')
			.select('id,upstream_model_id,context_window,max_output_tokens')
			.is('context_window', null)
			.limit(2000);
		let filled = 0;
		for (const t of targets ?? []) {
			const or = await orLookup(t.upstream_model_id);
			if (!or) continue;
			const patch: Record<string, unknown> = { context_window: or.context_length };
			if (t.max_output_tokens == null && or.top_provider?.max_completion_tokens != null) {
				patch.max_output_tokens = or.top_provider.max_completion_tokens;
			}
			const { error } = await admin.from('models').update(patch).eq('id', t.id);
			if (!error) filled++;
		}
		return Response.json({ scanned: targets?.length ?? 0, enriched: filled }, { headers: CORS_HEADERS });
	}

	if (!body.provider_id) return Response.json({ error: 'provider_id required' }, { status: 400, headers: CORS_HEADERS })

	const { data: provider } = await admin.from('providers').select('*').eq('id', body.provider_id).single();
	if (!provider) return Response.json({ error: 'provider not found' }, { status: 404, headers: CORS_HEADERS })

	const { data: keys } = await admin.from('provider_keys')
		.select('id,encrypted_key,label')
		.eq('provider_id', body.provider_id);

	// probe every key; keep the first decryptable one for the catalog pull
	const keyResults: Array<{ label: string; ok: boolean; detail: string }> = [];
	let apiKey: string | null = null;
	for (const k of keys ?? []) {
		if (apiKey) break;
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
		.select('id,upstream_model_id,enabled_for_users,usage_multiplier,tags,context_window,max_output_tokens')
		.eq('provider_id', body.provider_id);
	const byUpstream = new Map((existing ?? []).map((m) => [m.upstream_model_id, m]));

	// vendor catalog: each upstream id prefix maps to a canonical provider,
	// and every vendor owns an auto-managed model category
	const { data: vendors } = await admin.from('ai_providers').select('slug,display_name,prefixes,sort_order');
	const vendorList = vendors ?? [];
	// unprefixed ids (custom OpenAI-compatible endpoints) fall back to
	// keyword matching so models still get a real vendor + icon
	const KEYWORDS: Array<[RegExp, string]> = [
		[/claude/i, 'anthropic'],
		[/gpt|chatgpt|(^|\/)o[134](-|$)|davinci|codex/i, 'openai'],
		[/gemini|gemma|palm/i, 'google'],
		[/llama|llava/i, 'meta-llama'],
		[/deepseek/i, 'deepseek'],
		[/grok/i, 'x-ai'],
		[/mistral|mixtral|magistral|pixtral|devstral/i, 'mistralai'],
		[/qwen|qwq/i, 'qwen'],
		[/kimi/i, 'moonshotai'],
		[/glm|chatglm/i, 'z-ai'],
		[/minimax|abab/i, 'minimax'],
		[/phi[- ]?\d/i, 'microsoft'],
		[/nova[- ]?(micro|lite|pro|premier)|titan/i, 'amazon'],
		[/command[- ]?r/i, 'cohere'],
		[/sonar/i, 'perplexity'],
		[/ernie/i, 'baidu'],
		[/doubao|seed-?oss|seedream/i, 'bytedance'],
		[/hunyuan/i, 'tencent'],
	];
	function vendorFor(modelId: string): { slug: string; name: string } {
		const prefix = modelId.split('/')[0] ?? '';
		const hit = vendorList.find((v) => v.slug !== 'other' && (v.prefixes ?? []).includes(prefix));
		if (hit) return { slug: hit.slug, name: hit.display_name };
		const kw = KEYWORDS.find(([re]) => re.test(modelId));
		if (kw) {
			const kv = vendorList.find((v) => v.slug === kw[1]);
			if (kv) return { slug: kv.slug, name: kv.display_name };
		}
		return { slug: 'other', name: 'Other' };
	}
	const categoryIds = new Map<string, string>();
	async function categoryIdFor(slug: string, name: string, sortOrder: number): Promise<string | null> {
		const cached = categoryIds.get(slug);
		if (cached) return cached;
		const { data: cat } = await admin.from('model_categories')
			.select('id').eq('name', `vendor:${slug}`).maybeSingle();
		let id = cat?.id ?? null;
		if (!id) {
			const { data: created } = await admin.from('model_categories')
				.insert({ name: `vendor:${slug}`, icon_url: slug, sort_order: sortOrder })
				.select('id').single();
			id = created?.id ?? null;
		}
		if (id) categoryIds.set(slug, id);
		return id;
	}

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

		const vendor = vendorFor(m.id);
		const catId = await categoryIdFor(vendor.slug, vendor.name, 50);

		const row: any = isRich
			? {
				provider_id: body.provider_id,
				upstream_model_id: m.id,
				slug,
				...metadataRow(m as unknown as ORModel, vendor.slug, catId),
			}
			: {
				provider_id: body.provider_id,
				upstream_model_id: m.id,
				slug,
				display_name: m.id,
				vendor_slug: vendor.slug,
				category_id: catId,
			};

		// provider catalog lacks context metadata? fall back to OpenRouter's
		// public catalog (fills the row for inserts and null-preserved updates)
		if (row.context_window == null) {
			const or = await orLookup(m.id);
			if (or) {
				row.context_window = or.context_length ?? null;
				if (row.max_output_tokens == null) row.max_output_tokens = or.top_provider?.max_completion_tokens ?? null;
			}
		}

		if (!prev) {
			row.enabled_for_users = false;
			row.usage_multiplier = 1;
			rows.push(row);
			added++;
		} else if (isRich) {
			// refresh metadata but preserve admin choices (pricing, enablement)
			// and admin-set context/max-output — a sync only FILLS missing values
			const { error: updErr } = await admin.from('models').update({
				display_name: row.display_name,
				description: row.description,
				context_window: prev.context_window ?? row.context_window,
				tags: row.tags,
				input_modalities: row.input_modalities,
				output_modalities: row.output_modalities,
				supports_reasoning: row.supports_reasoning,
				supports_effort: row.supports_effort,
				max_output_tokens: prev.max_output_tokens ?? row.max_output_tokens,
				vendor_slug: row.vendor_slug,
				category_id: row.category_id,
			}).eq('id', prev.id);
			if (updErr) console.error('metadata update failed', m.id, updErr.message);
			else updatedMeta++;
		}
	}

	if (rows.length) {
		const { error: insErr } = await admin.from('models').insert(rows);
		if (insErr) {
			console.error('bulk insert failed', insErr.message, 'attempting one-by-one');
			// fallback: insert one by one; on a global slug collision (same slug
			// already held by a model in another provider) retry with a suffix
			// instead of skipping — the public /models/:slug page needs unique slugs.
			let inserted = 0;
			for (const r of rows) {
				const { error } = await admin.from('models').insert(r);
				if (!error) { inserted++; continue; }
				if (error.code === '23505' && /models_slug_key/.test(error.message)) {
					const { error: retryErr } = await admin.from('models').insert({
						...r,
						slug: `${r.slug}-${crypto.randomUUID().slice(0, 8)}`,
					});
					if (!retryErr) inserted++;
					else console.error('skip', r.upstream_model_id, retryErr.message);
				} else {
					console.error('skip', r.upstream_model_id, error.message);
				}
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
