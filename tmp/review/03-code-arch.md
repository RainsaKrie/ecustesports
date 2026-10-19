# src 代码系统结构审查（task-3，只读）

> 审查对象：`src` 232 个文件（app 73 / components 44 / hooks 5 / lib 108 / types 1 / proxy 1）。
> 已跳过 `node_modules`、`.next`、`.next-build`、`.workbuddy`。
> **行数口径与架构守卫一致**：`readFileSync(...).split("\n").length`（含空行），因此可与 `tools/arch/arch-baseline.json` 直接对照；注意用 `Get-Content | Measure-Object -Line` 会少算空行，两类数字不可混用。
> 审查方式：静态阅读 + `grep`/`glob` 实测；**未运行测试**。文中「守卫会绿」是按守卫源码同款判据静态复算的结论（超限 20 个、跨层 22 个、lib 内 hooks 0 个，与基线数量一致）。
> 数据清点：app = 31 个 `page.tsx` + 4 个 `layout.tsx` + 35 个 `route.ts` + `globals.css`/`favicon.ico`/`app/referee/RefereeWorkbench.tsx`；components = admin 23 / events 13 / layout 4 / ui 2 / legacy 2；lib = domains 78（50 源 + 28 测试）+ games 4 + application 2 + 顶层 24。源码非测试 TS/TSX 约 27,350 行，src 测试 34 个 / 7,659 行，`globals.css` 1,966 行。

---

## 0. 结论摘要（按严重度）

1. **「app → components → hooks → domains → application → data-store」只落地了第一段，中间两层是纸面架构。** `lib/application` 仅 2 文件 262 行，35 个 API 路由中只有 2 个经过它（`src/app/api/admin/events/stage/route.ts:5`、`src/app/api/public/schedule/request/route.ts:4`）；22 个界面文件仍在直连数据层并被冻结进 arch 基线（`tools/arch/arch-baseline.json:25-48`）。写编排实际发生在 route 与 domain 两处。
2. **领域归位只做了一半：结果域「壳」归位，肉还留在 schedule。** `src/lib/domains/result/reporting-data.ts:10` 直连 `@/lib/data-store`，并在 `:27-31,:46-47,:613` 反向依赖 `domains/schedule` 的 5 个模块；`result-ops/referee-ops/evidence-ops/reporting-service/result-domain/referee-domain/evidence-domain` 等 11 个非赛程文件（2,741 行）+ 8 个测试（2,278 行）仍躺在 `domains/schedule` 下。
3. **赛制类型体系正在裂成两套，且最新「自定义赛制」功能是 UI 通了、引擎没接。** 新旧两个 `StageType` 联合（`format-templates.ts:14` 5 种 vs `stage-chain-rules.ts:12` 6 种），类型→文案/白名单至少 6 处；`swiss.ts`/`round-robin.ts` 引擎全仓**只被自己的测试 import**；编辑器 5 个预设中 3 个是 `resolveSupportedFormat` 判定的 unsupported；`group-single-elim` 会被服务端白名单静默丢弃。
4. **「守卫全绿」不等于结构健康。** 三条 arch 守卫只查「UI→4 个内核入口」一个方向，且基线按**路径**只减不增：`FormatDrawWorkspace.tsx` 已从基线的 948 行涨到 975 行仍绿；`globals.css` 1,966 行是 src 最大文件，却因守卫只 walk `.ts/.tsx` 完全不在行数规则内；`stage-type-registry.test.ts` 的「单一真源」只扫 4 处，10-19 新增的第 5/6 处不在名单里。
5. **双后端「接口签名一致、运行语义不一致」。** file 后端 `read` 对**任何**错误（含 JSON 损坏）静默返回 fallback，supabase 后端抛错/重试；批量原子性一端是进程内锁 + 尽力回滚，另一端是 RPC 事务；`data-store-batch.test.ts` 里 Supabase 一侧全是 mock fetch，20 并发只测了 file。

---

## ① 分层依赖实测表

### 1.1 依赖方向实测

