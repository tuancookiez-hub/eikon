insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('eikon-artifacts', 'eikon-artifacts', false, 104857600, null),
  ('eikon-staging', 'eikon-staging', false, 104857600, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy eikon_staging_select_own on storage.objects
for select to authenticated using (
  bucket_id = 'eikon-staging'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy eikon_staging_insert_own on storage.objects
for insert to authenticated with check (
  bucket_id = 'eikon-staging'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy eikon_staging_update_own on storage.objects
for update to authenticated using (
  bucket_id = 'eikon-staging'
  and (storage.foldername(name))[1] = auth.uid()::text
) with check (
  bucket_id = 'eikon-staging'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy eikon_staging_delete_own on storage.objects
for delete to authenticated using (
  bucket_id = 'eikon-staging'
  and (storage.foldername(name))[1] = auth.uid()::text
);
