-- =====================
-- Supabase 2026-10-30 变更的应对
--
-- 变更内容：从 2026-10-30 起，`public` schema 里**新建的表不再自动获得 Data API 权限**。
-- 现有表不受影响（继续保留原有 GRANT）。
--
-- 本项目现状：已有三个迁移都是"建表后紧跟 grant"，且只授权给 service_role
-- （应用走服务端 API Route 访问，没有客户端直连，符合最小权限）。
-- 所以**存量表不需要补救**。
--
-- 这条迁移解决的是**未来**：给后续新建的表/序列设置默认授权，
-- 这样即使某次迁移忘了写 grant，Data API 也不会返回 permission denied。
--
-- 只授权 service_role —— 不给 anon / authenticated，
-- 因为本项目没有前端直连 Supabase 的路径，多授权等于多暴露面。
-- =====================

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to service_role;