| # | 规则 | 结果 | 证据 |
|---|---|---|---|
| L1 | 界面层（app/components/hooks）不得直连数据访问（`data-store`/`supabase-config`/`public-data-cache`） | ❌ **22 个文件仍在基线**：15 个 API 路由直连 + 2 个路由经 `public-data-cache` + 5 个页面/布局 | `tools/arch/arch-baseline.json:25-48`；`src/app/api/admin/events/route.ts:13`；`src/app/api/data/schedule/route.ts:1`；`src/app/admin/events/[id]/layout.tsx:7`；`src/app/api/public/schedule/route.ts:7`；`src/app/page.tsx:9` |
| L2 | `lib/domains` 不得反向 import `app/`、`components/`、`hooks/` | ✅ **0 例**（这是重构做对的地方） | 对 `src/lib` grep `@/(components|app|hooks)` 与相对路径 `(components|app)/` 均无匹配 |
| L3 | `lib/domains` 不得依赖基础设施（data-store/data-backend/supabase-config） | ❌ **2 例** | `src/lib/domains/result/reporting-data.ts:10`（`readEventData/updateEventData/updateEventDataBatch/writeEventData`）；`src/lib/domains/result/evidence-store.ts:16-18`（`data-store-types` + `data-backend` + `supabase-config`，并在 `:12` 标了 `server-only`） |
| L4 | 跨领域只允许发生在 `lib/application`（`advance-stage.ts:4-10` 自述「L2 唯一允许跨领域」） | ❌ result 域实现反向 import schedule 域 5 个模块；且「跨域」的实体本身仍放在 schedule 里 | `reporting-data.ts:27-31`（referee-ops/result-ops/evidence-ops）、`:46-47`（reporting-service/result-ops）、`:613`（re-export schedule 的类型）；`src/lib/domains/schedule/{result-ops,referee-ops,evidence-ops,reporting-service}.ts` |
| L5 | 写操作应经 application 用例 | ❌ **2/35 路由**：`advance-stage` 1 条、`reschedule` 1 条；而 15 条路由直接 `readEventData/writeEventData/updateEventData` | `src/app/api/admin/events/stage/route.ts:5`；`src/app/api/public/schedule/request/route.ts:4`；`src/lib/application/reschedule.ts:15`（application 自己也直连 data-store）；其余见 L1 证据 |
| L6 | `app/` 只放路由/页面，业务组件放 `components/` | ❌ 882 行客户端组件住在 app 下，且 `page.tsx` 只是薄壳 | `src/app/referee/RefereeWorkbench.tsx:1`（`"use client"`）、`:106`；`src/app/referee/page.tsx:1,10` |
| L7 | components 应经 hooks 访问领域 | ⚠️ 部分成立：hooks 只 import 领域（`src/hooks/useSchedule.ts:9-26`），但全仓 `.tsx` 直接 import `@/lib/domains/**` 有 **57 处**；hooks 仅被 9 处使用；`useRegistration`（271 行）**全仓无 import** | 57 处 grep；`src/hooks/useRegistration.ts:17`（唯一引用在 `src/lib/games/game-data-single-source.test.ts:122` 的登记清单里） |
| L8 | tools 单向依赖 src，src 不依赖 tools | ✅ 成立，且注释明确写了为什么 | `src/lib/domains/result/result-vision.ts:6-10`；`tools/ai-eval/result-vision/adapters.ts:23,207` |
| L9 | 领域内部「纯类型 / 引擎 / 状态操作」分层 | ⚠️ schedule 33 个源文件中 6 个类型、10 个引擎、17 个 ops（见 ③）；结果/裁判/凭证/报名的实现混在 schedule 里 | 见 ③ 3.2 |

**一句结论**：允许的依赖（UI→domain、hooks→domain、tools→src）没有被破坏；**禁止的依赖（UI→infra、domain→infra、domain↔domain）和「应经 application」都没有被执行**，且前者被基线合法化。

### 1.2 守卫实际覆盖了什么、漏了什么

