# Gate 7：正式域名与生产环境上线清单

- 日期：2026-09-01
- 负责人：彭杰
- 用途：把 `ecustesports.top` 变成新一届「第三届华理瓦理杯」的真实办赛入口
- 前置：Gate 5、Gate 6 已通过；代码版本 v3.79（`1934ab6`）；AI 接入继续暂停
- 环境原则：`esports-production` 只承载真实赛事数据，任何人不得把真实姓名、学号、手机、QQ 或微信写入 `esports-staging`

## 目标与边界

| 项目 | 决定 |
|---|---|
| 域名 | `ecustesports.top`（阿里云万网注册） |
| DNS | 使用 Vercel 提供的 nameservers，在阿里云改为自定义 DNS |
| 规范入口 | `https://ecustesports.top`，`www.ecustesports.top` 重定向到它 |
| 生产数据 | Supabase `esports-production`（新加坡），空数据初始化 |
| 生产赛事 | 第三届华理瓦理杯，数据全部重置：空报名、空赛程、空赛果 |
| 测试赛 | `event-mt8f43vq`（160 人 / 32 队 / 50 场）**只留在 staging，不进生产** |

## 执行顺序（不要跳步）

**关键：先配好生产环境并验证干净，最后才绑域名。**
若在 Production 环境变量仍指向 staging 时绑域名，正式域名会直接展示匿名测试赛数据。

---

## 阶段 0｜阿里云域名状态确认

1. 登录阿里云 → 控制台 → 域名 → 域名列表，点击 `ecustesports.top`；
2. 确认域名状态为「正常」，不是 `clientHold` / `serverHold`；
3. 确认已完成**实名认证**（`.top` 域名未实名会被暂停解析）；
4. 找到「DNS 管理 / DNS 服务器」入口，确认可以改成自定义 DNS。

> 服务器在新加坡，法律上不需要 ICP 备案。若将来迁回国内服务器才需要备案。

## 阶段 1｜新建 `esports-production`（Supabase）

1. 新建 Supabase 项目，项目名 `esports-production`，**地域选新加坡**；
2. 保存数据库密码（自己留存，不要发给 AI、不要写进项目或 Git）；
3. 在 SQL Editor 执行 `supabase/migrations/202608280001_gate6_data_store.sql`；
4. 执行后确认存在三张表：`app_documents`、`operation_audit`、`rate_limit_buckets`；
5. **手动创建 Storage bucket**：Storage → New bucket → 名称 `event-assets` → 勾选 **Public**。
   > 迁移脚本只建表和限流函数，不创建 bucket。漏掉这步会导致赛事海报传不上去。

## 阶段 2｜生产数据初始化（只导站点配置）

改动：`tools/data/migrate-local-to-supabase.ts` 新增 `--site-only`，只写入 `site-config`，并自动清空 `events`、`currentEventId`、`archives`。默认行为不变，staging 流程不受影响。

确认命令（预检，不写入）：

```bash
npx tsx tools/data/migrate-local-to-supabase.ts --site-only
```

预期输出：`迁移计划：1 份文档，0.01 MB` + `- 站点/site-config · 13527 B`

写入命令（**PowerShell**，只在当前终端生效，不写入任何文件）：

```powershell
$env:SUPABASE_URL="https://你的生产项目.supabase.co"
$env:SUPABASE_SECRET_KEY="sb_secret_生产项目的key"
npx tsx tools/data/migrate-local-to-supabase.ts --site-only --apply
```

执行时会先打印**目标 host 和模式，并等待 5 秒**，看错目标立即 Ctrl+C。
成功后预期输出：`✓ site/site-config`（前面会显示「已清空 events / currentEventId / archives」）。

完成后清掉终端变量：

```powershell
Remove-Item Env:\SUPABASE_URL
Remove-Item Env:\SUPABASE_SECRET_KEY
```

## 阶段 3｜Vercel Production 环境变量

Vercel 项目 → Settings → Environment Variables。**每一个都必须只勾选 Production**，不要勾 Preview 或 Development。

| 变量 | 值 | 要求 |
|---|---|---|
| `REQUIRE_PRODUCTION_SECRETS` | `1` | 启用托管环境安全检查 |
| `DATA_BACKEND` | `supabase` | 禁止回退本地 JSON |
| `SUPABASE_URL` | `https://你的生产项目.supabase.co` | 不得填 staging |
| `SUPABASE_SECRET_KEY` | 生产项目 Secret Key | 变量名不得带 `NEXT_PUBLIC_` |
| `AUTH_SECRET` | 新随机值 | ≥32 字符 |
| `ADMIN_PASSWORD` | 新强密码 | ≥12 字符，不与其他账号共用 |
| `RATE_LIMIT_SECRET` | 另一个新随机值 | ≥32 字符 |
| `APP_ORIGIN` | `https://ecustesports.top` | 结尾不带 `/` |

生成随机值（本机跑，结果直接粘贴进 Vercel，**不要存进任何文件**）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

