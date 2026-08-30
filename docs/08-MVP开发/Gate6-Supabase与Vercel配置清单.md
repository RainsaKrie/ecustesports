# Gate 6：Supabase 与 Vercel 配置清单

- 日期：2026-08-28
- 用途：将当前匿名测试赛部署到隔离的预发布环境
- 当前状态：Supabase staging、私有 GitHub 与 Vercel 预发布已完成，正在收口 Gate 6 现场验证
- 放行边界：本清单完成不等于 Gate 6 通过；压测、恢复和网络验证仍需单独记录

## A. 负责人只需完成的账号操作

### 1. 创建 Supabase 预发布项目

- 项目名建议：`esports-staging`；
- 地域优先选择新加坡；若华理校园网实测明显不稳定，再比较东京；
- 保存数据库密码，但不要发送给 AI、写入项目或提交 Git；
- 项目地域创建后不能原地修改，正式项目应在预发布网络测试后再确定。

创建完成后，只需要告知“预发布项目已创建”，无需提供任何密钥。

### 2. 建立数据库与图片空间

在 Supabase 的 SQL Editor 中执行：

`supabase/migrations/202608280001_gate6_data_store.sql`

执行后应存在：

- `app_documents`；
- `operation_audit`；
- `rate_limit_buckets`；
- Storage bucket `event-assets`。

### 3. 在 Vercel 创建预发布项目

- 从本项目 GitHub 仓库导入；
- Framework Preset 选择 Next.js；
- 暂不绑定正式域名；
- 先使用 Vercel Preview 地址完成验证。

## B. 只填写在 Vercel 控制台的环境变量

| 变量 | Preview | Production | 要求 |
|---|---|---|---|
| `REQUIRE_PRODUCTION_SECRETS` | `1` | `1` | 启用托管环境安全检查 |
| `DATA_BACKEND` | `supabase` | `supabase` | 禁止回退本地 JSON |
| `SUPABASE_URL` | 预发布项目 URL | 正式项目 URL | 两个环境不能共用项目 |
| `SUPABASE_SECRET_KEY` | 预发布 Secret Key | 正式 Secret Key | 只允许服务端使用，变量名不得带 `NEXT_PUBLIC_` |
| `AUTH_SECRET` | 独立随机值 | 另一独立随机值 | 至少 32 字符 |
| `ADMIN_PASSWORD` | 预发布强密码 | 正式强密码 | 至少 12 字符，不与其他账号共用 |
| `RATE_LIMIT_SECRET` | 独立随机值 | 另一独立随机值 | 至少 32 字符 |
| `APP_ORIGIN` | Preview 主地址 | 正式域名 | 不含结尾 `/` |

任何密钥都不得写入 `.env.example`、README、截图、对话或 Git。若密钥曾被公开，应立即在控制台轮换。

## C. 导入匿名测试赛

先在本地只做计划检查：

```powershell
npm run data:migrate:plan
```

当前预期结果：5 个文档，约 1.45 MB，包含匿名测试赛 `event-mt8f43vq`。

确认目标是预发布 Supabase 后，在当前终端临时设置该项目的 `SUPABASE_URL` 与 `SUPABASE_SECRET_KEY`，再执行：

```powershell
npm run data:migrate:apply
```

不得先向正式项目导入；不得导入上一届含真实姓名、学号、手机、QQ 或微信的原始报名资料。

## D. 首次预发布检查

部署完成后按顺序检查：

1. `/api/health` 返回 `{"ok":true}`；
2. 首页、赛事页、公开名单、赛程和对阵可以读取；
3. 负责人登录、设置保存、撤回/发布和阶段保护正常；
4. 匿名测试赛仍为 160 名选手、32 支队伍、50 场完赛；
5. 总决赛为疾风战队 3:2 赤霄战队，冠军为疾风战队；
6. 上传测试图片后，地址来自 Supabase Storage，而不是 `/uploads/`；
7. Supabase `operation_audit` 出现登录、设置修改或发布操作记录；
8. 连续错误登录会返回 429；
9. 浏览器响应包含 CSP、HSTS、防嵌入与防 MIME 嗅探头；
10. Vercel 日志不出现密钥、联系方式或完整管理码。

## E. Gate 6 后续证据

- 300 并发公开读取；
- 30 并发报名写入且无丢失、重复或覆盖；
- 100 个 BP/比赛状态客户端持续读取 10 分钟；
- 10 个负责人/玩家并发写入保持数据一致；
- 空白预发布项目完成一次数据库与图片恢复；
- 华理校园网、宿舍网、移动网络分别完成访问与关键写入；
- 达标后创建独立 `esports-production` Supabase 项目，再绑定正式域名。

正式域名绑定前保持赛事报名关闭，并保留群聊与只读导出作为故障兜底。

## F. 当前执行记录

- `esports-staging` 已创建；
- SQL migration 已执行成功；
- `app_documents`、`operation_audit`、`rate_limit_buckets` 与 `event-assets` 已建立；
- 站点配置及匿名测试赛 `bp`、`format`、`registration`、`schedule` 共 5 份文档已导入；
- 迁移量约 1.45 MB，写入后回读核对 5/5 通过；
- 本地 `.env.local` 保持 Git 忽略且 `DATA_BACKEND=file`，localhost 未切换为云端事实源。

### 2026-08-30 云端直连验证（针对 Supabase staging）

以下三项直接读写 `esports-staging`，属于 Gate 6 阻塞项证据；脚本均使用临时赛事或对象并在结束时清理。

| 阻塞项 | 验证 | 结果 |
|---|---|---|
| G6-05 备份与恢复 | `tools/gate6/backup-restore.ts` | 5 份文档导出 0.87 MB；160 名选手、32 支队伍、50 场比赛；恢复到临时赛事后校验和 5/5 匹配；临时赛事已删除，通过 |
| G6-02 并发写入 | `tools/gate6/write-concurrency.ts` | 30 并发写入全部成功，存储请求 ID 30 个且全部唯一，无丢失、无重复、无错误，通过 |
| G6-04 限流 / G6-08 上传校验 | `tools/gate6/storage-rate-security.ts` | 704,536-byte JPEG 上传并公开读取 200；伪造图片签名被拒；超过 5 MB 被拒；限流前 10 次允许、第 11 次拒绝；临时对象与限流行已清理，通过 |

### 代码与推送状态

- 私有 GitHub 仓库 `RainsaKrie/esports-operations-assistant` 已存在，默认分支 `main`，可见性为私有；
- 本地工作树已提交并推送到 `main`，包含 Vercel 生产与分支来源的同源校验，以及上述三个 Gate 6 验证脚本；
- 类型检查、ESLint、规则 20/20、完整闭环 100/100、发布 7/7、阶段引导 16/16 通过；
- Vercel 预发布地址：`https://esports-operations-assistant-stagin.vercel.app`；公开读取、安全端点、上传限流与健康检查均已实测；
- 100 客户端持续 10 分钟共 12,001 次请求全部成功，P95 95 ms；30 个同时读取与 300 人/10 秒进入通过；300 个同一时刻读取全部成功但 P95 1,553 ms，未达到严格的 1 秒目标；
- 下一步：完成校园网、宿舍网、移动网络实测，确认备份与巡检值守，再建立 production 数据项目并绑定正式域名。
