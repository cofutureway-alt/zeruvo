-- ============================================================
-- ONE ENABLED COPY PER PUBLIC MODEL: the same upstream_model_id exists
-- as a row per provider (claude-fable-5 on old/pi.b.ai/Token hurber...).
-- resolve_model_v2 uses only ONE enabled row at runtime, so multiple
-- enabled copies were invisible duplication — and hiding one copy (the
-- admin's "delete") left the model showing because another provider's
-- row stayed enabled. This trigger makes visibility catalog-wide:
-- enabling any row auto-hides the other rows of the same model id.
-- (Custom aliases have unique public ids, so they are never touched.)
-- ============================================================

create or replace function public.enforce_single_enabled_copy()
returns trigger
language plpgsql
as $fn$
begin
  if new.enabled_for_users
     and (tg_op = 'INSERT' or old.enabled_for_users is distinct from new.enabled_for_users) then
    update public.models
    set enabled_for_users = false
    where upstream_model_id = new.upstream_model_id
      and id <> new.id
      and enabled_for_users;
  end if;
  return new;
end;
$fn$;

drop trigger if exists models_one_enabled_copy on public.models;
create trigger models_one_enabled_copy
  before insert or update of enabled_for_users on public.models
  for each row execute function public.enforce_single_enabled_copy();

-- normalize existing data: where several copies of one public id are
-- enabled, keep the earliest-created (original) enabled and hide the rest
update public.models m
set enabled_for_users = false
where m.enabled_for_users
  and exists (
    select 1 from public.models o
    where o.upstream_model_id = m.upstream_model_id
      and o.enabled_for_users
      and (o.created_at, o.id) < (m.created_at, m.id)
  );

notify pgrst, 'reload schema';
