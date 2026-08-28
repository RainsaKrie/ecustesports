# Gate 6：Vercel 与 Supabase 部署架构

- 日期：2026-08-28
- 状态：部署形态已确认，等待迁移与预发布验证
- 负责人决定：沿用趣灵的 GitHub → Vercel → 自购域名发布方式
- 预算边界：不租服务器；除域名外不产生固定支出
- 当前结论：Gate 6 尚未通过，AI 接入继续暂停

## 1. 已确认的正式组合

| 层级 | 选择 | 职责 |
|---|---|---|
| 代码与版本 | GitHub | 保存代码、触发 Vercel 部署、保留可回退版本 |
| Web 应用 | Vercel Hobby | 运行 Next.js 页面与接口、自动 HTTPS、预览部署 |
| 正式入口 | 自购域名 | 绑定 Vercel Production，主域名与 `www` 只保留一个规范入口 |
| 业务主数据 | Supabase Free PostgreSQL | 保存赛事、报名、队伍、赛制、赛程、约赛、BP 与操作记录 |
| 图片 | Supabase Storage | 保存负责人上传的赛事主视觉，不再写入应用目录 |
| 本地文件 | 导入源与离线备份 | 现有 JSON 不再作为生产主数据，关键节点导出保留人工兜底 |

这套组合与趣灵相同的是发布链路和域名管理，不同的是数据层。赛事助手属于多人共享、持续写入的业务系统，不能继续依赖浏览器本地存储、Vercel 临时文件或项目目录 JSON。

## 2. 为什么不直接复用趣灵的 Upstash 数据层

当前匿名测试赛的数据量约为：

- `schedule.json`：1,071,343 字节；
- `registration.json`：426,555 字节；
- 其余配置与 BP：约 27 KB；
- 单场完整测试赛合计约 1.5 MB。

当前 BP 房间每 3 秒刷新、BP 列表每 5 秒刷新、负责人赛程页每 8 秒刷新。若继续以“大 JSON 文档＋高频轮询”方式使用 Redis，容量虽然暂时足够，但命令次数、数据传输和整份文档覆盖会被放大，也不能自然表达报名、队伍和比赛之间的约束关系。

因此首轮选择 PostgreSQL 作为唯一事实源。Upstash 暂不引入；只有后续压测证明数据库限流或短期锁成为瓶颈时，才把它作为辅助服务评估，不能成为关键赛事数据的唯一保存位置。

## 3. 最小数据迁移方式

首轮不把现有模型一次拆成大量关系表，先采用 JSONB 文档表，降低迁移风险。

### `app_documents`

| 字段 | 用途 |
|---|---|
| `scope` | `site` 或 `event` |
| `event_id` | 赛事 ID；站点级文档为空 |
| `name` | `site-config`、`registration`、`format`、`schedule`、`bp` |
| `payload` | 现有 JSON 结构 |
| `version` | 乐观并发版本号 |
| `updated_at` | 最后更新时间 |

写入时必须在事务内校验版本并递增。报名、约赛、报分、BP 和阶段推进不能再使用无条件整文件覆盖。

### `operation_audit`

记录管理员登录失败、赛事发布、名单修改、赛程审批、报分、BP 重置、结束赛事和删除赛事等关键操作。日志只保存必要标识与变更摘要，不复制联系方式等敏感资料。

### `rate_limit_buckets`

首轮直接在 PostgreSQL 中实现跨 Vercel 实例的限流计数，覆盖登录、报名、组队、约赛、BP 和上传。只有压测证明该实现成为瓶颈时再评估独立 Redis。

## 4. Vercel 与 Supabase 环境

使用 Supabase Free 可用的两个项目隔离环境：

1. `esports-staging`：Vercel Preview 与迁移演练；可随时清空，不保存真实报名资料。
2. `esports-production`：仅 Vercel Production 使用；正式域名只连接该项目。

Vercel Serverless 运行时通过 Supabase Data API 读写 JSONB 文档，使用仅保存在服务端的 Secret Key；这样不需要在每个函数实例中维护数据库连接。建表、迁移和人工备份使用 Supabase SQL Editor、直接连接或官方 CLI。预览环境与正式环境不得共用数据库密钥。

## 5. 图片保存

- 负责人上传的主视觉写入 Supabase Storage 的独立 bucket。
- 数据库只保存对象路径、公开 URL 或签名访问所需标识。
- 上传前校验文件大小、扩展名和真实图片签名，使用随机对象名。
- 旧 `public/uploads` 文件只作为迁移来源，不允许生产接口继续写入该目录。

## 6. 生产环境变量

至少配置：

