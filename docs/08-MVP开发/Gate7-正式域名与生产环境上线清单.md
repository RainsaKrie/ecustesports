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

以下三项在**开放报名前**完成：

1. 华理校园网、宿舍网、移动网络三种网络各测一遍：首页、赛事页、参赛中心、一次写操作；
2. 赛后归档数据导出一次（命令见下）；
3. 开放报名前做一次小规模真实预演（例如社团 10 人同时提交）。

### 数据导出与备份校验

Supabase 免费版没有自动备份，库里那份就是唯一一份。**所以导出不该等到「赛后」—— 比赛期间就该做**：
赛果是当场逐场录进去的，丢了没有第二份可对。

在 **PowerShell** 里执行（把尖括号内容换成真实值）：

```powershell
$env:SUPABASE_URL="https://<生产项目>.supabase.co"
$env:SUPABASE_SECRET_KEY="<生产 service key>"
npm run ops:backup -- --event=event-1 D:\ecust-backups\2026-10-12.json
Remove-Item Env:\SUPABASE_URL
Remove-Item Env:\SUPABASE_SECRET_KEY
```

- `ops:backup` 是**只读导出**（脚本里钉死了 `--backup-only`），不写入任何数据，可以对着生产执行。
  要写库的恢复演练另有一条命令名，见下。
- **文件名带上日期，不要复用一个名字**：目标文件已存在时脚本会拒绝执行。要顶掉旧的必须显式加 `--overwrite`
  —— 上一次的备份可能就是唯一一份好副本，覆盖是不可逆的。
- 输出里看两个字段：`selfVerifiedAfterWrite: true`（刚落盘的内容通过了自校验）、
  `absentDocuments`（导出时就不存在的文档，空数组才表示五份齐活）。`passed` 表示「这份备份可信」。
- 备份文件必须放在仓库之外，否则脚本会拒绝执行。

导出完**就地校验一遍**。这条只读一个本地文件：不连库、不要凭据，**比赛进行中也能随时跑**：

```powershell
npm run ops:verify-backup -- D:\ecust-backups\2026-10-12.json
```

它逐份重算校验和，对不上时**点名是哪一份**并打印两个校验和的前缀供逐位比对。
退出码 0 = 这份备份可用；1 = 不可用；2 = 用法/路径问题（没读内容）。

**恢复演练**是另一条命令，会往库里写临时赛事再删除，**只能对隔离库执行，不要对生产执行**：

```powershell
npm run ops:backup-drill -- --event=<赛事ID> D:\ecust-backups\drill.json
```

### 数据一致性巡检（只读）

另有一条**只读巡检**，同样不连库、不要凭据，只打两个公开接口，用来看数据有没有自相矛盾：
赛果与逐局比分不符、胜者不在两队里、单败阶段同一队出现两次、资格赛胜者没进下一阶段、
同队时间撞车、赛程引用了报名名单里没有的队伍。

```powershell
npm run ops:audit-production
```

输出分两段：「发现的问题」（有则退出码 1）与「顺带的事实」（数量口径，供你对照）。
它查的是**数据内部矛盾**，不判断比赛安排得合不合理 —— 干净也不等于赛程排得好。

### 赛事期间最可能「整站打不开」的一种情况：Supabase 免费版自动暂停

免费版项目在**连续约 7 天低活跃**之后会被自动暂停
（官方文档：`supabase.com/docs/guides/platform/free-project-pausing`）。暂停后所有要读数据的
页面都没有数据，`/api/health` 开始返回 503。本届比赛 10.7–11.8 跨度五周、比赛日之间有空档，
这是最可能碰上的停机原因，也是能提前知道、不用花钱就能避开的一个。

**怎么知道**：Supabase 会先给项目所有者发预警邮件（暂停前约一周），暂停后再发一封确认邮件。
收到第一封就处理，不要等第二封。

**怎么避开**：官方口径是「前一周里每天有几个数据库请求，就足以避免暂停」。比赛日以外的空档里
自己打开一次赛事页，或打一次
`https://ecustesports.top/api/public/schedule?eventId=event-1`，就算一次活动。
要完全不用管，只有两条路：升级到 Pro（付费项目不暂停），或者加一个每天定时访问的任务
—— 后者与「上届评估后不做定时巡检」的决定相抵触，**要不要加由你定**。

**真的暂停了**：登录 Supabase 控制台 → 选中该组织与项目 → 点 `Resume project`，
数据与配置会回到原状。暂停后**一年内**都还能这样恢复。

**顺便记住 `/api/health` 的 200/503 各自意味着什么**（读代码核实的）：它不只回「进程活着」，
而是真的读了数据层（`readData`）并确认 `event-assets` 存储桶能用生产密钥访问。
所以 **200 = 数据层与存储桶都通**；**503 = 连不上 Supabase（或密钥不对）**。
本地开发环境不查存储桶那一半。

## 阶段 9｜赛后收尾与下一届（2026-09-17 补）

> 这一节回答四件「将来会用到、但现在没人记得」的事。都**不急**，但必须在需要之前就写清楚，
> 否则到那一刻只能凭印象操作。

### 9.1 密钥轮换

