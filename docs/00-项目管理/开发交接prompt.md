# 开发交接 Prompt

> 把这段完整粘贴给新 AI 会话即可继续开发。

---

## 项目

《无畏契约》校园赛事 AI 排程协同助手（瓦理杯），Next.js 16.3.0 App Router + React 19 + TypeScript + Tailwind CSS 4。当前本地开发仍读写 JSON（`data/site-config.json` + `data/events/{eventId}/`），生产环境使用 Supabase PostgreSQL + Storage。当前版本 3.80；本地 Git 重构前基线为 `ac0a306`。

> 重要状态：匿名测试赛 `event-mt8f43vq` 已完成全部 50 场、完整双败、两场 BO5、冠军与结束赛事，不得重置、另建赛事或重复回放。Gate 5、Gate 6 已通过。私有 GitHub、Vercel 与 Supabase staging 已上线，预发布地址为 `https://esports-operations-assistant-stagin.vercel.app`；匿名终态数据、承载、并发写、备份恢复、上传限流、同源授权、健康检查与安全响应头已有云端证据。校内三种网络、赛事期备份值守、站外监控和正式域名复测降级为真实办赛前检查。负责人于 2026-09-01 确认域名 `ecustesports.top`（阿里云）为**真实办赛入口**而非作品集演示，需建立独立 `esports-production` 并以空数据承载第三届华理瓦理杯；DNS 使用 Vercel nameservers。AI 继续暂停，网站仍无 AI 入口。

- 技术栈：Next.js 16.3.0（App Router）、React 19、TypeScript（strict）、Tailwind CSS 4、qrcode.react
- 运行：`npm run dev`（端口 3000）
- 类型检查：`node node_modules/typescript/bin/tsc --noEmit --incremental false`
- Node：使用系统命令 `node` / `npm`（当前环境 Node.js 22）
- 项目根目录：`D:\桌面\esports-operations-assistant`

## 设计基线

设计文档：`docs/04-产品定义/工作台系统设计_v0.2.md`（已确认冻结）。所有开发严格照此文档。核心要点：

1. **3 个模块**：01 报名与队伍 / 02 赛程（核心）/ 03 赛事设置
2. **无独立总览页**：生命周期条 + 模块状态徽标溶解到侧边栏，点赛事直接进赛程
3. **新建比赛 = 建立赛事对象**：两步流程（基础信息 + 赛制配置），创建后进入赛事设置
4. **抽签 = 裁判直播面板**：对阵图先有骨架空卡片，抽签逐队填位（种子池 + 对阵图 + 逐队揭示，支持一键抽完）
5. **视觉**：无圆角、无黑卡片、品牌红 #ff4655、ink 结构线、白卡片
6. **策划案独立**：不在系统中填写、生成或导出策划案；它继续使用独立文档完成
7. **文案原则**：界面只保留规则、状态、时间、限制、风险、操作后果和真实结果；不展示系统架构、重复流程或无操作价值的解释性小字

## 开发进度（7 步计划）

| 步骤 | 内容 | 状态 |
|---|---|---|
| 1 | 导航重构（3模块+生命周期入侧栏+并列列表） | ✅ 完成 |
| 2 | 02 赛程对阵图（骨架+报分弹框） | ✅ 完成 |
| 3 | 抽签面板（裁判直播） | ✅ 完成 |
| 4 | 新建比赛两步流程 | ✅ 完成 |
| 5 | 策划案从系统移除，保留独立文档边界 | ✅ 完成 |
| 6 | 01 报名单列切换 + 03 设置精简 | ✅ 完成 |
| 7 | 全站删提示卡/统计卡/灰字 + 验证 | ✅ 完成 |

### 当前工程检查与产品验收状态

