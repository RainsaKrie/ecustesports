-- =====================
-- 新建 Supabase 项目初始化：第 1 步（共 2 步）
--
-- 用途：给 Vercel Preview 单独准备数据库时，在一个全新的空项目上执行一次。
-- 内容 = 依次拼接以下三个已提交的迁移文件，顺序不可调换：
--   1. supabase/migrations/202608280001_gate6_data_store.sql   （建表 + 限流函数 + 公开素材桶）
--   2. supabase/migrations/202609060001_rpt03_match_evidence.sql（建私有凭证桶）
--   3. supabase/migrations/202609100001_rpt08_atomic_documents.sql（建原子批写函数）
--
-- 全部语句幂等（if not exists / or replace / on conflict），在已初始化过的库上重复执行也安全。
-- 期望结果：`Success. No rows returned`。
-- 第 2 步见 supabase/verification/20260910_rpt08_atomic_documents_verify.sql。
-- 注意：不要在生产项目上跑这个文件。
-- 生产需要补的是第 2 段（rpt03 私有桶）与第 3 段（rpt08 原子函数）；gate6 早已在生产执行。
-- （2026-09-11 更正：本行原文为「生产只跑第 3 个迁移」，该说法有误。当日核查生产
--   `select id, public from storage.buckets;` 只返回 event-assets，match-evidence 缺失，
--   证明 rpt03 从未在生产执行过 → 生产同样需要跑第 2 段。）
-- =====================


-- ========== 1/3  Gate 6：数据存储与限流 ==========

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


-- ========== 2/3  RPT-03：私有比赛凭证桶 ==========

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'match-evidence',
  'match-evidence',
  false,
  5242880,  -- 单张 5MB（工作包 §5 推荐限制）
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- ========== 3/3  RPT-08：同一赛事内多文档原子比较交换 ==========

begin;

create or replace function public.update_app_documents_atomic(
  p_scope text,
  p_event_id text,
  p_expected_versions jsonb,
  p_updates jsonb
)
returns boolean
language plpgsql
security definer
-- 函数内所有业务表均显式带 public schema；搜索路径只保留可信内置对象。
set search_path = pg_catalog, pg_temp
as $$
declare
  document_name text;
  expected_version bigint;
  actual_version bigint;
  document_payload jsonb;
  affected_rows integer;
begin
  if p_scope is null or p_scope not in ('site', 'event') then
    raise exception 'invalid document scope';
  end if;
  if p_event_id is null
    or (p_scope = 'site' and p_event_id <> '__site__')
    or (p_scope = 'event' and p_event_id !~ '^[a-zA-Z0-9_-]{1,60}$')
  then
    raise exception 'invalid event id';
  end if;
  if p_expected_versions is null
    or p_updates is null
    or jsonb_typeof(p_expected_versions) <> 'object'
    or jsonb_typeof(p_updates) <> 'object'
  then
    raise exception 'expected versions and updates must be objects';
  end if;

  -- 同一 scope/event 的批量写串行化；版本校验仍用于识别未走此函数的并发写。
  perform pg_advisory_xact_lock(hashtextextended(p_scope || '|' || p_event_id, 0));

  -- 先验证完整快照，尚不产生任何写入。
  for document_name, document_payload in
    select key, value from jsonb_each(p_expected_versions)
  loop
    if document_name !~ '^[a-zA-Z0-9_-]{1,60}$'
      or jsonb_typeof(document_payload) <> 'number'
      or (document_payload #>> '{}') !~ '^(0|[1-9][0-9]*)$'
    then
      raise exception 'invalid document version entry';
    end if;

    expected_version := (document_payload #>> '{}')::bigint;
    if expected_version < 0 then
      raise exception 'invalid expected version';
    end if;

    actual_version := null;
    select version
      into actual_version
      from public.app_documents
      where scope = p_scope
        and event_id = p_event_id
        and name = document_name
      for update;

    if coalesce(actual_version, 0) <> expected_version then
      return false;
    end if;
  end loop;

  -- 所有待写文档必须属于刚才验证过的快照。
  if exists (
    select 1
      from jsonb_object_keys(p_updates) as update_documents(name)
      where not (p_expected_versions ? update_documents.name)
  ) then
    raise exception 'update document missing expected version';
  end if;

  for document_name, document_payload in
    select key, value from jsonb_each(p_updates)
  loop
    expected_version := (p_expected_versions ->> document_name)::bigint;

    if expected_version = 0 then
      insert into public.app_documents (scope, event_id, name, payload, version, updated_at)
      values (p_scope, p_event_id, document_name, document_payload, 1, now())
      on conflict (scope, event_id, name) do nothing;
    else
      update public.app_documents
        set payload = document_payload,
            version = expected_version + 1,
            updated_at = now()
        where scope = p_scope
          and event_id = p_event_id
          and name = document_name
          and version = expected_version;
    end if;

    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      -- 40001 让调用方识别为可重试并发冲突；异常保证本次函数全部回滚。
      raise exception using errcode = '40001', message = 'atomic document version conflict';
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function public.update_app_documents_atomic(text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_app_documents_atomic(text, text, jsonb, jsonb)
  to service_role;

commit;
