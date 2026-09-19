-- ============================================================
-- PAY-AS-YOU-GO pricing + rich model metadata + vendor catalog.
--
-- 1) models: per-token USD prices (per 1M), modality/capability
--    metadata, custom-model (alias) support.
-- 2) model_discounts: scoped, expiring discounts (percent or fixed).
-- 3) ai_providers: canonical vendor catalog (auto-assigned from the
--    upstream id prefix) — each vendor gets its own category
--    automatically.
-- 4) effective_model_prices(): active-discount-aware price resolution
--    used by the catalog, cards and the billing engine.
-- ============================================================

-- ---------- models: PAYG pricing + metadata ----------
alter table public.models
  add column if not exists payg_enabled boolean not null default false,
  add column if not exists input_price_per_m numeric(12,6),
  add column if not exists output_price_per_m numeric(12,6),
  add column if not exists cache_read_price_per_m numeric(12,6) default 0,
  add column if not exists cache_write_price_per_m numeric(12,6) default 0,
  add column if not exists input_modalities text[] not null default '{text}',
  add column if not exists output_modalities text[] not null default '{text}',
  add column if not exists supports_reasoning boolean not null default false,
  add column if not exists supports_effort boolean not null default false,
  add column if not exists max_output_tokens int,
  add column if not exists quality_score numeric(3,2)
    check (quality_score is null or (quality_score >= 0 and quality_score <= 5)),
  add column if not exists is_featured boolean not null default false,
  add column if not exists is_custom boolean not null default false,
  add column if not exists parent_model_id uuid references public.models(id) on delete cascade,
  add column if not exists system_prompt text,
  add column if not exists vendor_slug text;

-- A PAYG-enabled model must carry at least one non-null token price,
-- otherwise every request would be free money.
alter table public.models
  add constraint models_payg_needs_price
  check (not payg_enabled or input_price_per_m is not null or output_price_per_m is not null);

create index if not exists models_vendor_idx on public.models (vendor_slug);
create index if not exists models_parent_idx on public.models (parent_model_id);

-- Custom (aliased) models: a public id pointing at a real base model.
alter table public.models
  add constraint models_custom_has_parent
  check (not is_custom or parent_model_id is not null);

-- ---------- model discounts ----------
create table public.model_discounts (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.models(id) on delete cascade,
  applies_to text not null default 'all'
    check (applies_to in ('input','output','cache_read','cache_write','all')),
  kind text not null default 'percent' check (kind in ('percent','fixed')),
  value numeric(12,4) not null check (value >= 0),
  valid_from timestamptz not null default now(),
  valid_to timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (valid_to > valid_from)
);
create index model_discounts_model_idx on public.model_discounts (model_id, active);
alter table public.model_discounts enable row level security;
-- public read of ACTIVE discounts only (cards show the badge); admin manages all
create policy "model_discounts: read active" on public.model_discounts
  for select using (active = true and now() between valid_from and valid_to);