同时检查：如果这 8 个变量里有任何一个当前被勾选了 Production 且仍指向 staging，先改掉。

配完后触发一次 Production 部署（Deployments → Redeploy），然后用 Vercel 默认生产地址 `https://esports-operations-assistant-stagin.vercel.app` 完成阶段 4 验证。

## 阶段 4｜生产环境干净度验证（绑域名前）

用 Vercel 生产地址逐项确认：

- [ ] `/api/health` 返回 `{"ok":true}`；
- [ ] 首页可以打开，**赛事列表为空**，没有任何「第三届瓦理杯 / 疾风战队 / 50 场」的痕迹；
- [ ] 工作台可以用新的 `ADMIN_PASSWORD` 登录；
- [ ] 旧 staging 的 `ADMIN_PASSWORD` **登录失败**；
- [ ] 赛事设置保存成功（说明生产库可写）；
- [ ] 上传一张测试图片，返回的地址来自 Supabase Storage，不是 `/uploads/`；
- [ ] 连续错误登录返回 429；
- [ ] Supabase `operation_audit` 表出现登录与保存记录。

**以上全部通过才继续。**

## 阶段 5｜绑定域名

1. Vercel 项目 → Settings → Domains → Add → 输入 `ecustesports.top`；
2. Vercel 会给出推荐方式，选择 **「Add nameservers」（使用 Vercel DNS）**，记下形如 `ns1.vercel-dns.com`、`ns2.vercel-dns.com` 的两个地址；
3. 去阿里云 → 域名 → DNS 管理 → 修改 DNS 服务器 → 自定义 DNS，填入这两个地址；
4. 回到 Vercel，再添加 `www.ecustesports.top`，设为 **Redirect 到 `ecustesports.top`**（规范入口只保留一个）；
5. 等待 DNS 生效，通常几分钟，最长 48 小时。Vercel 会自动签发 SSL 证书，域名页显示 Valid Configuration 即成功。

## 阶段 6｜正式域名冒烟检查

- [ ] `https://ecustesports.top/api/health` 返回 `{"ok":true}`；
- [ ] `https://www.ecustesports.top` 自动跳转到 `https://ecustesports.top`；
- [ ] 浏览器地址栏显示有效 HTTPS 证书，不是「不安全」；
- [ ] 首页、赛事页、工作台三个入口都能打开；
- [ ] 响应头包含 CSP、HSTS、防嵌入与防 MIME 嗅探；
- [ ] 提交一次报名表单成功写入（**这是验证 `APP_ORIGIN` 是否配对的关键测试**，返回 403 说明没配对）；
- [ ] Vercel 日志中不出现密钥、联系方式或完整管理码。

## 阶段 7｜新建第三届华理瓦理杯（重置数据）

1. 工作台 → 新建赛事，按两步向导填写：基础信息 → 赛制配置；
2. 赛事名称：**第三届华理瓦理杯**；
3. 赛制：32 队 → 16 队 → 8 队，4 组 GSL 小组赛 + 8 队双败淘汰；5 名首发，可选 1 替补 + 1 教练；
4. **报名截止、队伍申报截止、比赛起止日期暂时填占位值，开放报名前必须在赛事设置里改成真实日期**（Gate 0-R 遗留跟踪项，至今未定）；
5. 确认赛事状态为「筹备中」，玩家侧不可见；
6. 在赛事设置里逐项核对：竞赛规程、地图池、奖项、规则（处罚类条款需负责人逐条确认）。

## 阶段 8｜真实办赛前的硬检查（原 Gate 6 降级项）

以下四项在**开放报名前**完成，在此之前保持报名关闭，群聊与只读导出作为故障兜底：

1. 华理校园网、宿舍网、移动网络三种网络各测一遍：首页、赛事页、参赛中心、一次写操作；
2. 报名期间每天一次数据库导出备份，执行人为彭杰本人；
3. `/api/health` 的站外监控，或明确的人工巡检班次；
4. 开放报名前做一次小规模真实预演（例如社团 10 人同时提交）。

## 已知风险

| 风险 | 说明 | 应对 |
|---|---|---|
| 国内访问不稳定 | `vercel.json` 固定 `regions: ["sin1"]`，Supabase 也在新加坡；国内访问长期时好时坏 | 阶段 8 第 1 项实测；若不可用，需评估境内服务器（但那时需要备案） |
| 300 人同时读取 | Gate 6 实测 300 个同一时刻读取全部成功但 P95 1,553 ms，超过 1 秒目标 | 报名开放为渐进式（分批次通知），不做瞬时抢名额 |
| `.top` 域名实名 | 未实名认证会被暂停解析 | 阶段 0 确认 |
| 数据混用 | 误把 production 环境变量指向 staging | 阶段 4 用旧密码登录失败来验证 |

## 未决事项

- 第三届华理瓦理杯的真实起止日期与报名截止日期（阶段 7 第 4 项）。
- 站外监控是接免费服务还是人工巡检（阶段 8 第 3 项）。
