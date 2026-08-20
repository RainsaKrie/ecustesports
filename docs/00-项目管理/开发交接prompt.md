# 开发交接 Prompt

> 把这段完整粘贴给新 AI 会话即可继续开发。

---

## 项目

《无畏契约》校园赛事 AI 排程协同助手（瓦理杯），Next.js 16.3.0 App Router + React 19 + TypeScript + Tailwind CSS 4，数据存本地 JSON（`data/site-config.json` + `data/events/{eventId}/`）。当前版本 3.26；本地 Git 重构前基线为 `ac0a306`。

> 重要状态：负责人已否决“工作台 v0.2 完成并进入 AI”的判断。2026-08-20 双角色真实浏览器审计不通过；在玩家侧、工作台和真实数据闭环验收通过前，禁止进入 AI 接入。权威问题清单见 `docs/09-测试与复盘/2026-08-20-双角色全流程产品审计.md`。

- 技术栈：Next.js 16.3.0（App Router）、React 19、TypeScript（strict）、Tailwind CSS 4、qrcode.react
- 运行：`npm run dev`（端口 3000）
- 类型检查：`node node_modules/typescript/bin/tsc --noEmit --incremental false`
- Node：使用系统命令 `node` / `npm`（当前环境 Node.js 22）
- 项目根目录：`D:\桌面\esports-operations-assistant`

## 设计基线

设计文档：`docs/04-产品定义/工作台系统设计_v0.2.md`（已确认冻结）。所有开发严格照此文档。核心要点：

1. **4 个模块**：01 策划案 / 02 报名与队伍 / 03 赛程（核心）/ 04 赛事设置
2. **无独立总览页**：生命周期条 + 模块状态徽标溶解到侧边栏，点赛事直接进赛程
3. **新建比赛 = 办赛申请**：三步流程（基础信息 + 赛制配置 + 策划案信息），一套填写产出赛事 + 策划案
4. **抽签 = 裁判直播面板**：对阵图先有骨架空卡片，抽签逐队填位（种子池 + 对阵图 + 逐队揭示，支持一键抽完）
5. **视觉**：无圆角、无黑卡片、品牌红 #ff4655、ink 结构线、白卡片

## 开发进度（7 步计划）

| 步骤 | 内容 | 状态 |
|---|---|---|
| 1 | 导航重构（4模块+生命周期入侧栏+并列列表） | ✅ 完成 |
| 2 | 03 赛程对阵图（骨架+报分弹框） | ✅ 完成 |
| 3 | 抽签面板（裁判直播） | ✅ 完成 |
| 4 | 新建比赛三步流程 | ✅ 完成 |
| 5 | 01 策划案（查看/编辑/导出PDF） | ✅ 完成 |
| 6 | 02 报名单列切换 + 04 设置精简 | ✅ 完成 |
| 7 | 全站删提示卡/统计卡/灰字 + 验证 | ✅ 完成 |

### 当前工程检查与产品验收状态

- tsc：0 错误
- ESLint：0 错误、0 警告
- 规则测试：20 / 20
- 完整闭环：64 / 64
- BP 测试：44 / 44
- 既有关键页面“能打开”巡检曾为 0 控制台错误，但不构成产品验收
- 双角色真实任务审计：不通过
- 已确认阻断：新赛事复制演示赛程、赛制未驱动对阵、抽签写死 16 队 GSL、并发报名丢写/失败、玩家侧 401、多赛事上下文串线、手机端布局破损

## 步骤 6 工程实现情况（产品验收未通过）

### 6a. 02 报名页 — 已完成并验证

文件：`src/app/admin/events/[id]/registration/page.tsx`

已完成的改动：
- 改为单列 + tab 切换（选手/队伍），不再并排
- 术语改为「选手报名截止」「队伍申报截止」（不用「冻结名单」）
- 删除顶部提示卡、统计卡

已验证页面加载、选手/队伍切换、代建入口与双截止状态。选手报名截止后已有选手仍可组队；队伍申报截止后停止建队和名单调整。旧 `frozen` 数据由 `normalizeRegistrationState` 兼容。

### 6b. 04 设置页 — 已完成并验证

文件：`src/app/admin/events/[id]/settings/page.tsx`

当前状态：已改为 `MODULE 04 / SETTINGS`，使用 `EventSettingsEditor`，并通过 `PATCH /api/admin/events` 按 URL 中的赛事 ID 保存。

当前只保留 4 组可编辑项：

