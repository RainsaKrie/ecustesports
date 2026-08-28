create table if not exists public.app_documents (
  scope text not null check (scope in ('site', 'event')),
  event_id text not null,
  name text not null,
  payload jsonb not null,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (scope, event_id, name)
);

create index if not exists app_documents_event_id_idx
  on public.app_documents (event_id)
  where scope = 'event';

create table if not exists public.operation_audit (
  id bigint generated always as identity primary key,
  event_id text,
  actor_type text not null,
  actor_hash text,
  action text not null,
  target text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists operation_audit_event_created_idx
  on public.operation_audit (event_id, created_at desc);

create table if not exists public.rate_limit_buckets (
  key_hash text not null,
  action text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (key_hash, action, window_started_at)
);

alter table public.app_documents enable row level security;
alter table public.operation_audit enable row level security;
alter table public.rate_limit_buckets enable row level security;

revoke all on table public.app_documents from anon, authenticated;
revoke all on table public.operation_audit from anon, authenticated;
revoke all on table public.rate_limit_buckets from anon, authenticated;

grant select, insert, update, delete on table public.app_documents to service_role;
grant select, insert, update, delete on table public.operation_audit to service_role;
grant select, insert, update, delete on table public.rate_limit_buckets to service_role;
grant usage, select on sequence public.operation_audit_id_seq to service_role;

create or replace function public.consume_rate_limit(
  p_key_hash text,
  p_action text,
  p_window_seconds integer,
  p_limit integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  bucket_start timestamptz;
  next_reset timestamptz;
  current_count integer;
begin
  if p_window_seconds < 1 or p_window_seconds > 86400 or p_limit < 1 or p_limit > 10000 then
    raise exception 'invalid rate limit policy';
  end if;
  if length(p_key_hash) <> 64 or length(p_action) < 1 or length(p_action) > 80 then
    raise exception 'invalid rate limit identity';
  end if;

  bucket_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  next_reset := bucket_start + make_interval(secs => p_window_seconds);

  delete from public.rate_limit_buckets
  where key_hash = p_key_hash
    and action = p_action
    and window_started_at < now() - interval '2 days';

  insert into public.rate_limit_buckets (
    key_hash,
    action,
    window_started_at,
    request_count,
    updated_at
  ) values (
    p_key_hash,
    p_action,
    bucket_start,
    1,
    now()
  )
  on conflict (key_hash, action, window_started_at)
  do update set
    request_count = public.rate_limit_buckets.request_count + 1,
    updated_at = now()
  returning request_count into current_count;

  return query select
    current_count <= p_limit,
    greatest(0, p_limit - current_count),
    next_reset;
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-assets',
  'event-assets',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