- tsc：0 错误
- ESLint：0 错误、0 警告
- 规则测试：20 / 20
- 完整闭环：100 / 100
- BP 测试：44 / 44
- 既有关键页面“能打开”巡检曾为 0 控制台错误，但不构成产品验收
- 双角色真实任务审计：历史首轮不通过；核心约赛协同于 2026-08-26 代理验收通过
- 2026-08-21 已修并实测：新赛事空数据、并发报名、玩家侧错误写请求、多赛事上下文、草稿发布边界、工作台独立壳、参赛管理码、资料更正、双向组队、BP 赛事隔离、手机端头部与主按钮
- 已解除：赛制配置已驱动 4 队单败、8 队双败、16 队 GSL + 8 队双败，以及本届 32 队入围赛 → 16 队 GSL → 8 队双败的分阶段抽签；三阶段合计 50 场，后续阶段只读取已确认赛果中的真实晋级队伍。
- 已解除：负责人异常运营操作与发布/撤回/玩家页预览边界。
- 当前本届测试数据：160 名匿名测试选手、32 支正式队伍，每队 5 名首发；替补与教练名额为空。阵容界面固定展示 `5 首发 + 1 替补 + 1 教练`。
- 生命周期主操作已改为真实状态操作：结束报名会校验公开状态、选手审核和正式队伍数量，关闭报名窗口并进入分组后直达抽签工作区；结束赛事会校验全部比赛完成且无待处理改期。不得将这类按钮退化为跳转赛事设置的普通链接。
- 玩家侧不提供“填写比赛亮点／生成赛事回顾”等负责人编辑功能；旧 `/events/{id}/report` 页面和赛事页入口已删除。最终赛果统一通过赛事赛程与对阵展示。
- 玩家赛事页采用身份感知入口：本设备已识别参赛身份时仅保留“进入参赛中心”主按钮；未识别身份时，比赛阶段不再显示重复的“查看赛事赛程”大按钮。参赛中心将我的比赛置前，队长在同一区域发起约赛或改期。
- `docs/09-测试与复盘/本地参赛身份.md` 保存当前匿名赛事的两名对阵队长与一名普通队员测试管理码，可完整验收提交约赛、对手确认、负责人审批和队员查看；正式赛事不得复用。
- 已验证约赛：M14 从未排期推进为 2026-10-06 12:00—12:45，申请已批准，赛程 v1→v2，并生成通知草稿；普通队员越权 403、发起队长自确认 400、对手队长确认 200、普通队员读取新时间成功。
- 本轮发现并修复：`src/proxy.ts` 原本漏掉 `/api/public/schedule/request`，导致队长请求被错误要求管理员登录。该接口现由参赛管理码和队长身份在路由内部校验。
- AI 验证已暂停：评测集 v0.1 已冻结并保留，AI 输出仍为空；不得继续模型选择或 A/B。
- 当前只验证非 AI 产品闭环：建赛、发布、报名、组队、抽签、排期、BP、约赛/改期、报分、晋级、结束及负责人端/玩家端一致读取。
- 并发容量已改按候选时段内的峰值计算；相邻但不同时发生的比赛不再被错误累加。HC-05 仍只验证前置比赛计划时间，实际完赛状态属于明确能力缺口。
- 2026-08-26 入围赛闭环：赛程 v17，16 场均已排期并完赛；M14 双方队长完成 6 次 BO1 Ban，错误操作方被 403 拦截，最终地图“莲华古城”，赛果 13:9；玩家公开赛程同步通过，阶段门控只读取 16 支真实胜者并解锁小组赛。证据见 `docs/09-测试与复盘/当前匿名测试赛验收进度.md`。
- 2026-08-26 小组赛闭环：赛程 v38，共 36 场全部完成；M24 双方队长完成 BO3 的 4 Ban + 2 Pick，最终地图“森寒冬港、微风岛屿、莲华古城”，赛果 2:1；四组各提取第一、第二共 8 支唯一队伍并解锁淘汰赛，玩家侧同步通过。
- 2026-08-26 淘汰赛与终态：赛程 v53，共 50 场全部完成；M37 验证 BO3 双队长 BP，M49 与 M50 分别验证败者组决赛和总决赛 BO5 BP；疾风战队从败者组晋级并在总决赛 3:2 夺冠，无重置赛。正式结束接口通过，玩家页显示“已结束／查看最终赛果”。
- 2026-08-27 官网内容收口：结束赛事后不直接覆写人工运营文案；工作台检测赛前内容并生成待办，`/admin/site-content` 提供赛果建议和统一确认保存。本届首页赛事简介、页脚状态及赛后收尾主按钮已同步，待办消除。
- 2026-08-27 赛后赛事页视觉收口：最终排名由大面积深色横条改为暖白结构化排名板，比分改为冠军优先顺序；赛事资料五标签和竞赛规程四目录在手机端完整展示，不再依赖横向滑动。
- 2026-08-30 Gate 6 云端证据：30 同时读 P95 453 ms；300 人在 10 秒内进入 P95 527 ms；300 同时读全部成功但 P95 1,553 ms，严格 1 秒目标未通过；100 客户端持续 10 分钟共 12,001 次请求全部成功、P95 95 ms、无版本回退。
- 2026-08-30 数据与安全证据：30 并发更新修复后 30/30 成功且无丢失/重复/覆盖；5 份文档备份恢复校验和 5/5；图片签名、5 MB、限流第 11 次拦截、Origin 403、无会话 401、安全响应头、健康检查和生产依赖 0 漏洞均通过。
- 2026-09-01 负责人确认今天优先完成公开部署上线。AI 评测基线 20/20 仅作保留证据，不运行 B 方案、不选择模型、不增加网页 AI 入口。
- 2026-09-01 玩家侧赛事资料改为高密度视图：选手、队伍和比赛结果缩短行高并重排字段；公开与后台共用对阵图取消固定最小宽度和内部横向滚动，桌面与 390px 手机均无横向溢出。

