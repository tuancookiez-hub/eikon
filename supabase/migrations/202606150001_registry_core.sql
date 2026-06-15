create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique check (handle ~ '^[a-z0-9][a-z0-9_.-]{1,62}$'),
  display_name text check (display_name is null or length(display_name) <= 120),
  avatar_url text,
  github_user_id text,
  github_login text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  namespace text not null check (namespace ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  name text not null check (name ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  canonical_id text not null,
  source_key text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  origin_kind text not null default 'supabase' check (origin_kind in ('supabase', 'github-mirror')),
  origin_repo text,
  origin_ref text,
  origin_commit_sha text,
  submit_pr_url text,
  github_user_id text,
  github_login_at_submit text,
  current_version_id uuid,
  visibility text not null default 'public' check (visibility in ('public', 'delisted', 'draft')),
  delisted_at timestamptz,
  delisted_by uuid references public.profiles(id) on delete set null,
  mirror_missing_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (namespace, name),
  unique (canonical_id)
);

create table if not exists public.package_versions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id) on delete cascade,
  version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+([-+][A-Za-z0-9_.-]+)?$'),
  manifest jsonb not null,
  manifest_digest text not null check (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  runtime_digest text not null check (runtime_digest ~ '^sha256:[a-f0-9]{64}$'),
  runtime_size bigint not null check (runtime_size >= 0),
  runtime_encoding text check (runtime_encoding is null or runtime_encoding in ('identity', 'gzip')),
  runtime_decoded_size bigint check (runtime_decoded_size is null or runtime_decoded_size >= 0),
  runtime_decoded_digest text check (runtime_decoded_digest is null or runtime_decoded_digest ~ '^sha256:[a-f0-9]{64}$'),
  poster text,
  published_by uuid references public.profiles(id) on delete set null,
  status text not null default 'published' check (status in ('published', 'delisted', 'quarantined')),
  published_at timestamptz not null default now(),
  unique (package_id, version)
);

alter table public.packages
  drop constraint if exists packages_current_version_id_fkey;
alter table public.packages
  add constraint packages_current_version_id_fkey
  foreign key (current_version_id) references public.package_versions(id) on delete set null;

create table if not exists public.package_files (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.package_versions(id) on delete cascade,
  path text not null check (path !~ '(^/|(^|/)\.\.(/|$)|\\\\)' and length(path) <= 1024),
  role text not null,
  media_type text not null,
  storage_bucket text not null,
  storage_path text not null check (storage_path !~ '(^/|(^|/)\.\.(/|$)|\\\\)' and length(storage_path) <= 2048),
  digest text not null check (digest ~ '^sha256:[a-f0-9]{64}$'),
  size bigint not null check (size >= 0),
  encoding text check (encoding is null or encoding in ('identity', 'gzip')),
  decoded_size bigint check (decoded_size is null or decoded_size >= 0),
  decoded_digest text check (decoded_digest is null or decoded_digest ~ '^sha256:[a-f0-9]{64}$'),
  signal text,
  created_at timestamptz not null default now(),
  unique (version_id, path)
);

create table if not exists public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  package_id uuid references public.packages(id) on delete set null,
  status text not null default 'created' check (status in ('created', 'uploaded', 'finalized', 'failed', 'expired', 'cancelled')),
  requested_manifest jsonb,
  allowed_files jsonb not null default '[]'::jsonb,
  max_bytes bigint not null default 33554432 check (max_bytes > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  finalized_at timestamptz,
  error text
);

create table if not exists public.likes (
  package_id uuid not null references public.packages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (package_id, user_id)
);

create table if not exists public.platform_events (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id) on delete cascade,
  version_id uuid references public.package_versions(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('download', 'share')),
  source text not null default 'web' check (length(source) <= 64),
  rate_key text,
  created_at timestamptz not null default now()
);

create table if not exists public.package_stats (
  package_id uuid primary key references public.packages(id) on delete cascade,
  download_count bigint not null default 0 check (download_count >= 0),
  like_count bigint not null default 0 check (like_count >= 0),
  share_count bigint not null default 0 check (share_count >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.delist_audit (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.github_mirror_runs (
  id uuid primary key default gen_random_uuid(),
  repo text not null,
  ref text not null default 'main',
  commit_sha text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  imported_count integer not null default 0,
  quarantined_count integer not null default 0,
  error text
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists packages_touch_updated_at on public.packages;
create trigger packages_touch_updated_at before update on public.packages
for each row execute function public.touch_updated_at();
