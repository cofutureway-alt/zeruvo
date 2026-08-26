-- Storage: public read + admin-only write on public-media bucket
-- (bucket itself created via Storage API)

create policy "public-media: public read"
on storage.objects for select
using (bucket_id = 'public-media');

create policy "public-media: admin insert"
on storage.objects for insert
with check (bucket_id = 'public-media' and public.is_admin());

create policy "public-media: admin update"
on storage.objects for update
using (bucket_id = 'public-media' and public.is_admin());

create policy "public-media: admin delete"
on storage.objects for delete
using (bucket_id = 'public-media' and public.is_admin());
