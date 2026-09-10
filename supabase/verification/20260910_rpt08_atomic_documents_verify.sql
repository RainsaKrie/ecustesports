-- RPT-08 迁移后验收。整份脚本在事务中运行，最后回滚，不保留测试数据。
-- 成功时最后只返回一行：RPT-08 verification passed。
-- 任一权限、原子性或版本条件不符合预期时直接报错，不会显示通过。

begin;

do $$
declare
  function_security_definer boolean;
  function_config text[];
  initial_commit boolean;
  stale_update boolean;
  guarded_update boolean;
  document_count integer;
  left_version bigint;
  left_value text;
  right_version bigint;
  right_value text;
begin
  select p.prosecdef, p.proconfig
    into function_security_definer, function_config
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.oid = pg_catalog.to_regprocedure('public.update_app_documents_atomic(text,text,jsonb,jsonb)');

  if function_security_definer is distinct from true then
    raise exception 'RPT-08 verification failed: function missing or not SECURITY DEFINER';
  end if;
  if coalesce(pg_catalog.array_to_string(function_config, ','), '') not like '%search_path=pg_catalog, pg_temp%' then
    raise exception 'RPT-08 verification failed: unsafe function search_path';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.update_app_documents_atomic(text,text,jsonb,jsonb)', 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', 'public.update_app_documents_atomic(text,text,jsonb,jsonb)', 'EXECUTE')
    or not pg_catalog.has_function_privilege('service_role', 'public.update_app_documents_atomic(text,text,jsonb,jsonb)', 'EXECUTE')
  then
    raise exception 'RPT-08 verification failed: unexpected execute privileges';
  end if;

  -- 使用保留的测试 event ID；事务回滚会恢复运行前状态。
  delete from public.app_documents
    where scope = 'event' and event_id = 'rpt08-verification-20260910';

  select public.update_app_documents_atomic(
    'event',
    'rpt08-verification-20260910',
    '{"rpt08-left": 0, "rpt08-right": 0}'::jsonb,
    '{"rpt08-left": {"value": 1}, "rpt08-right": {"value": 1}}'::jsonb
  ) into initial_commit;
  if initial_commit is distinct from true then
    raise exception 'RPT-08 verification failed: initial atomic insert rejected';
  end if;

  select
    count(*),
    max(version) filter (where name = 'rpt08-left'),
    max(payload ->> 'value') filter (where name = 'rpt08-left'),
    max(version) filter (where name = 'rpt08-right'),
    max(payload ->> 'value') filter (where name = 'rpt08-right')
  into document_count, left_version, left_value, right_version, right_value
  from public.app_documents
  where scope = 'event' and event_id = 'rpt08-verification-20260910';
  if document_count <> 2
    or left_version <> 1 or left_value <> '1'
    or right_version <> 1 or right_value <> '1'
  then
    raise exception 'RPT-08 verification failed: initial documents are inconsistent';
  end if;

  -- 使用旧版本应整体失败，不得修改任一文档。
  select public.update_app_documents_atomic(
    'event',
    'rpt08-verification-20260910',
    '{"rpt08-left": 0, "rpt08-right": 1}'::jsonb,
    '{"rpt08-left": {"value": 999}, "rpt08-right": {"value": 999}}'::jsonb
  ) into stale_update;
  if stale_update is distinct from false then
    raise exception 'RPT-08 verification failed: stale update was not rejected';
  end if;

  -- right 只作为版本前置条件；成功后不应被写回或增加版本。
  select public.update_app_documents_atomic(
    'event',
    'rpt08-verification-20260910',
    '{"rpt08-left": 1, "rpt08-right": 1}'::jsonb,
    '{"rpt08-left": {"value": 2}}'::jsonb
  ) into guarded_update;
  if guarded_update is distinct from true then
    raise exception 'RPT-08 verification failed: guarded update rejected';
  end if;

  select
    max(version) filter (where name = 'rpt08-left'),
    max(payload ->> 'value') filter (where name = 'rpt08-left'),
    max(version) filter (where name = 'rpt08-right'),
    max(payload ->> 'value') filter (where name = 'rpt08-right')
  into left_version, left_value, right_version, right_value
  from public.app_documents
  where scope = 'event' and event_id = 'rpt08-verification-20260910';
  if left_version <> 2 or left_value <> '2'
    or right_version <> 1 or right_value <> '1'
  then
    raise exception 'RPT-08 verification failed: guarded document changed unexpectedly';
  end if;
end;
$$;

rollback;

select 'RPT-08 verification passed' as result;
