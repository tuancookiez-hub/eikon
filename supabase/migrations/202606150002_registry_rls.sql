alter table public.profiles enable row level security;
alter table public.packages enable row level security;
alter table public.package_versions enable row level security;
alter table public.package_files enable row level security;
alter table public.upload_sessions enable row level security;
alter table public.likes enable row level security;
alter table public.platform_events enable row level security;
alter table public.package_stats enable row level security;
alter table public.delist_audit enable row level security;
alter table public.github_mirror_runs enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.packages from anon, authenticated;
revoke all on public.package_versions from anon, authenticated;
revoke all on public.package_files from anon, authenticated;
revoke all on public.upload_sessions from anon, authenticated;
revoke all on public.likes from anon, authenticated;
revoke all on public.platform_events from anon, authenticated;
revoke all on public.package_stats from anon, authenticated;
revoke all on public.delist_audit from anon, authenticated;
revoke all on public.github_mirror_runs from anon, authenticated;

grant select, insert on public.profiles to authenticated;
grant update (handle, display_name, avatar_url) on public.profiles to authenticated;
grant select, insert, delete on public.likes to authenticated;
grant insert on public.platform_events to anon, authenticated;

create policy profiles_public_read on public.profiles
for select using (true);

create policy profiles_insert_self on public.profiles
for insert with check (id = auth.uid());

create policy profiles_update_self_safe on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

create policy likes_read_self on public.likes
for select using (user_id = auth.uid());

create policy likes_insert_self_public_package on public.likes
for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.packages p
    where p.id = package_id and p.visibility = 'public' and p.delisted_at is null
  )
);

create policy likes_delete_self on public.likes
for delete using (user_id = auth.uid());

create policy events_insert_public_package on public.platform_events
for insert with check (
  event_type in ('download', 'share')
  and exists (
    select 1 from public.packages p
    where p.id = package_id and p.visibility = 'public' and p.delisted_at is null
  )
  and (user_id is null or user_id = auth.uid())
);

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'eikon_admin')::boolean, false)
$$;

create or replace function public.can_manage_package(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1 from public.packages p
      where p.id = pid and p.created_by = auth.uid()
    )
    or exists (
      select 1 from public.packages p
      join auth.identities i on i.user_id = auth.uid()
      where p.id = pid
        and i.provider = 'github'
        and (
          i.identity_data ->> 'user_name' = p.github_login_at_submit
          or i.identity_data ->> 'preferred_username' = p.github_login_at_submit
          or i.identity_data ->> 'sub' = p.github_user_id
        )
    )
$$;

grant execute on function public.can_manage_package(uuid) to authenticated;
