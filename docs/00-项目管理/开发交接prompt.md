# 开发交接 Prompt

> 把这段完整粘贴给新 AI 会话即可继续开发。

---

## 项目

《无畏契约》校园赛事 AI 排程协同助手（瓦理杯），Next.js 14 App Router + TypeScript + Tailwind CSS，数据存本地 JSON（`data/site-config.json` + `data/events/{eventId}/`）。

- 技术栈：Next.js 14（App Router）、TypeScript（strict）、Tailwind CSS、qrcode.react
- 运行：`npm run dev`（端口 3000）
- 类型检查：`node node_modules/typescript/bin/tsc --noEmit --incremental false`
- Node 路径：`C:/Users/ROG/.workbuddy/binaries/node/versions/22.22.2/node.exe`
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
| 6 | 02 报名单列切换 + 04 设置精简 | 🔶 进行中 |
| 7 | 全站删提示卡/统计卡/灰字 + 验证 | ⬜ 未开始 |

### 当前 tsc 状态：通过（0 错误）

## 步骤 6 剩余工作（继续从这里开始）

### 6a. 02 报名页 — 已改写，需验证

文件：`src/app/admin/events/[id]/registration/page.tsx`

已完成的改动：
- 改为单列 + tab 切换（选手/队伍），不再并排
- 术语改为「选手报名截止」「队伍申报截止」（不用「冻结名单」）
- 删除顶部提示卡、统计卡

需验证：页面能否正常加载，tab 切换是否工作，报名截止/代建队伍功能是否正常。

### 6b. 04 设置页 — 尚未精简（这是要做的）

文件：`src/app/admin/events/[id]/settings/page.tsx`

当前状态：还是旧版（743 字节，14 行），引用 `SiteContentEditor` 组件，标题还是 "MODULE 08 / GOVERN"。

需改为 v0.2 设计的精简版，只留 4 组可编辑项：

| 分组 | 可编辑项 |
|---|---|
| 赛事信息 | 名称、主办方、状态、报名起止、比赛日期 |
| 参赛规则 | 规则列表（增删改） |
| 地图池 | 启用/停用地图（缩略图卡片） |
| 公开内容 | 首页文案、主视觉（如需） |

删除与赛事运行无关的琐碎字段（站点品牌、SEO、导航文字等全站级配置下放或隐藏）。

参考数据模型：`src/lib/site-config-schema.ts` 中的 `EditableEvent` 接口。编辑通过 API `PATCH /api/admin/events` 或 `proposal` API 模式。

## 步骤 7 工作（设置页做完后）

全站清理：
1. 删除所有 `FrameworkNotice` 提示卡组件引用
2. 删除统计卡（如报名页的统计数字卡）
3. 删除冗余灰字（"数据保存在本地"等解释性文字）
4. 跑 tsc 确认 0 错误
5. 启动 dev server 冒烟验证所有页面可正常加载

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
| `src/app/admin/events/[id]/settings/page.tsx` | 04 设置（待精简） |
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
- 做页面/功能前，先用 impeccable + grill-me skill 过设计决策

## 冒烟验证方法

```bash
# 启动 dev server
cd "D:/桌面/esports-operations-assistant"
"C:/Users/ROG/.workbuddy/binaries/node/versions/22.22.2/node.exe" node_modules/next/dist/bin/next dev -p 3000 &

# 生成 admin token 并验证
"C:/Users/ROG/.workbuddy/binaries/node/versions/22.22.2/node.exe" -e '
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

1. 读 `docs/04-产品定义/工作台系统设计_v0.2.md` 了解设计基线
2. 读 `src/app/admin/events/[id]/registration/page.tsx` 验证步骤 6a
3. 精简 `src/app/admin/events/[id]/settings/page.tsx`（步骤 6b）
4. tsc + 冒烟验证
5. 做步骤 7（全站清理 + 验证）