create policy "model_discounts: admin write" on public.model_discounts
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- canonical vendor catalog ----------
create table public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  icon_key text not null default 'other',
  prefixes text[] not null default '{}',
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
alter table public.ai_providers enable row level security;
create policy "ai_providers: read" on public.ai_providers for select using (true);
create policy "ai_providers: admin write" on public.ai_providers
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.ai_providers (slug, display_name, icon_key, prefixes, sort_order) values
  ('openai',      'OpenAI',            'openai',      '{openai}',                 1),
  ('anthropic',   'Anthropic',         'anthropic',   '{anthropic}',              2),
  ('google',      'Google',            'google',      '{google,google-vertex}',   3),
  ('meta-llama',  'Meta Llama',        'meta',        '{meta-llama,meta}',        4),
  ('deepseek',    'DeepSeek',          'deepseek',    '{deepseek}',               5),
  ('x-ai',        'xAI (Grok)',        'xai',         '{x-ai,xai}',               6),
  ('mistralai',   'Mistral AI',        'mistral',     '{mistralai,mistral}',      7),
  ('qwen',        'Alibaba Qwen',      'qwen',        '{qwen,qwen-alibaba}',      8),
  ('moonshotai',  'MoonshotAI (Kimi)', 'moonshot',    '{moonshotai,moonshot}',    9),
  ('z-ai',        'Z.ai (GLM)',        'zai',         '{z-ai,zhipuai,thudm,zhipu}',10),
  ('minimax',     'MiniMax',           'minimax',     '{minimax}',                11),
  ('ollama',      'Ollama',            'ollama',      '{ollama}',                 12),
  ('microsoft',   'Microsoft',         'microsoft',   '{microsoft}',              13),
  ('nvidia',      'NVIDIA',            'nvidia',      '{nvidia}',                 14),
  ('cohere',      'Cohere',            'cohere',      '{cohere}',                 15),
  ('perplexity',  'Perplexity',        'perplexity',  '{perplexity,pplx}',        16),
  ('amazon',      'Amazon (Nova)',     'amazon',      '{amazon,amazon-bedrock}',  17),
  ('ai2',         'Allen AI',          'ai2',         '{ai2,allenai}',            18),
  ('baidu',       'Baidu',             'baidu',       '{baidu}',                  19),
  ('bytedance',   'ByteDance',         'bytedance',   '{bytedance}',              20),
  ('tencent',     'Tencent',           'tencent',     '{tencent}',                21),
  ('xiaomi',      'Xiaomi',            'xiaomi',      '{xiaomi}',                 22),
  ('stepfun-ai',  'StepFun',           'stepfun',     '{stepfun-ai,stepfun}',     23),
  ('01-ai',       '01.AI (Yi)',        'yi',          '{01-ai,01ai}',             24),
  ('ai21',        'AI21 Labs',         'ai21',        '{ai21}',                   25),
  ('liquid',      'Liquid AI',         'liquid',      '{liquid,liquidai}',        26),
  ('openrouter',  'OpenRouter',        'openrouter',  '{openrouter}',             27),
  ('other',       'Other',             'other',       '{}',                       999)
on conflict (slug) do nothing;

-- ---------- vendor auto-categorization ----------
-- Each vendor owns a model category (icon rendered from icon_key in the app).
create or replace function public.sync_vendor_categories()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  for v in select * from public.ai_providers loop
    insert into public.model_categories (name, icon_url, sort_order)
    values ('vendor:' || v.slug, v.icon_key, v.sort_order)
    on conflict (name) do update set icon_url = excluded.icon_url;

    update public.models m
    set vendor_slug = v.slug,
        category_id = (select c.id from public.model_categories c where c.name = 'vendor:' || v.slug)
    where v.slug <> 'other'
      and m.vendor_slug is null
      and split_part(m.upstream_model_id, '/', 1) = any (v.prefixes);
  end loop;

  -- anything unmatched falls back to the "Other" vendor + category
  update public.models m
  set vendor_slug = 'other',
      category_id = (select c.id from public.model_categories c where c.name = 'vendor:other')
  where m.vendor_slug is null;
end;
$$;

select public.sync_vendor_categories();