| 守卫 | 定义 | 覆盖的真实风险 | 关键盲区 |
|---|---|---|---|
| `tools/arch/arch-guards.test.ts` | 3 条：文件 >400 行/页面 >300 行；`src/lib` 内不许导出 `useXxx`；界面不许 import 4 个内核入口。基线棘轮只减不增 | 行数增量、hooks 位置、UI 直连数据层 | ① 方向只查「UI→kernel」一条（`:25,64-71`），不查 kernel→UI、domain→infra、domain↔domain；② 基线只认路径（`:99-105`），同一文件可无限增长（`FormatDrawWorkspace` 基线 948 → 实测 975 仍绿，`arch-baseline.json:8`）；③ `walk` 只收 `.ts/.tsx`（`:34`）→ 1,966 行的 `globals.css` 永不被行数规则覆盖；④ `isPage` 只匹配 `/page.tsx$`（`:39`），app 下的 `RefereeWorkbench.tsx` 按 400 判；⑤ deep import 用精确正则 `from "@/lib/<entry>"`（`:68`），re-export/单引号/相对路径/包装层（如 24 处调用的 `site-config`，其自身 import data-store）不计入；⑥ 测试文件排除在行数规则外（`:50`），`full-loop.test.ts` 611 行。 |
| `tools/ui/ui-guards.test.ts` | 对比度、非 transform 动画、焦点样式、裸间距/`transition-all` 基线 | 视觉可访问性 | 没有文件体量规则；`globals.css` 虽被读入（`:17`）但只用于令牌提取（`:25-37`）。 |
| `src/lib/api-route-guards.test.ts`（571 行） | 全部写路由的鉴权归属、单一鉴权实现、留痕登记、写路由清单冻结（`:1-32,73-75`） | **本仓库最强的一条结构守卫**，真实覆盖「新增路由漏鉴权/漏留痕」 | 只管安全契约，不管分层。 |
| `src/lib/domains/schedule/stage-type-registry.test.ts`（122 行） | 阶段类型「单一真源」：`STAGE_TYPE_LABELS` 覆盖 4 个登记点（`:61-66`） | 2026-10-14 漏登记导致文案空白那类问题 | **没有跟上 10-19 的变化**：新 `stage-chain-rules.ts:12` 的第二套 `StageType`、`api/admin/events/format/route.ts:66` 的新白名单、`StageChainEditor.tsx:44-51` 的类型表都不在扫描名单；守卫仍全绿，但「散落处」已从 7 处变 9+ 处（`EventHandbook.tsx:22-25` 自己也点明这是「全仓库第四处映射」）。 |
| `src/lib/domains/schedule/schedule-write-contract.test.ts`（234 行） | 赛程写入点契约（递增 version、登记间接写入） | 并发写丢数据 | 只覆盖赛程文档，不覆盖数据层其他文档。 |

---

## ② 最大文件清单 + 拆分建议

### 2.1 src 最大的 20 个文件（守卫同款行数口径）

| # | 文件 | 行数 | 类型 | 判断/拆分建议 |
|---|---|---|---|---|
| 1 | `src/app/globals.css` | 1,966 | 样式 | **守卫行数规则不覆盖**。Tailwind 4 令牌 + 管理端组件类集中一处；建议按 `tokens / admin / public / print` 拆文件，并在 arch 守卫里加 CSS 体量规则 |
| 2 | `src/components/admin/FormatDrawWorkspace.tsx` | 975 | 客户端组件 | 上帝组件：**24 个 `useState`**（`:82-112`）、9 个领域模块 import（`:8,18-22,34-36`），抽签/换赛制/发布三套流程 + 自定义赛制弹窗（`:654`）塞在一个组件。建议抽 `useFormatDraw()` + `<DrawBoard/>` + `<FormatSwitchPanel/>` |
| 3 | `src/app/admin/events/[id]/schedule/page.tsx` | 896 | 页面（>300 阈值） | **20 个 `useState`**（`:132-175`），自带 `BracketCard`、报分弹窗、批量排期、冻结、换人面板。建议拆到 `components/admin/schedule/*` + 复用 `useSchedule` |
| 4 | `src/app/referee/RefereeWorkbench.tsx` | 882 | 客户端组件（位置错误） | 应移到 `components/referee/`；登录/我的比赛/逐局传图/汇总提交四段流程可拆 3-4 个组件 |
| 5 | `src/lib/domains/schedule/schedule-ops.ts` | 826 | 领域 ops | **32 个导出**（`:24-820`）：版本与保存、改期申请生命周期、报分校验、对阵推进、冻结、通知、BP 地图。建议按 `schedule-save / requests / results / bp` 拆 4 个模块（这是最值得拆的领域文件） |
| 6 | `src/components/admin/RegistrationOperationsWorkspace.tsx` | 779 | 客户端组件 | 15 个 `useState`（`:60-79`）+ 直接 fetch 3 处（`:85,224,265`）；选手/队伍/审核/名单/回收站多 tab 可拆 |
| 7 | `src/lib/domains/result/reporting-data.ts` | 753 | **错层的 application** | 21 个导出（`:79-746`）：数据读取（`:10`）+ 裁判端登录/认领/报分/传图 + 管理端复核/纠错/裁判管理 + demo 种子（`:262`）。应移入 `lib/application/reporting/*`，并拆「裁判用例 / 管理用例 / 数据映射」 |
| 8 | `src/lib/domains/schedule/format-templates.ts` | 621 | 领域数据+逻辑 | 模板常量（含 `val-6rr` 循环赛模板 `:347-375`）+ 场次估算（`:44-89`）+ 赛事构建（`:570`）。建议模板数据独立文件，函数单独 |
| 9 | `src/lib/domains/schedule/full-loop.test.ts` | 611 | 测试 | 长测试是「全链路契约」的价值，可不拆；但说明领域测试在替代集成测试 |
| 10 | `src/components/admin/EventSettingsWorkspace.tsx` | 610 | 客户端组件 | 赛事信息/规程/地图池/发布设置多段表单 |
| 11 | `src/lib/api-route-guards.test.ts` | 571 | 守卫测试 | 同上，属契约型长测试 |
| 12 | `src/lib/site-config-schema.ts` | 568 | 全局 schema | `EditableEvent` 类型 + 默认值 + 全量归一化（`:440-487`）+ 校验；建议拆 `schema/normalize/defaults`，并解决它与 `types/index.ts` 双模型 |
| 13 | `src/lib/domains/schedule/reporting-service.ts` | 547 | **错域的领域服务** | 20 个导出（`:35-521`）全是报分/裁判/复核投影，属 result 域。随 ③ 的域搬迁一起走 |
| 14 | `src/lib/domains/schedule/registration-admin-ops.ts` | 532 | **错域的领域 ops** | 24 个导出（`:13-527`），与 `registration-ops.ts` 有 4 对同名 op（见 ③） |
| 15 | `src/lib/domains/schedule/registration-admin-ops.test.ts` | 523 | 测试 | 随模块搬迁 |
| 16 | `src/lib/domains/result/result-vision.ts` | 522 | AI 识别 | 提示词 + 解析（`PROMPT_VERSION` `:14`）；可拆「提示词/契约/解析」但属高风险区，建议仅拆常量与解析 |
| 17 | `src/lib/domains/schedule/reporting-service.test.ts` | 510 | 测试 | 随模块搬迁 |
| 18 | `src/app/bp/[id]/page.tsx` | 458 | 页面（>300） | BP 对局页，页面级业务偏重 |
| 19 | `src/components/admin/ReviewWorkspace.tsx` | 435 | 客户端组件 | 复核队列 + 详情；`import type` 自 reporting-data（`:14`） |
| 20 | `src/lib/domains/schedule/group-single-elim.test.ts` | 406 | 测试 | 6 组场景，保留 |