## 2026-08-21 当前实现与实测证据

- 新建赛事独立初始化空报名、空赛制、v0 空赛程，不再自动切换官网焦点赛事。
- 工作台结构为：共享管理账号 → 并列赛事列表 → 赛事 URL 独立工作区；后台不显示玩家站顶栏/页脚。
- 玩家报名成功只返回本人资料和一次性管理码；服务端只保存 SHA-256 摘要。玩家可跨设备进入、修改资料、创建队伍、申请、邀请和处理请求。
- 双向组队已用两个真实浏览器身份跑通；发起方无审批按钮，队长同意后才实际入队。
- 同一临时赛事并发 10 条报名全部返回 200，最终人数从 2 精确变为 12；测试赛事和虚拟数据已清理。
- 公开报名接口只返回人数汇总；公开赛程只返回 `version` 和 `matches`；完整报名/赛程与旧直接加队接口未登录返回 401。
- 赛程、赛制、BP 后台接口必须显式携带赛事 ID；BP 队长身份改用参赛管理码，不再信任客户端 playerId。
- 赛事阶段 `status` 与玩家可见性 `visibility` 已分离；设置页可预览最近保存的玩家页面并显式发布/撤回，撤回不改变赛事阶段。公开赛事保存仍需通过完整性检查，比赛中但无赛程时拒绝保存。
- 设置页发布概览提供赛事归档与永久删除。真实往届赛事归档保留资料；永久删除只允许未公开的筹备/归档赛事，要求输入完整名称，并同时清理 `data/events/{eventId}/`。
- 工作台筹备阶段的“进入报名阶段”是实际状态操作，不再是设置页跳转：点击后二次确认，服务端重新检查当前阶段、公开状态与发布前检查，通过后仅把当前赛事推进到报名阶段并刷新侧栏。
- 玩家参赛身份按赛事保存在当前浏览器；刷新和重新打开仍能自动识别，换设备、换浏览器或清理站点数据后使用参赛管理码恢复。已识别身份时，赛事页和报名页以“参赛信息管理”为主入口，不再展示重复报名表。
- 赛事页参赛选手与参赛队伍使用真实公开名单，不再只显示人数；公开数据严格排除姓名、学号与联系方式。
- lint、TypeScript、生产构建、9 条报名异常操作、20 条规则、100 条完整闭环、44 条 BP、7 条发布与 16 条阶段引导测试全部通过。
- 权威回归记录仍是 `docs/09-测试与复盘/2026-08-20-双角色全流程产品审计.md`，其中已追加第二轮结果。

## 步骤 6 工程实现情况（产品验收未通过）

### 6a. 01 报名页 — 异常运营闭环已完成并验证

入口：`src/app/admin/events/[id]/registration/page.tsx`

主体：`src/components/admin/RegistrationOperationsWorkspace.tsx`

已完成的改动：
- 保留选手 / 队伍 tab，并新增操作记录 tab；选手区使用不横向溢出的操作卡片，支持搜索、审核筛选和每页 20 人。
- 支持选手审核、资料更正、需修改/拒绝、代建/补人、正式名单确认、开放调整、换人、移出、个人/整队退赛。
- 负责人操作通过 `/api/admin/registration` 原子写入并记录原因和前后状态；只有最新且未出现后续数据变化的操作可安全撤销。
- 术语继续使用「选手报名截止」「队伍申报截止」；旧 `frozen` 队伍成员迁移为已审核通过，避免已有正式名单被全部打回待审核。
- 旧 `useRegistration` 已停止读取后自动整表回写，`/api/data/registration` 的旧 POST 补充管理员校验。

已用 7 名虚拟选手真实跑通审核、代建、补齐 5 名首发、确认名单、资料更正、换人、操作记录和撤销；不完整名单会被拦截。临时赛事和虚拟数据已清理。

### 6b. 03 设置页 — 已完成并验证

文件：`src/app/admin/events/[id]/settings/page.tsx`