-- ---------- effective (discount-aware) prices ----------
create or replace function public.effective_model_prices(
  p_model_id uuid,
  p_at timestamptz default now()
)
returns table (
  input_price numeric,
  output_price numeric,
  cache_read_price numeric,
  cache_write_price numeric,
  discount_percent numeric
)
language sql
stable
set search_path = public
as $$
  with base as (
    select m.input_price_per_m  AS base_in,
           m.output_price_per_m AS base_out,
           m.cache_read_price_per_m AS base_cr,
           m.cache_write_price_per_m AS base_cw
    from public.models m where m.id = p_model_id
  ),
  disc as (
    select
      max(case when d.applies_to in ('input','all') then
        case when d.kind = 'percent' then d.value
             else case when b.base_in > 0 then least(d.value / b.base_in * 100, 100) else 100 end end
      end) as in_pct,
      max(case when d.applies_to in ('output','all') then
        case when d.kind = 'percent' then d.value
             else case when b.base_out > 0 then least(d.value / b.base_out * 100, 100) else 100 end end
      end) as out_pct,
      max(case when d.applies_to in ('cache_read','all') then
        case when d.kind = 'percent' then d.value
             else case when b.base_cr > 0 then least(d.value / b.base_cr * 100, 100) else 100 end end
      end) as cr_pct,
      max(case when d.applies_to in ('cache_write','all') then
        case when d.kind = 'percent' then d.value
             else case when b.base_cw > 0 then least(d.value / b.base_cw * 100, 100) else 100 end end
      end) as cw_pct
    from public.model_discounts d
    cross join base b
    where d.model_id = p_model_id
      and d.active
      and p_at between d.valid_from and d.valid_to
  )
  select
    greatest(round(b.base_in  * (1 - coalesce(d.in_pct, 0) / 100.0), 6), 0),
    greatest(round(b.base_out * (1 - coalesce(d.out_pct, 0) / 100.0), 6), 0),
    greatest(round(b.base_cr  * (1 - coalesce(d.cr_pct, 0) / 100.0), 6), 0),
    greatest(round(b.base_cw  * (1 - coalesce(d.cw_pct, 0) / 100.0), 6), 0),
    greatest(coalesce(d.in_pct,0), coalesce(d.out_pct,0), coalesce(d.cr_pct,0), coalesce(d.cw_pct,0))
  from base b cross join disc d
$$;

revoke all on function public.effective_model_prices(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.effective_model_prices(uuid, timestamptz) to anon, authenticated, service_role;

-- ---------- public catalog view (cards + pricing page) ----------
-- ttft_ms lands officially in the billing-engine migration, but the view
-- below reads it — create it here when this file runs first.
alter table public.request_logs add column if not exists ttft_ms int;

-- Joins vendor info, effective prices, "is_priced" and live throughput
-- stats. Aggregate-only: exposes no user data (security_invoker=false runs
-- it as the owner, bypassing request_logs RLS for the aggregate stats).
create or replace view public.models_public_view as
select
  m.id, m.slug, m.display_name, m.description, m.context_window,
  m.upstream_model_id, m.usage_multiplier, m.enabled_for_users,
  m.payg_enabled, m.tags, m.vendor_slug, m.quality_score, m.is_featured,
  m.is_custom, m.parent_model_id,
  m.input_modalities, m.output_modalities,
  m.supports_reasoning, m.supports_effort, m.max_output_tokens,
  v.display_name as vendor_name, v.icon_key as vendor_icon,
  ep.input_price, ep.output_price, ep.cache_read_price, ep.cache_write_price,
  ep.discount_percent,
  (m.payg_enabled or m.usage_multiplier > 1 or exists (
     select 1 from public.plan_models pm
     join public.plans p on p.id = pm.plan_id and p.active
     where pm.model_id = m.id)
  ) as is_priced,
  st.tok_per_s, st.avg_ttft_ms, st.requests_30d
from public.models m
left join public.ai_providers v on v.slug = m.vendor_slug
cross join lateral public.effective_model_prices(m.id) ep
left join lateral (
  select avg(case when l.latency_ms > 0 and l.tokens_out > 0
                 then l.tokens_out * 1000.0 / l.latency_ms end)::numeric(10,1) as tok_per_s,
         avg(l.ttft_ms) filter (where l.ttft_ms > 0)::numeric(10,1) as avg_ttft_ms,
         count(*)::int as requests_30d
  from public.request_logs l
  where l.model_id = m.id and l.created_at > now() - interval '30 days'
) st on true;

grant select on public.models_public_view to anon, authenticated;
