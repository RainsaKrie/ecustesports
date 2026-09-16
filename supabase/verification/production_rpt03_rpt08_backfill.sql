-- =====================
-- 生产库迁移补齐（裁判报分上线前置）
--
-- 用法：登录 Supabase → 选中 **esports-production** 项目 → SQL Editor → 粘贴本文件 → Run
-- 期望结果：`Success. No rows returned`
--
-- 本文件只包含两段「幂等、不触碰数据行」的语句：
--   1. rpt03：建私有桶 match-evidence（insert ... on conflict do update）
--   2. rpt08：建原子多文档写函数（create or replace）
-- 重复执行安全；已存在的对象会被覆盖为正确配置。
--
-- 为什么生产只补这两段：
--   · gate6（建表 + 公开桶 event-assets）已确认在生产执行（页面数据与海报正常）
--   · rpt03 与 rpt08 的当前状态**无法从外部核实**（见下），所以两段都放进来，幂等无副作用
--
-- 关于「无法从外部核实」：
--   · 私有桶的匿名访问统一返回 NoSuchBucket，不泄露桶是否存在（Supabase 有意如此）
--   · rpt08 的函数只能带凭证调用探测，外部拿不到生产的 service key
--   · 缺该函数**只影响裁判报分**（全仓库仅 reporting-data.ts:114 一处调用），
--     而裁判报分在生产是关闭的 → 无法通过现有功能反推
--   · 历史文档有矛盾：verification 文件写「生产需补第2段与第3段」，
--     而 06-生产基线与问题台账 写「rpt08 已执行、rpt03 未执行」。
--     **以本文件执行后的实际结果为准**（幂等，无风险）。
--
-- 执行后自检（另开 Query 跑一遍）：
--   select id, public from storage.buckets;
--     → 应看到 event-assets(public=true) 与 match-evidence(public=false)
--   select proname from pg_proc where proname = 'update_app_documents_atomic';
--     → 应有 1 行
-- =====================


-- ========== 1/2  RPT-03：私有比赛凭证存储 ==========
-- 新增私有 storage bucket `match-evidence`，与公开海报 `event-assets` 隔离。
-- 只新增一行 bucket 配置，不修改任何已执行 migration，不触碰 storage.objects 的 RLS 策略。
--
-- Supabase Storage 安全模型：
--   - service_role（服务端密钥）自动 bypass RLS 且持有全部 grant，可读写任何 bucket 对象；
--   - 私有 bucket（public = false）的对象，anon / authenticated 在 storage.objects 上
--     没有配对的可读策略，因此无法列举或读取——这正是「仅服务端密钥可访问」的语义。
-- 因此无需额外 revoke 或手写 policy；手写 policy 反而可能误伤 event-assets 的公开访问。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'match-evidence',
  'match-evidence',
  false,
  5242880,  -- 单张 5MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- ========== 2/2  RPT-08：多文档原子比较交换 ==========
-- 用于裁判报分时一次提交 schedule / result-ledger / evidence-ledger，
-- 并把 referee-ledger 作为只读版本前置条件，避免撤销分配与报分并发穿透。

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
