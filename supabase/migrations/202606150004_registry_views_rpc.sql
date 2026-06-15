create or replace view public.registry_catalog_entries as
select
  p.id as package_id,
  pv.id as version_id,
  p.canonical_id,
  p.namespace,
  p.name,
  pv.version,
  p.source_key,
  pv.manifest #>> '{display,title}' as title,
  pv.manifest #>> '{display,author}' as author,
  pv.manifest #>> '{display,description}' as description,
  pv.manifest #>> '{display,glyph}' as glyph,
  case
    when jsonb_typeof(pv.manifest #> '{display,tags}') = 'array'
    then pv.manifest #> '{display,tags}'
    else null
  end as tags,
  coalesce(pv.manifest #>> '{compatibility,eikon}', '>=1 <2') as compatibility_eikon,
  pv.poster,
  format('packages/%s/%s/%s.json', p.namespace, p.name, pv.version) as package_path,
  format('packages/%s/%s/index.json', p.namespace, p.name) as package_index_path,
  format('packages/%s/%s/blobs/sha256/%s', p.namespace, p.name, replace(pv.runtime_digest, 'sha256:', '')) as runtime_path,
  jsonb_strip_nulls(jsonb_build_object(
    'manifestDigest', pv.manifest_digest,
    'runtimeDigest', pv.runtime_digest,
    'runtimeSize', pv.runtime_size,
    'runtimeEncoding', pv.runtime_encoding,
    'runtimeDecodedSize', pv.runtime_decoded_size,
    'runtimeDecodedDigest', pv.runtime_decoded_digest
  )) as trust
from public.packages p
join public.package_versions pv on pv.id = p.current_version_id
where p.visibility = 'public'
  and p.delisted_at is null
  and pv.status = 'published';

grant select on public.registry_catalog_entries to anon, authenticated;

create or replace view public.registry_platform_metadata as
select
  p.id as package_id,
  p.canonical_id as catalog_id,
  p.source_key,
  p.created_by,
  p.origin_kind,
  p.submit_pr_url,
  coalesce(s.download_count, 0) as downloads,
  coalesce(s.like_count, 0) as likes,
  coalesce(s.share_count, 0) as shares
from public.packages p
left join public.package_stats s on s.package_id = p.id
where p.visibility = 'public' and p.delisted_at is null;

grant select on public.registry_platform_metadata to anon, authenticated;

create or replace function public.ensure_package_stats(pid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.package_stats(package_id) values (pid)
  on conflict (package_id) do nothing;
end;
$$;

create or replace function public.record_platform_event(pid uuid, kind text, event_source text default 'web', event_rate_key text default null)
returns public.package_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  out public.package_stats;
begin
  if kind not in ('download', 'share') then
    raise exception 'unsupported platform event: %', kind using errcode = '22023';
  end if;
  if not exists (select 1 from public.packages where id = pid and visibility = 'public' and delisted_at is null) then
    raise exception 'package not public' using errcode = '42501';
  end if;
  perform public.ensure_package_stats(pid);
  insert into public.platform_events(package_id, user_id, event_type, source, rate_key)
  values (pid, auth.uid(), kind, coalesce(event_source, 'web'), event_rate_key);
  if kind = 'download' then
    update public.package_stats set download_count = download_count + 1, updated_at = now() where package_id = pid returning * into out;
  else
    update public.package_stats set share_count = share_count + 1, updated_at = now() where package_id = pid returning * into out;
  end if;
  return out;
end;
$$;

grant execute on function public.record_platform_event(uuid, text, text, text) to anon, authenticated;

create or replace function public.toggle_like(pid uuid)
returns public.package_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  out public.package_stats;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.packages where id = pid and visibility = 'public' and delisted_at is null) then
    raise exception 'package not public' using errcode = '42501';
  end if;
  perform public.ensure_package_stats(pid);
  if exists (select 1 from public.likes where package_id = pid and user_id = uid) then
    delete from public.likes where package_id = pid and user_id = uid;
    update public.package_stats set like_count = greatest(like_count - 1, 0), updated_at = now() where package_id = pid returning * into out;
  else
    insert into public.likes(package_id, user_id) values (pid, uid);
    update public.package_stats set like_count = like_count + 1, updated_at = now() where package_id = pid returning * into out;
  end if;
  return out;
end;
$$;

grant execute on function public.toggle_like(uuid) to authenticated;

create or replace function public.request_package_delist(pid uuid, why text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_package(pid) then
    raise exception 'not authorized to delist package' using errcode = '42501';
  end if;
  update public.packages
  set visibility = 'delisted', delisted_at = now(), delisted_by = auth.uid()
  where id = pid;
  insert into public.delist_audit(package_id, requested_by, reason)
  values (pid, auth.uid(), why);
end;
$$;

grant execute on function public.request_package_delist(uuid, text) to authenticated;