紧随其后：`result-ops.ts` 400、`identity-match.ts` 391、`app/events/[id]/manage/page.tsx` 390（页面 >300）、`src/app/api/admin/events/route.ts` 373、`supabase-data-store.ts` 362、`hooks/useSchedule.ts` 362、`api/data/bp/route.ts` 265。

### 2.2 点名检查：最近重构过的 4 个文件是否降到阈值内

| 文件 | 实测 | 拆分产物 | 结论 |
|---|---|---|---|
| `bracket-engine.ts` | 353 | `bracket-engine-core.ts` 91（常量/工厂 `:10`） | ✅ <400 |
| `staged-format.ts` | 300 | `staged-format-draw.ts` 164（`:296` re-import 工具组） | ✅ <400 |
| `identity-match.ts` | 391 | `identity-match-keys.ts` 26（`:4-7` 说明为回 400 线抽出） | ✅ <400，且 re-export 保持调用方不变 |
| `EventHandbook.tsx` | 264（+ `EventHandbookParts.tsx` 160） | 拆成展示部件 | ✅ <400 |

**但拆分有代价**：拆分产物没有独立测试文件（`bracket-engine-core`/`staged-format-draw` 仅被其他测试间接覆盖）；全仓 34 个 src 测试**全部在 `src/lib`**，`components`/`hooks`/`app` 零测试——也就是说「降行数」的收益可验证，「拆出的小文件没跑偏」不可验证。

---

## ③ 领域模块地图

### 3.1 域级清点

| 域 / 层 | 源文件 | 测试 | 源行数 | 测试行数 | 职责 | 问题 |
|---|---|---|---|---|---|---|
| `lib/domains/schedule` | 33 | 24 | 7,432 | 5,700 | 赛程/赛制/抽签/对阵/排期/报分 | **垃圾桶域**：混入 result/referee/evidence/registration 实现（见 3.3） |
| `lib/domains/result` | 10 | 3 | 2,209 | 518 | 赛果识别、身份匹配、失败响应、凭证存储、报分数据网关 | reporting-data（753）是 application+data access；result-vision（522）与 reporting-data 无直接单测；evidence-store 依赖基础设施 |
| `lib/domains/content` | 3 | 1 | 87 | 36 | 发布检查、限制 | 正常 |
| `lib/domains/identity` | 2 | **0** | 113 | 0 | 管理员会话、参赛者凭证 | 鉴权实现无直接测试（靠 api-route-guards 静态断言） |
| `lib/domains/registration` | 2 | **0** | 270 | 0 | 报名/队伍类型、种子/抽签配对 | 业务 ops 全在 schedule；本域 0 测试 |
| `lib/application` | 2 | **0** | 262 | 0 | 阶段推进、改期用例 | 覆盖率 2/35 路由；0 测试；一处仍直连 data-store |
| `lib/games` | 3+types | 1 | 259 | 243 | 游戏配置单一来源 | ✅ 结构良好（单源守卫按仓库路径扫描） |
| `lib` 顶层 | 24 | 6 | 2,362 | 1,162 | 数据层、站点配置、对象存储、限流、审计 | 双后端 + 3 条旁路 IO（见 ④）