当前状态：已改为 `MODULE 03 / SETTINGS`，使用 `EventSettingsWorkspace`，并通过 `PATCH /api/admin/events` 按 URL 中的赛事 ID 保存；发布概览独立维护玩家侧公开状态，可预览最近保存版本并显式发布或撤回。

设置页不再同时铺开全部字段，分为 5 个任务分区：

| 分区 | 内容 |
|---|---|
| 发布概览 | 公开状态、发布前检查、各分区配置摘要 |
| 赛事与报名 | 名称、项目、主办方、阶段、报名日期与公开标签 |
| 赛事规程 | 参赛程序，以及按竞赛赛制、比赛程序、竞赛纪律、技术异常、申诉裁决分类的规则 |
| 地图与 BP | 启用或停用赛事地图 |
| 玩家页面 | 赛事简介、奖项和主视觉 |

新建赛事不再产生空白规程：阶段配置自动生成赛制条款，平台通用规则自动继承，负责人可添加本届补充规则。通用规则可从任一赛事规程中维护并保存为后续赛事预设，独立存放于 `data/rule-library.json`。规则记录 `source`、`customized`、`confirmed`；警示及处罚条款默认须负责人确认，通过后才能公开赛事。

站点品牌、SEO、导航文字等平台级字段已从单赛事设置移除。

参考数据模型：`src/lib/site-config-schema.ts` 中的 `EditableEvent` 接口。赛事设置通过 `PATCH /api/admin/events` 保存。旧数据中的 `proposal` 字段仅作向后兼容，现行产品流程不读取、不编辑，也不存在 proposal API。

## 步骤 7 工程清理情况（产品验收未通过）

已删除 `FrameworkNotice`、旧 `SiteContentEditor` 与遗留模块编号；同时修复二维码 hydration、多赛事玩家页取错当前赛事、双截止兼容覆盖等问题。关键后台和玩家页面已完成浏览器巡检。

## 关键文件索引

| 文件 | 作用 |
|---|---|
| `src/lib/operations-data.ts` | 3 模块定义 + 状态徽标 + 生命周期条 |
| `src/lib/site-config-schema.ts` | 数据模型（EditableEvent 含 stageConfigs；proposal 仅为旧数据兼容字段） |
| `src/lib/scheduling/format-templates.ts` | 赛制模板（StageConfig 类型 + buildEventFromTemplate） |
| `src/lib/scheduling/bracket.ts` | 对阵图生成逻辑 |
| `src/components/admin/AdminSidebar.tsx` | 侧边栏（生命周期条 + 状态徽标 + 返回入口） |
| `src/components/admin/EventListSwitcher.tsx` | 赛事列表切换器 |
| `src/app/admin/page.tsx` | L1 赛事列表页 |
| `src/app/admin/layout.tsx` | admin 布局 |
| `src/app/admin/events/[id]/page.tsx` | 赛事入口（重定向到 /schedule） |
| `src/app/admin/events/[id]/schedule/page.tsx` | 02 赛程（对阵图核心） |
| `src/app/admin/events/[id]/schedule/draw/page.tsx` | 抽签面板（裁判直播） |
| `src/app/admin/events/new/page.tsx` | 新建比赛两步流程 |
| `src/app/admin/events/[id]/registration/page.tsx` | 01 报名路由入口 |
| `src/components/admin/RegistrationOperationsWorkspace.tsx` | 报名审核、更正、代建/补人、名单确认、换人、退赛、操作记录和撤销工作台 |
| `src/app/api/admin/registration/route.ts` | 赛事级原子化负责人报名操作接口 |
| `src/lib/scheduling/registration-admin-ops.ts` | 负责人异常运营纯函数与安全撤销规则 |
| `src/app/admin/events/[id]/settings/page.tsx` | 03 设置（已精简） |
| `src/components/admin/EventSettingsWorkspace.tsx` | 单赛事分区设置工作区、规则继承与发布检查 |
| `src/app/admin/events/[id]/format/page.tsx` | 重定向到 /schedule |
| `src/app/admin/events/[id]/notifications/page.tsx` | 重定向到 /schedule |
| `src/app/admin/events/[id]/report/page.tsx` | 重定向到 /schedule |
| `src/app/api/admin/events/route.ts` | 赛事 CRUD API |
| `src/app/api/admin/events/publication/route.ts` | 赛事显式发布/撤回 API 与赛程发布门槛 |
| `src/app/events/[id]/page.tsx` | 玩家赛事页阶段主任务、唯一主按钮与当前安排 |
| `src/components/events/EventDetailTabs.tsx` | 玩家赛事资料标签与后台数据驱动的赛事手册 |
| `src/lib/scheduling/stage.ts` | 负责人端与玩家端共用的阶段判定、玩家阶段引导配置 |
| `src/app/globals.css` | 全局样式 |

