begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ca828c1a-c572-4746-955c-47051592e4e0', true);

select public.is_admin() as is_admin_res,
       (select count(*) from public.models_admin_view) as view_rows,
       (select count(distinct vendor_slug) from public.models_admin_view) as view_vendors,
       (select count(*) from public.models) as base_models;
rollback;