### 3.2 `domains/schedule` 57 个文件构成（33 源 / 24 测试）

| 类别 | 文件（行数） | 合计 |
|---|---|---|
| 纯类型/常量 | `schedule-data.ts`(249)、`stage.ts`(89)、`schedule-mode.ts`(44)、`result-domain.ts`(132)、`referee-domain.ts`(120)、`evidence-domain.ts`(85) | 6 文件 / 719 行 |
| 引擎/算法/规则 | `bracket-engine.ts`(353)+`bracket-engine-core.ts`(91)、`staged-format.ts`(300)+`staged-format-draw.ts`(164)、`round-robin.ts`(64)、`swiss.ts`(101)、`bracket-blueprint.ts`(118)、`rule-engine.ts`(313)、`format-support.ts`(213)、`stage-chain-rules.ts`(242) | 10 文件 / 1,959 行 |
| 状态操作/服务 | `schedule-ops.ts`(826)、`format-templates.ts`(621)、`registration-admin-ops.ts`(532)、`reporting-service.ts`(547)、`result-ops.ts`(400)、`referee-ops.ts`(350)、`bp-ops.ts`(322)、`registration-ops.ts`(246)、`evidence-ops.ts`(234)、`bulk-schedule.ts`(146)、`event-progress.ts`(105)、`schedule-policy.ts`(96)、`bp.ts`(84)、`team-swap.ts`(81)、`schedule-freshness.ts`(69)、`public-roster.ts`(55)、`participant-recovery.ts`(40) | 17 文件 / 4,754 行 |

**错位到 schedule 的非赛程实现**（应随域归位搬走）：`registration-ops`(246)、`registration-admin-ops`(532)、`public-roster`(55)、`participant-recovery`(40)、`reporting-service`(547)、`result-ops`(400)、`referee-ops`(350)、`evidence-ops`(234)、`result-domain`(132)、`referee-domain`(120)、`evidence-domain`(85) 共 **11 文件 / 2,741 行**；对应测试 8 个 / **2,278 行**（`registration-admin-ops.test` 523、`reporting-service.test` 510、`referee-ops.test` 316、`registration-ops.test` 293、`evidence-ops.test` 235、`result-ops.test` 233、`public-roster.test` 132、`participant-recovery.test` 36）。
证据：`src/lib/domains/schedule/result-domain.ts:2`（RPT-01 赛果领域类型）、`referee-domain.ts:2`（RPT-02）、`evidence-domain.ts:2`（RPT-03）都自述归属；`src/lib/domains/result/reporting-data.ts:27-31,46-47` 反向依赖。

**重复实现（不是拆分，是两套）**：
1. `registration-ops.ts` 与 `registration-admin-ops.ts` 有 4 对同名操作：`createTeamOp:31`/`createTeamAdminOp:69`、`dissolveTeamOp:161`/`dissolveTeamAdminOp:457`、`renameTeamOp:189`/`renameTeamAdminOp:476`、`setMemberRoleOp:213`/`setMemberRoleAdminOp:490`。
2. **阶段场次估算有 3 套公式且互相矛盾**：
   - `format-templates.ts:44-89`：`single-elim-groups` = `groups*(per-1)`（4 组 16 队 = 每组 3 场 / 共 12 场，`:60-66`）；`gsl-groups` = 每组 5 场（`:67-74`）；`round-robin` = `groups*C(per,2)`（`:75-80`）。
   - `bracket-blueprint.ts:76-95`：`single-elim-groups` 同样 3 场/组（`:88-92`）、`gsl-groups` 5 场/组（`:87`），无 round-robin/swiss 分支。
   - `stage-chain-rules.ts:52-75`：`group-single-elim` 按**每组 6 场**（`:68-74`，且注释写「小组单败是组内循环」）、`gsl-groups` 5 场/组；这与 `group-single-elim.test.ts:7` 明确的「4 组 × 4 队 = 12 场」冲突；最近的提交 `e261cdf fix(schedule): GSL 每组场次估算 4 → 5；小组+单败 3 → 6` 正是把两套口径改岔的那次改动。