## 数据模型要点

`EditableEvent`（在 `site-config-schema.ts`）新增字段：
- `visibility: "private" | "public"` — 玩家侧可见性，与赛事阶段独立
- `publishedAt?: string` — 最近一次首次/再次发布的时间记录
- `stageConfigs: StageConfig[]` — 赛制阶段配置（新建比赛第二步产出）
- `proposal: { background, purpose, budget, prizes, leader, contact }` — 仅用于读取 3.47 及更早版本的数据；新流程不产出、不展示
- `teamRegistrationEnd: string` — 队伍申报与名单调整截止日期

`StageConfig`（在 `format-templates.ts`）：
```typescript
interface StageConfig {
  name: string;           // 阶段名（入围赛/小组赛/淘汰赛…）
  type: "single-elim" | "gsl-groups" | "double-elim" | "round-robin";
  teamCount: number;       // 该阶段队伍数
  boType: "BO1" | "BO3" | "BO5";
  groupCount?: number;     // 仅 gsl-groups / round-robin 用
}
```

## 协作约定

- 彭杰是产品（判断/拍板/验收），代码由 AI 编写
- 通俗解释，不默认他懂技术细节
- 一次给完整方案，集中 review 一次拍板
- 普通工作台功能已经冻结；新增功能必须先说明真实问题、验证方式和退出条件

## 冒烟验证方法

```bash
# 启动 dev server
cd "D:/桌面/esports-operations-assistant"
npm run dev

# 生成 admin token 并验证
node -e '
const {createHmac}=require("node:crypto");
const S="ecust-esports-admin-secret-2026";
const exp=String(Date.now()+604800000);
const token=exp+"."+createHmac("sha256",S).update(exp).digest("hex");
(async()=>{
  const check=async(name,url,needles)=>{
    const r=await fetch(url,{headers:{Cookie:`admin_session=${token}`}});
    const t=await r.text();
    const ok=needles.every(n=>t.includes(n));
    console.log(`${ok?"✓":"✗"} ${name}: HTTP ${r.status}${ok?"":" | 缺失:"+needles.filter(n=>!t.includes(n)).join(",")}`);
  };
  await check("赛事列表","http://localhost:3000/admin",["赛事列表","新建比赛"]);
  await check("赛程页","http://localhost:3000/admin/events/event-1/schedule",["对阵图"]);
  await check("报名页","http://localhost:3000/admin/events/event-1/registration",["选手","队伍"]);
  await check("设置页","http://localhost:3000/admin/events/event-1/settings",[]);
  await check("抽签面板","http://localhost:3000/admin/events/event-1/schedule/draw",["抽签"]);
  await check("新建比赛","http://localhost:3000/admin/events/new",["基础信息","赛制配置"]);
})();
'
```

## 立即开始

当前处于“Gate 7 生产环境与正式域名上线”，严格按 `docs/08-MVP开发/Gate7-正式域名与生产环境上线清单.md` 执行：

1. 用途已由负责人确认为**真实办赛入口**：域名 `ecustesports.top`（阿里云），DNS 使用 Vercel nameservers，生产赛事为「第三届华理瓦理杯」且数据全部重置。匿名测试赛 `event-mt8f43vq` 只留在 staging，不进生产。
2. 执行顺序不可颠倒：**先建 `esports-production` 并配好 Vercel Production 环境变量、验证生产地址干净，最后才绑域名。** 若 Production 环境变量仍指向 staging 就绑域名，正式域名会直接展示匿名测试赛。
3. 生产初始化使用 `npx tsx tools/data/migrate-local-to-supabase.ts --site-only --apply`，只写入站点配置并清空 `events`、`currentEventId`、`archives`；写入前脚本会打印目标 host 并等待 5 秒。默认全量迁移行为未改变，staging 流程不受影响。
4. `supabase/migrations/202608280001_gate6_data_store.sql` 只建表和限流函数，Storage bucket `event-assets` 必须手动创建并设为 public。
5. `APP_ORIGIN` 必须为 `https://ecustesports.top` 并重新部署，否则同源校验会让所有写接口返回 403。
6. AI 继续暂停，不运行 B 方案、不选择模型、不增加网页 AI 入口。
7. 第三届华理瓦理杯的真实起止日期与报名截止日期仍未确定，开放报名前必须在赛事设置里填实；校园网/宿舍网/移动网络实测、备份值守和站外监控同样在开放报名前完成。
