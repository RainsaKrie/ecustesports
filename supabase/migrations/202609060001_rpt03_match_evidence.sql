-- =====================
-- RPT-03：私有比赛凭证存储（工作包 02 §5）
-- 新增私有 storage bucket `match-evidence`，与公开海报 `event-assets` 隔离。
-- 只新增一行 bucket 配置，不修改任何已执行 migration，不触碰 storage.objects 的 RLS 策略。
-- =====================

-- 创建私有 bucket（public = false）。
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
  5242880,  -- 单张 5MB（工作包 §5 推荐限制）
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 说明（供人工确认，非可执行 SQL）：
-- - 对象路径由领域层 evidence-ops.buildOpaqueObjectPath 生成：
--   match-evidence/{eventId}/{不透明ID}.{ext}，不含 matchId/refereeId/展示名等 PII。
-- - 读取走服务端短时签名地址（RPT-04 集成时 createSignedUrl），生产日志不得打印签名 URL。
-- - 删除期限 = 当届结束 + 7 天申诉期（evidence-ops.computeEvidenceExpiry 计算）。
-- - 上传校验在领域层 checkEvidenceFile：MIME 白名单 / 5MB / magic bytes / sha256，见 RPT-03。
-- - 测试只使用隔离 bucket 或 mock，不写生产（工作包 §5 验收清单）。