- `SUPABASE_URL`；
- `SUPABASE_SECRET_KEY`：仅服务端使用，不得出现于 `NEXT_PUBLIC_*`；
- `AUTH_SECRET`：独立随机值；
- `ADMIN_PASSWORD`：独立强密码；
- `APP_ORIGIN`：正式域名，用于同源校验；
- `DATA_BACKEND=supabase`：生产环境拒绝回退到本地 JSON；
- `REQUIRE_PRODUCTION_SECRETS=1`：预发布也启用生产安全检查；
- `RATE_LIMIT_SECRET`：独立随机值，用于限流身份与操作人来源摘要。

生产环境缺少上述关键变量时应用必须拒绝启动或拒绝写入，不能使用代码中的默认密码、默认签名密钥或本地文件兜底。

## 7. 读取与实时体验

- 公共赛事资料、名单和已发布赛程使用短时缓存与版本号，避免每次访问重复读取 1 MB 完整文档。
- BP 只在“进行中”的具体房间每 3 秒读取单场会话，不让所有赛事页持续轮询。
- 负责人赛程页只在页面打开且赛事进行中时刷新；后台不可见时停止轮询。
- 首轮不引入 WebSocket 或 Supabase Realtime。若真实测试证明轮询体验不足，再单独比较实时订阅的收益与复杂度。

## 8. 免费层风险与人工兜底

| 风险 | 处理 |
|---|---|
| Vercel Hobby 超出月度额度后相应能力暂停 | 监控 Usage；限制高频接口；正式比赛前检查当月剩余额度 |
| Supabase Free 低活跃项目可能暂停 | 预发布前确认项目在线；赛事期自然访问维持活跃；收到提醒后立即处理 |
| Supabase Free 无自动备份 | 报名截止、每阶段抽签前、阶段结束后、总决赛前后执行数据库与图片导出 |
| 境外服务在校园网络表现不确定 | 用华理校园网、宿舍网和移动网络分别实测；未通过前不作为唯一比赛入口 |
| 云服务临时不可用 | 保留最近一次只读名单、赛程和对阵导出；QQ群/微信群承担人工通知兜底 |

备份文件必须保存在不进入 Git 的本地受控目录；含个人信息的正式备份不能上传公开网盘或提交到仓库。

## 9. 部署与放行顺序

1. 建立 Supabase staging/production 项目与 Vercel 项目，先使用 `vercel.app` 预发布地址。
2. 实现 PostgreSQL 数据适配器、Storage 上传和一次性 JSON 导入。
3. 导入匿名测试赛，核对 160 名选手、32 支队伍、50 场比赛、最终冠军和操作记录。
4. 完成生产密钥、同源校验、限流、安全头、上传保护、健康检查和错误记录。
5. 在 staging 执行并发写入、BP 持续读取、备份恢复和三种网络访问测试。
6. 预发布通过后再绑定自购域名；正式域名先保持报名关闭。
7. 负责人完成最终检查并决定 Gate 6 是否通过，之后才进入真实赛事试用。

当前具体配置步骤见 `Gate6-Supabase与Vercel配置清单.md`。密钥只填写在本机环境变量或 Vercel/Supabase 控制台，不粘贴进对话、文档或 Git。

## 10. 2026-08-28 实现进度

已完成：

- 本地 JSON 与 Supabase Data API 共用一套数据接口；Vercel 环境未显式选择 Supabase 时拒绝运行；
- `app_documents` 采用版本号比较交换，关键赛程与 BP 更新改为原子更新；
- 赛事图片迁移到 Supabase Storage，校验 5 MB 上限和 JPEG/PNG/WebP 真实文件签名；
- 生产密钥强制校验、同源写入校验、跨实例限流、安全响应头；
- 登录、建赛、设置修改、发布/撤回、阶段切换和删除写入关键操作日志；
- `/api/health` 同时检查数据层与对象存储；
- 一次性匿名测试赛迁移工具与迁移前计划检查；
- 停用旧的报名整份覆盖入口；
- 生产依赖审计由 1 个高危告警修复为 0。

尚未完成：创建两个 Supabase 项目、执行迁移、部署 Vercel Preview、真实迁移核对、预发布压测、备份恢复演练、校内三种网络实测和正式域名绑定。以上仍阻塞 Gate 6。

## 11. 当前不做

- 不租云服务器，不备案大陆服务器；
- 不把本地电脑作为正式服务端；
- 不使用 Vercel `/tmp`、浏览器 localStorage 或仓库 JSON 保存生产业务数据；
- 不提前增加微服务、消息队列、Redis 或 Kubernetes；
- 不恢复 AI 接入。

## 12. 官方依据

- Vercel Hobby：https://vercel.com/docs/plans/hobby
- Vercel 自定义域名：https://vercel.com/docs/domains/set-up-custom-domain
- Vercel 与 Supabase 集成：https://vercel.com/marketplace/supabase
- Supabase 免费层与额度：https://supabase.com/docs/guides/platform/billing-on-supabase
- Supabase 连接方式：https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase 免费项目暂停：https://supabase.com/docs/guides/platform/free-project-pausing
- Supabase 备份：https://supabase.com/docs/guides/platform/backups