| 分组 | 可编辑项 |
|---|---|
| 赛事信息 | 名称、主办方、状态、报名起止、比赛日期 |
| 参赛规则 | 规则列表（增删改） |
| 地图池 | 启用/停用地图（缩略图卡片） |
| 公开内容 | 本届赛事简介、奖项、海报、参赛准备事项 |

站点品牌、SEO、导航文字等平台级字段已从单赛事设置移除。

参考数据模型：`src/lib/site-config-schema.ts` 中的 `EditableEvent` 接口。赛事设置通过 `PATCH /api/admin/events` 保存；策划案继续使用 proposal API。

## 步骤 7 工程清理情况（产品验收未通过）

已删除 `FrameworkNotice`、旧 `SiteContentEditor` 与遗留模块编号；同时修复二维码 hydration、多赛事玩家页取错当前赛事、双截止兼容覆盖等问题。关键后台和玩家页面已完成浏览器巡检。

## 关键文件索引

| 文件 | 作用 |
|---|---|
| `src/lib/operations-data.ts` | 4 模块定义 + 状态徽标 + 生命周期条 |
| `src/lib/site-config-schema.ts` | 数据模型（EditableEvent 含 stageConfigs + proposal 字段） |
| `src/lib/scheduling/format-templates.ts` | 赛制模板（StageConfig 类型 + buildEventFromTemplate） |
| `src/lib/scheduling/bracket.ts` | 对阵图生成逻辑 |
| `src/components/admin/AdminSidebar.tsx` | 侧边栏（生命周期条 + 状态徽标 + 返回入口） |
| `src/components/admin/EventListSwitcher.tsx` | 赛事列表切换器 |
| `src/app/admin/page.tsx` | L1 赛事列表页 |
| `src/app/admin/layout.tsx` | admin 布局 |
| `src/app/admin/events/[id]/page.tsx` | 赛事入口（重定向到 /schedule） |
| `src/app/admin/events/[id]/schedule/page.tsx` | 03 赛程（对阵图核心） |
| `src/app/admin/events/[id]/schedule/draw/page.tsx` | 抽签面板（裁判直播） |
| `src/app/admin/events/new/page.tsx` | 新建比赛三步流程 |
| `src/app/admin/events/[id]/planning/page.tsx` | 01 策划案 |
| `src/app/admin/events/[id]/registration/page.tsx` | 02 报名（已改写待验证） |
| `src/app/admin/events/[id]/settings/page.tsx` | 04 设置（已精简） |
| `src/components/admin/EventSettingsEditor.tsx` | 单赛事四组设置编辑器 |
| `src/app/admin/events/[id]/format/page.tsx` | 重定向到 /schedule |
| `src/app/admin/events/[id]/notifications/page.tsx` | 重定向到 /schedule |
| `src/app/admin/events/[id]/report/page.tsx` | 重定向到 /schedule |
| `src/app/api/admin/events/route.ts` | 赛事 CRUD API |
| `src/app/api/admin/events/proposal/route.ts` | 策划案更新 API |
| `src/app/globals.css` | 全局样式（含打印 PDF 样式） |

## 数据模型要点

`EditableEvent`（在 `site-config-schema.ts`）新增字段：
- `stageConfigs: StageConfig[]` — 赛制阶段配置（新建比赛第二步产出）
- `proposal: { background, purpose, budget, prizes, leader, contact }` — 策划案信息（第三步产出）
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
  await check("策划案","http://localhost:3000/admin/events/event-1/planning",["策划案"]);
  await check("报名页","http://localhost:3000/admin/events/event-1/registration",["选手","队伍"]);
  await check("设置页","http://localhost:3000/admin/events/event-1/settings",[]);
  await check("抽签面板","http://localhost:3000/admin/events/event-1/schedule/draw",["抽签"]);
  await check("新建比赛","http://localhost:3000/admin/events/new",["基础信息","赛制配置","策划案信息"]);
})();
'
```

## 立即开始

当前不是 AI Gate，而是“产品稳定与真实验收阶段”。严格按以下顺序继续：

1. 修复数据隔离、空状态、并发报名和草稿发布边界。
2. 打通赛制配置 → 对阵骨架 → 抽签 → 赛程的真实数据链，彻底移除正式流程中的演示数据回退。
3. 重做玩家移动端任务架构，补齐资料更正、组队同意和“我的赛事”。
4. 重做工作台上下文、对阵图布局和异常运营操作。
5. 由彭杰亲自完成小型验收赛，再决定是否允许进入 AI Gate。
