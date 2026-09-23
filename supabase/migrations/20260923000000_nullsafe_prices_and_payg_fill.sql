-- ============================================================
-- 1) effective_model_prices NULL-safety: greatest(NULL, 0) collapses to
--    0 in Postgres, so a model with NO payg base prices got effective
--    prices of $0/$0 — and the catalog cards rendered it as "Free".
--    Keep NULL for unpriced buckets (0 stays only for genuine free).
-- 2) Enable PAYG with sensible prices for every user-visible model that
--    had none, mirroring the existing price ladder:
--      ×1   GLM            0.015 / 0.40
--      ×10  budget cluster 0.05  / 0.05-1.00
--      ×20  Atria          0.50  / 0.50
--      ×50  Opus aliases   2.50  / 10.00   (cache 0.50)
--      ×100 fable-5        10.00 / 40.00   (cache 0.50)
--    → ×50 Anthropic rows mirror the Opus anchor exactly
--    → ×15 MiniMax sits between ×10 premium and ×20 Atria
--    → ×5 rows sit between GLM and the budget cluster
-- ============================================================

create or replace function public.effective_model_prices(p_model_id uuid, p_at timestamp with time zone default now())
 returns table(input_price numeric, output_price numeric, cache_read_price numeric, cache_write_price numeric, discount_percent numeric)
 language sql stable
 set search_path = 'public'
as $function$
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
      and p_at >= d.valid_from
      and (d.valid_to is null or p_at <= d.valid_to)
  )
  select
    case when b.base_in  is null then null
         else greatest(round(b.base_in  * (1 - coalesce(d.in_pct, 0) / 100.0), 6), 0) end,
    case when b.base_out is null then null
         else greatest(round(b.base_out * (1 - coalesce(d.out_pct, 0) / 100.0), 6), 0) end,
    case when b.base_cr  is null then null
         else greatest(round(b.base_cr  * (1 - coalesce(d.cr_pct, 0) / 100.0), 6), 0) end,
    case when b.base_cw  is null then null
         else greatest(round(b.base_cw  * (1 - coalesce(d.cw_pct, 0) / 100.0), 6), 0) end,
    greatest(coalesce(d.in_pct,0), coalesce(d.out_pct,0), coalesce(d.cr_pct,0), coalesce(d.cw_pct,0))
  from base b cross join disc d
$function$;

revoke all on function public.effective_model_prices(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.effective_model_prices(uuid, timestamptz) to anon, authenticated, service_role;

-- 2) enable + price every visible-but-unpriced model (never touches the
--    hidden catalog rows sharing these ids, only the enabled unpriced ones)
update public.models
set payg_enabled = true,
    input_price_per_m = case
      when upstream_model_id in ('claude-opus-4.5','claude-opus-4.6','claude-opus-4.7','claude-sonnet-4.6') then 2.50
      when upstream_model_id = 'minimax/minimax-m3' then 0.60
      when upstream_model_id = 'minimax-m3'         then 0.15
      when upstream_model_id = 'gpt-5.6-luna'       then 0.50
    end,
    output_price_per_m = case
      when upstream_model_id in ('claude-opus-4.5','claude-opus-4.6','claude-opus-4.7','claude-sonnet-4.6') then 10.00
      when upstream_model_id = 'minimax/minimax-m3' then 1.60
      when upstream_model_id = 'minimax-m3'         then 0.50
      when upstream_model_id = 'gpt-5.6-luna'       then 1.50
    end,
    cache_read_price_per_m = case
      when upstream_model_id in ('claude-opus-4.5','claude-opus-4.6','claude-opus-4.7','claude-sonnet-4.6') then 0.50
      when upstream_model_id = 'minimax/minimax-m3' then 0.05
      when upstream_model_id = 'minimax-m3'         then 0.02
      when upstream_model_id = 'gpt-5.6-luna'       then 0.05
    end
where enabled_for_users = true
  and payg_enabled = false
  and input_price_per_m is null
  and upstream_model_id in (
    'claude-opus-4.5','claude-opus-4.6','claude-opus-4.7','claude-sonnet-4.6',
    'minimax/minimax-m3','minimax-m3','gpt-5.6-luna');

notify pgrst, 'reload schema';
