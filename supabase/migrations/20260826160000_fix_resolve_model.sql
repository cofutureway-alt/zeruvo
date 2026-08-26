-- Fix resolve_model: match on upstream_model_id ONLY.
-- The old slug-equality condition broke after slug sanitization
-- (slugs replace '/' with '-'; upstream ids keep '/').
create or replace function public.resolve_model(p_upstream_model text)
returns table (
  model_id uuid,
  provider_id uuid,
  provider_kind text,
  provider_base_url text,
  usage_multiplier numeric,
  context_window int,
  enabled boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select m.id, m.provider_id, pr.kind, pr.base_url,
         m.usage_multiplier, m.context_window, m.enabled_for_users
  from public.models m
  join public.providers pr on pr.id = m.provider_id
  where m.upstream_model_id = p_upstream_model
  limit 1;
$$;

revoke all on function public.resolve_model(text) from public, anon, authenticated;

-- revive_provider_key: clears a stale dead-until marker (self-healing path)
create or replace function public.revive_provider_key(p_key_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.provider_keys
  set dead_until = null, last_error_code = null
  where id = p_key_id;
$$;

revoke all on function public.revive_provider_key(uuid) from public, anon, authenticated;