3. `StageType` 有两个不相等的联合：`format-templates.ts:14`（5 种，含 `round-robin`，无 swiss/group-single-elim）vs `stage-chain-rules.ts:12`（6 种，含 swiss/group-single-elim，无 `single-elim-groups`）。同一概念在三处白名单也不一致：`api/admin/events/route.ts:47`（5 种）、`api/admin/events/format/route.ts:66`（6 种，含 swiss）、`site-config-schema.ts:468`（5 种）；文案表另有两处：`format-templates.ts:26-41`、`EventHandbookParts.tsx:18`；`StageChainEditor.tsx:44-51` 还有一张。`EventHandbook.tsx:22-25` 自己注释承认「这是全仓库第四处阶段类型→文案映射」。

### 3.3 「有类型没引擎 / 有引擎没接线」

| 对象 | 状态 | 证据 |
|---|---|---|
| `round-robin` | **有引擎、零生产引用**。`round-robin.ts` 只被 `round-robin.test.ts:2` import；`format-support.ts:132-211` 没有任何 round-robin 分支 | grep：`from "./round-robin"` 仅测试命中；`format-templates.ts:347-355` 的 `val-6rr` 模板用了 round-robin → 该内置模板永远 `unsupported` |
| `swiss` | **有引擎、零生产引用**。`swiss.ts` 只被 `swiss.test.ts:2` import；`format-support`、`bracket-blueprint`、`staged-format` 均无 swiss 分支 | 同上；`stage-chain-rules.ts:146-156` 只做规则校验，不做对局生成 |
| `group-single-elim` | 引擎在 `bracket-engine.ts:272 buildGroupSingleElimMatches`（可运行），但**命名/链路断裂**：UI 叫「组内循环」（`StageChainEditor.tsx:48`），持久化走 `single-elim-groups`（`format-templates.ts:14`），而保存路由白名单里没有 `group-single-elim` → 被 `:75` 的 filter 静默丢弃 | `CustomFormatModal.tsx:70-72` 会构造该类型 → `api/admin/events/format/route.ts:66,75` 丢弃；若整条链只有它，`:76` 直接 400「赛段配置不完整」 |
| `playin-36` | 不是缺失引擎：由 `staged-format.ts` + `registration/format.ts:110 buildPlayInPairs` 组合实现，`playin-36.test.ts:9-12` 覆盖 | ✅ |
| 自定义赛制 → 抽签链路 | **保存时不校验可执行性**：`api/admin/events/format/route.ts` 全程没有调用 `resolveSupportedFormat`（对比新建赛事在 `api/admin/events/route.ts:65-68` 有调用），只在 `:79` 用 `formatChangeRefusal` 校验「已开打阶段不许改」。结果：可保存 swiss/round-robin/自编链 → 抽签页 `FormatDrawWorkspace.tsx:136-145` 直接 `setError` 并锁死（`drawMode` 默认 `"locked"`，`:86`）。 | 同上 |
| 编辑器内置模板可用性 | `StageChainEditor.tsx:60-82` 5 个模板中，**至少 3 个不可发布**：①「16 队 · 瑞士轮 + 单败」(`:65-68`)；②「32 队 · 小组 + 双败」(`:72-75`，`format-support.ts:191-205` 要求 gsl 16 队)；③「36 队 · 四段（现行）」(`:76-81`，末段 `single-elim`，而 `format-support.ts:147-148` 要求末段 `double-elim` 8 队）。 | `resolveSupportedFormat` 判据 `format-support.ts:139-205` |

---

## ④ 数据层风险

### 4.1 抽象与实现的真实分布

- **文档数据**：`DataStoreDriver` 接口（`src/lib/data-store-types.ts:15-32`）有 2 个实现：`file-data-store.ts`（进程内锁 + 原子写）与 `supabase-data-store.ts`（PostgREST + RPC 事务）；门面 `data-store.ts:14-16` 按 `resolveDataBackend()` 切换。**签名完全一致**，这点没问题。
- **旁路 IO 至少 3 条**：对象存储 `asset-store.ts:4-6` 与 `evidence-store.ts:16-18` 各自直连 Supabase Storage/本地盘；限流 `rate-limit.ts:62-102` 自己调 `consume_rate_limit` RPC；站点配置 `site-config.ts:4` 再包一层 data-store。
- 后端选择本身已收敛为单一来源（`data-backend.ts:34-40`，并有专门的单一来源守卫 `data-backend.test.ts:2-16`），这是数据层里做得最好的一处。

### 4.2 双后端语义差异（同一接口，不同行为）

| 维度 | file 后端 | supabase 后端 | 风险 |
|---|---|---|---|
| `read` 失败语义 | **任何异常**（文件不存在、JSON 损坏、权限）都返回 fallback（`file-data-store.ts:62-69`；`update` 内同逻辑 `:93-98`） | 仅「行不存在」返回 fallback；网络/401/5xx 重试后**抛错**（`supabase-data-store.ts:132-183,264-267`） | 本地绿、生产红：本地测试覆盖的「损坏即重置」在线上是 500 |
| 并发模型 | 进程内按 scope 队列，**读也加写锁**（`:17-32,60-70`），无超时；单进程假设 | 无进程内锁；每次请求 `AbortSignal.timeout(5_000)`（`:154`），CAS + 最多 40 次重试（`:271-282,291-307`） | 长 `update` 会阻塞同赛事全部读取；本地并发结论不能外推到生产 |
| 批量原子性 | 逐个写 + 失败后**尽力回滚**，回滚失败被 `.catch(() => undefined)` 吞掉（`:149-167`） | `update_app_documents_atomic` RPC：advisory lock + 全量版本校验 + 事务（`supabase/migrations/202609100001_rpt08_atomic_documents.sql:44,46-110`），冲突返回 40001 触发重试（`supabase-data-store.ts:230-261,325-350`） | 本地可能留下「部分写入且无告警」 |
| 批量缺失文档 | 用 fallback 当现值（`:127-137`） | 记 expected version 0，由 RPC 插入（`supabase-data-store.ts:329-333` + SQL `:90-93`） | 语义勉强对齐 |
| `deleteEvent` | `rm -rf data/events/<id>`（`:172-180`） | 只按 `event_id` 删除，**带 `return=minimal`、无 scope 条件**（`:353-360`） | 无对等测试 |
| 缓存/读取一致性 | 读被锁串行化，读后写有序 | 读走 PostgREST，无缓存（`cache:"no-store"`） | — |

### 4.3 测试覆盖不对称

- `data-store-batch.test.ts`：file 后端是**真跑**（`:94-131`，含 20 并发 `:102-111`、失败回滚 `:113-131`）；Supabase 一侧**全是 mock fetch**（`:34-90`），断言只有 4 条（`:79-82`），且只验证「请求体带版本、40001 重试」的契约。
- `supabase-data-store.test.ts` 只测读取层时钟偏差重试（`:1-12`），不测写/批量/删除。
- `deleteEvent`、`read` 容错、锁行为、`update` 冲突路径在两端都没有对等测试。
- 测试会真实写仓库内 `data/`（`data-store-batch.test.ts:118-119` 建目录），异常退出会留下测试目录（`.gitignore` 未覆盖 `data/` 时可污染工作区）。

### 4.4 额外发现：公共展示层仍走「legacy 双模型 + mock 兜底」

`configured-events.ts:13-38` 把 `EditableEvent` 转成 legacy `EsportEvent` 时用 `...mockEvent`（`:15`）铺底，只覆盖部分字段；`mockEvent` 内含 `matches: mockMatches`（32 队假对阵）与 `teams: mockTeams`（`mock-data.ts:124-125,154-155`）。目前公共页实际读的是新的 `registration/schedule` state（`EventDetailTabs.tsx:176`、`PublicSchedule.tsx:24`），所以**尚未爆发**；但任何新消费者读 `EsportEvent.matches/teams` 都会拿到 32 队 mock 数据。这是 `types/index.ts` 与 `site-config-schema.ts` 双事件模型的后遗症（`TournamentFormat` 等旧类型仍被 7+ 文件引用，`src/types/index.ts:9,106`）。

---

## ⑤ 建议动作（≤10 条，按优先级）

| 优先级 | 动作 | 验收判据 |
|---|---|---|
| **P0-1** | **先接线再展示**：`api/admin/events/format/route.ts` 保存自定义赛制前调用 `resolveSupportedFormat`（并将 `validateStageChain` 从客户端复用为服务端校验）；把 `swiss/round-robin/group-single-elim` 的可用性在保存时明确拒绝并给出原因。 | 保存 unsupported 赛制返回 400；抽签页不再出现「能存不能抽」；`CustomFormatModal` 收到服务端原因 |
| **P0-2** | **阶段类型单一真源**：新建 `lib/domains/schedule/stage-types.ts`（联合 + 标签 + 默认 BO + 白名单），删除 `format-templates.ts:14`、`stage-chain-rules.ts:12`、两处 `validTypes`（`api/admin/events/route.ts:47`、`format/route.ts:66`）、`site-config-schema.ts:468`、`EventHandbookParts.tsx:18`、`StageChainEditor.tsx:44-51` 的重复定义；把 `stage-type-registry.test.ts:61-66` 扩到所有登记点。 | 新增一种赛制类型只需改 1 个文件；守卫能拦截漏登记 |
| **P1-3** | **完成领域归位**：把 11 个非赛程实现（2,741 行 + 8 测试 2,278 行）迁到 `domains/result`（reporting/result/referee/evidence）与 `domains/registration`；`reporting-data.ts` 拆为 `application/reporting/{referee,admin}` + 数据访问。 | `grep "domains/schedule/(result|referee|evidence)"` 在 result 域外为 0；`domains/schedule` 文件数 57 → ~38 |
| **P1-4** | **收口数据访问**：把 L1 的 15 条直连路由按「route→application 用例」迁移，优先 5 条写路由（`admin/events`、`admin/registration`、`data/bp`、`public/team`、`public/register`）；`domains` 里 2 处直连改为用例注入/application。同时在 arch-guards 增加「domains 不得 import data-store/data-backend」规则，并把基线缩短。 | 深链基线 22 → ≤10 且只减不增；新增规则能拦住新增违规 |
| **P1-5** | **拆三大文件**：`reporting-data.ts`(753) 按 1-3；`schedule-ops.ts`(826) 拆为 save/requests/results/bp 四模块；`FormatDrawWorkspace.tsx`(975)、`schedule/page.tsx`(896)、`RefereeWorkbench.tsx`(882) 拆 hook + 子组件。 | 单文件回 400 以内，且拆分后补最小回归（抽签/发布/报分各一条） |
| **P2-6** | **数据层语义对齐**：抽 `DataStoreDriver` 契约测试套件（file + 内存 fake 同跑；supabase 用 mock fetch 契约）；`file.read` 区分「不存在」与「JSON 损坏/IO 错误」；回滚失败不再静默；补 `deleteEvent` 两侧测试。 | 同一套契约测试两端全绿；损坏文件不再被静默覆盖 |
| **P2-7** | **清死代码/死链路**：删除或接入 `useRegistration`（271 行，全仓无 import）；处理 `mock-data`+`configured-events` 双模型（禁止 `...mockEvent` 铺底，或整体迁到 `EditableEvent`）；确认 `round-robin/swiss` 的去向（接线或从 UI 隐藏）。 | `useRegistration` 有使用方或删除；公共事件对象不再含 mock 对阵 |
| **P2-8** | **升级 arch 守卫**：补 4 类方向规则（domains↛UI、domains↛infra、跨域白名单、application 调用覆盖率下限）；行数基线改为「同一路径行数不得增长」；把 `.css` 纳入行数（当前最大文件 1,966 行不受控）；`isPage` 覆盖 app 下 layout/客户端组件。 | `FormatDrawWorkspace` 再涨会红；CSS 超限会红；跨域 import 会红 |
| **P3-9** | **统一场次估算**：抽 `expectedMatchCount(stage)` 单一实现，替换 `format-templates.ts:44-89`、`bracket-blueprint.ts:76-95`、`stage-chain-rules.ts:52-75` 三套公式，先裁决「组内单败/组内循环 3 场 vs 6 场」与 GSL 4 vs 5 的口径（提交 `e261cdf` 引入的分歧）。 | 三处调用同一函数；`group-single-elim.test.ts` 与 `stage-chain-rules.test.ts` 口径一致 |
| **P3-10** | **补上层测试**：当前 34 个 src 测试 100% 在 `src/lib`；hooks 928 行 0 测试（`useSchedule.ts:35-58` 的并发保存/自动同步逻辑最复杂），components/app 0 测试。至少给 `useSchedule`、抽签发布、报分提交流程补集成级测试。 | `hooks/` 有测试文件；关键流程有回归 |

---

### 附：未能覆盖/需注意

- 本报告未运行 `npm run test:*`（只读任务），「守卫会绿」是按守卫源码判据静态复算；真实执行可能有环境差异（如 `data/` 权限、缺失 `.env`）。
- 未审查 `.next-build` 产物、构建配置（`next.config.ts`/`tsconfig.json` 仅用于确认路径别名）与 `tools/` 内部实现（除守卫文件）。
- 行数均为当前工作区实测；`arch-baseline.json` 中记录的是基线时刻的行数，两者可能漂移（本报告已标出 `FormatDrawWorkspace` 948→975 这一处）。
