-- RPT-08 迁移后验收。整份脚本在事务中运行，最后回滚，不保留测试数据。
-- 预期：权限行显示 security_definer=true、anon/authenticated=false、service_role=true；
-- initial_commit=true、stale_update=false、guarded_update=true；最终 left=2/v2、right=1/v1。

begin;

select
  p.proname,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  has_function_privilege('anon', 'public.update_app_documents_atomic(text,text,jsonb,jsonb)', 'EXECUTE')
    as anon_can_execute,
  has_function_privilege('authenticated', 'public.update_app_documents_atomic(text,text,jsonb,jsonb)', 'EXECUTE')
    as authenticated_can_execute,
  has_function_privilege('service_role', 'public.update_app_documents_atomic(text,text,jsonb,jsonb)', 'EXECUTE')
    as service_role_can_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'update_app_documents_atomic';

select public.update_app_documents_atomic(
  'event',
  'rpt08-verification-20260910',
  '{"rpt08-left": 0, "rpt08-right": 0}'::jsonb,
  '{"rpt08-left": {"value": 1}, "rpt08-right": {"value": 1}}'::jsonb
) as initial_commit;

select name, payload, version
from public.app_documents
where scope = 'event'
  and event_id = 'rpt08-verification-20260910'
order by name;

-- 使用旧版本应整体失败，不得修改任一文档。
select public.update_app_documents_atomic(
  'event',
  'rpt08-verification-20260910',
  '{"rpt08-left": 0, "rpt08-right": 1}'::jsonb,
  '{"rpt08-left": {"value": 999}, "rpt08-right": {"value": 999}}'::jsonb
) as stale_update;

-- right 只作为版本前置条件；成功后它不应被无意义写回或增加版本。
select public.update_app_documents_atomic(
  'event',
  'rpt08-verification-20260910',
  '{"rpt08-left": 1, "rpt08-right": 1}'::jsonb,
  '{"rpt08-left": {"value": 2}}'::jsonb
) as guarded_update;

select name, payload, version
from public.app_documents
where scope = 'event'
  and event_id = 'rpt08-verification-20260910'
order by name;

rollback;
