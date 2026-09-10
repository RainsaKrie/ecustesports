-- RPT-08：同一赛事内多文档原子比较交换。
-- 用于裁判报分时一次提交 schedule / result-ledger / evidence-ledger，
-- 并把 referee-ledger 作为只读版本前置条件，避免撤销分配与报分并发穿透。

create or replace function public.update_app_documents_atomic(
  p_scope text,
  p_event_id text,
  p_expected_versions jsonb,
  p_updates jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  document_name text;
  expected_version bigint;
  actual_version bigint;
  document_payload jsonb;
  affected_rows integer;
begin
  if p_scope not in ('site', 'event') then
    raise exception 'invalid document scope';
  end if;
  if p_scope = 'event' and p_event_id !~ '^[a-zA-Z0-9_-]{1,60}$' then
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