**什么时候轮换**：① 本届结束、赛事归档后；② 任何掌握密钥的人退出协作；③ 怀疑泄露时（立即）。

**哪些要轮换、影响是什么**：

| 变量 | 轮换影响 | 注意 |
|---|---|---|
| `SUPABASE_SECRET_KEY` | 换掉后旧 key 立即失效 | 权限最大，**优先轮换它**；到 Supabase → Settings → API 重新生成 |
| `ADMIN_PASSWORD` | 换掉后旧密码不能登录 | 这是**共享账号**，所有人都要知道新密码 |
| `AUTH_SECRET` | **会让所有已登录会话立刻失效**（等于全员登出） | 不必单独轮换，泄漏或换人时一并做 |
| `RATE_LIMIT_SECRET` | 换掉后限流计数从头开始 | 影响最小 |

**操作位置**：Vercel → 项目 → Settings → Environment Variables（**每个都只勾 Production**），
改完必须 **Redeploy** 才生效；Supabase 的 key 在 Supabase 控制台生成。
轮换后按「阶段 4」的思路验一遍（新密码能登录、旧密码失败）。

⚠️ 新值生成后**只粘贴进控制台，不要写进任何文件、不要发给 AI**：
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### 9.2 协作者离开

**先弄清谁有什么权限**（这是撤权的前提，当前的协作者名单需负责人自行确认）：

| 入口 | 能做什么 | 离开时要撤什么 |
|---|---|---|
| Vercel 项目成员 | 改环境变量（含全部密钥）、看部署日志 | Vercel → Settings → Members 移除 |
| Supabase 项目成员 | 读改全部数据、看/重置 key | Supabase → Organization / Project Settings 移除 |
| 阿里云域名账号 | 改 DNS（可把域名指向别处） | 改密码、确认没有多余子账号 |
| 工作台管理员密码 | 改赛事数据 | 轮换 `ADMIN_PASSWORD`（见 9.1） |
| 仓库协作者 | 推代码（进而可改线上行为） | GitHub → Settings → Collaborators 移除 |

**顺序建议**：先撤访问权 → 再轮换密钥 → 最后移除成员。
反过来做会留下「人已移除但密钥还在他手里」的窗口。

**要记住的事实**：管理员是**共享账号**，审计日志只能记到「赛事负责人」，
无法区分具体是谁操作的（见台账 OPN-07）。所以撤权时无法靠日志回溯历史操作。

### 9.3 赛事归档

本届数据导出见「阶段 8 → 数据导出与备份校验」（`npm run ops:backup`，只读，可对生产执行）。

补充三点：
- **导出要趁早**：Supabase 免费版没有自动备份，库里那份是唯一一份。
- **截图有时限**：裁判上传的对局截图存在 `match-evidence` 私有桶，
  赛后建议明确一个保留期限（当前约定是 **7 天**），到期清理。
- **归档后不要动生产赛事**：`event-1` 是已办赛事的记录，留作下届参考与作品素材。

### 9.4 下一届建赛

**可以做**：工作台 → 新建赛事（两步向导：基础信息 → 赛制配置）。

**但要知道这几件事**：

| 事项 | 说明 |
|---|---|
| 赛制模板 | 本届用的是「32 队 → 16 队 → 8 队，4 组 GSL + 8 队双败」，新赛事可直接复用模板 |
| 通用规则预设 | 「后续赛事通用规则预设」会跨赛事生效；改动前确认是否想影响未来所有赛事 |
| 队伍数与赛制 | 抽签要求**恰好落在赛制区间内**（本届入围赛是 17–32 支已冻结队伍），超出即卡住 |
| 真实日期 | 建赛事时先填占位值，开放报名前必须改成真实日期（本届这条是已知遗留项） |
| 私下约定不自动生效 | 队长的组队/改期沟通在 QQ/微信里，平台不会自动知道，需要负责人代为核心时间（界面显示「按此时间排期」） |



## 已知风险

| 风险 | 说明 | 应对 |
|---|---|---|
| 国内访问不稳定 | `vercel.json` 固定 `regions: ["sin1"]`，Supabase 也在新加坡；国内访问长期时好时坏 | 阶段 8 第 1 项实测；若不可用，需评估境内服务器（但那时需要备案） |
| 300 人同时读取 | Gate 6 实测 300 个同一时刻读取全部成功但 P95 1,553 ms，超过 1 秒目标 | 报名开放为渐进式（分批次通知），不做瞬时抢名额 |
| `.top` 域名实名 | 未实名认证会被暂停解析 | 阶段 0 确认 |
| 数据混用 | 误把 production 环境变量指向 staging | 阶段 4 用旧密码登录失败来验证 |

## 未决事项

- 第三届华理瓦理杯的真实起止日期与报名截止日期（阶段 7 第 4 项）。
- 不接站外监控与定时巡检：本赛事为个人主办的单场校内赛，规模 160 人、比赛集中在校内举行。服务异常在场地内可即时发现（玩家会直接反馈），无需机器另行告警；接入监控服务所需的注册、告警渠道与链路维护不产生产品价值。故障排查用阶段 8 的三网实测与只读导出兜底。
