// =====================
// 赛制模板库：办赛者新建比赛时「选择而不是填写」赛制
// 每个模板包含阶段结构、默认规则文案、默认硬约束与地图池
// 新建比赛时按模板实例化赛事（规则、赛制摘要、约束就绪）
// =====================

import type { EditableRule } from "@/lib/site-config-schema";
import type { EditableEvent } from "@/lib/site-config-schema";
import { getGameConfig } from "@/lib/games";

/** 默认图池（取自游戏配置层）。 */
const DEFAULT_MAP_POOL = getGameConfig().defaultMapPool;

export type StageType = "single-elim" | "single-elim-groups" | "gsl-groups" | "double-elim" | "round-robin" | "swiss";

/** 一个比赛阶段的可配置项（新建比赛赛制配置器的产物） */
export interface StageConfig {
  name: string;
  type: StageType;
  teamCount: number;
  boType: "BO1" | "BO3" | "BO5";
  /** gsl-groups / single-elim-groups / round-robin 的分组数 */
  groupCount?: number;
}

export const STAGE_TYPE_LABELS: Record<StageType, string> = {
  "single-elim": "单败淘汰",
  "single-elim-groups": "组内单败",
  "double-elim": "双败淘汰",
  "gsl-groups": "GSL 小组双败",
  "round-robin": "单循环",
  "swiss": "瑞士轮",
};

/** 赛制类型的默认 BO（新建阶段时预填） */
export const STAGE_TYPE_DEFAULT_BO: Record<StageType, "BO1" | "BO3" | "BO5"> = {
  "single-elim": "BO1",
  "single-elim-groups": "BO3",
  "double-elim": "BO3",
  "gsl-groups": "BO3",
  "round-robin": "BO1",
  "swiss": "BO3",
};

/** 由阶段配置估算总场次与比赛小时数 */
export function estimateStageConfig(stages: StageConfig[]): { matchCount: number; hourEstimate: number } {
  const DURATION: Record<string, number> = { BO1: 45, BO3: 90, BO5: 150 };
  let matchCount = 0;
  let minutes = 0;
  for (const [index, st] of stages.entries()) {
    const dur = DURATION[st.boType] ?? 90;
    let matches = 0;
    switch (st.type) {
      case "single-elim":
        // 若后面还有阶段，本阶段只淘汰到下一阶段的队伍数。
        matches = Math.max(0, st.teamCount - (stages[index + 1]?.teamCount ?? 1));
        break;
      case "double-elim":
        // 双败：2n-2 场（含败者组，决赛不重置）
        matches = st.teamCount > 1 ? st.teamCount * 2 - 2 : 0;
        break;
      case "single-elim-groups": {
        // 组内单败：每组「组内队数 − 1」场（4 队组 = 3 场：2 半决赛 + 1 决赛）
        const groups = st.groupCount ?? 1;
        const per = Math.max(2, Math.floor(st.teamCount / groups));
        matches = groups * (per - 1);
        break;
      }
      case "gsl-groups": {
        const groups = st.groupCount ?? 1;
        const per = st.teamCount / groups;
        // GSL 每组 5 场（4 队组）
        matches = groups * 5;
        void per;
        break;
      }
      case "round-robin": {
        const groups = st.groupCount ?? 1;
        const per = st.teamCount / groups;
        matches = groups * (per * (per - 1)) / 2;
        break;
      }
    }
    const roundedMatches = Math.round(matches);
    matchCount += roundedMatches;
    // 8 队双败的败者组决赛与总决赛固定为 BO5，不能把 14 场全部按 BO3 估算。
    minutes += st.type === "double-elim" && roundedMatches >= 2
      ? Math.max(0, roundedMatches - 2) * dur + 2 * DURATION.BO5
      : roundedMatches * dur;
  }
  return { matchCount, hourEstimate: Math.round(minutes / 60) };
}

/** 阶段配置 → 赛制摘要文案（写入赛事与竞赛规程） */
export function stageConfigSummary(stages: StageConfig[]): string {
  return stages.map((st) => {
    const label = STAGE_TYPE_LABELS[st.type];
    return `${st.name}（${st.teamCount} 队 · ${label} · ${st.boType}）`;
  }).join(" → ");
}

export interface FormatTemplateStage {
  /** 阶段名，如「入围赛」「小组赛」「淘汰赛」 */
  name: string;
  /** 阶段结构类型 */
  type: StageType;
  /** 该阶段参赛队伍数 */
  teamCount: number;
  /** 分组数（gsl-groups / round-robin 用） */
  groupCount?: number;
  /** 每局类型 */
  boType: "BO1" | "BO3" | "BO5";
  /** 晋级描述 */
  advance: string;
}

export interface FormatTemplateConstraints {
  /** 同一时段最大并发场次（硬约束 HC-03） */
  maxConcurrent: number;
  /** 各 BO 类型预留时长（分钟） */
  durations: { BO1: number; BO3: number; BO5: number };
  /** 每日可比赛时间窗 */
  sessionStart: string;
  sessionEnd: string;
  /** 比赛日（1=周一 … 7=周日） */
  matchdays: number[];
}

export interface FormatTemplate {
  id: string;
  /** 模板名（向导中展示） */
  name: string;
  /** 适用规模描述 */
  scale: string;
  /** 一句话说明 */
  description: string;
  /** 总队伍数 */
  teamCount: number;
  /** 每队首发人数（默认 5） */
  teamSize: number;
  stages: FormatTemplateStage[];
  /** 赛制摘要（写入赛事 stageSummary） */
  stageSummary: string;
  /** 预估总场次 */
  matchCount: number;
  /** 预估比赛小时数 */
  hourEstimate: number;
  /** 默认规则文案（新建比赛时写入赛事规则，可在后台修改） */
  defaultRules: EditableRule[];
  /** 默认硬约束（写入排程规则） */
  constraints: FormatTemplateConstraints;
  /** 默认地图池（引用 maps 目录 id） */
  mapPoolIds: string[];
}

/** 内置赛制模板（覆盖当前真实赛与常见校园赛规模） */
export const FORMAT_TEMPLATES: FormatTemplate[] = [
  {
    id: "val-36playin-32qual-16gsl-8de",
    name: "36 队 · 资格赛 + 入围赛 + GSL 小组赛 + 双败淘汰",
    scale: "36 队",
    description: "报名队伍超出 32 个入围赛席位时使用。最弱的 8 支先打 4 场资格赛（同档互打、BO1），4 支胜者并入入围赛，之后与 32 队标准赛制一致。",
    teamCount: 36,
    teamSize: 5,
    stages: [
      { name: "资格赛", type: "single-elim", teamCount: 8, boType: "BO1", advance: "4 支队伍并入入围赛" },
      { name: "入围赛", type: "single-elim", teamCount: 32, boType: "BO1", advance: "16 支队伍晋级" },
      { name: "小组赛", type: "gsl-groups", teamCount: 16, groupCount: 4, boType: "BO3", advance: "每组 2 支队伍晋级" },
      { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3", advance: "冠军产生" },
    ],
    stageSummary: "36 队 → 最弱 8 队打资格赛（同档互打）→ 32 队单败入围（BO1）→ 16 队 GSL → 8 队双败",
    matchCount: 54,
    hourEstimate: 70,
    defaultRules: [
      { title: "参赛规模", detail: "赛事设置 36 个参赛席位，每支队伍注册 5 名首发选手。" },
      { title: "资格赛", detail: "依首发 5 名选手报名截止时的段位平均分排序，最弱的 8 支队伍参加资格赛，按段位相近配对、单败 BO1；4 支胜者并入入围赛，负者淘汰。" },
      { title: "入围赛", detail: "其余 28 支队伍与资格赛 4 支胜者共 32 支，经抽签确定首轮对阵，单败 BO1；16 支胜者晋级小组赛。" },
      { title: "小组赛", detail: "16 支晋级队伍分入 4 个小组，每组采用 GSL 双败赛制，所有比赛为 BO3；各组前两名晋级淘汰赛。" },
      { title: "淘汰赛", detail: "8 支晋级队伍进入双败淘汰赛。败者组决赛与总决赛为 BO5，其余场次为 BO3。" },
      { title: "种子分档", detail: "小组赛参赛队伍依据首发 5 名选手报名截止时的段位平均分划入 4 个种子池；每组分别抽取各档 1 支队伍。" },
      { title: "淘汰赛抽签", detail: "小组第一对阵其他小组第二；同组晋级队伍分入不同半区。" },
      { title: "赛程与改期生效", detail: "比赛时间以赛事平台最新公布的赛程为准。队伍协商改期后，须由赛事负责人确认并更新赛程，改期方可生效。" },
    ],
    constraints: {
      maxConcurrent: 2,
      durations: { BO1: 45, BO3: 90, BO5: 150 },
      sessionStart: "12:00",
      sessionEnd: "18:00",
      matchdays: [6, 7],
    },
    mapPoolIds: DEFAULT_MAP_POOL.map((m) => m.id),
  },
  {
    id: "val-36playin-32qual-16seg-8de",
    name: "36 队 · 资格赛 + 入围赛 + 组内单败小组赛 + 双败淘汰",
    scale: "36 队",
    description: "与上一套结构完全相同，只把小组赛从「GSL 双败」换成「组内单败」：4 个小组、每组 4 队打半决赛 + 决赛，前两名晋级。小组赛由 20 场降到 12 场，赛程更短。",
    teamCount: 36,
    teamSize: 5,
    stages: [
      { name: "资格赛", type: "single-elim", teamCount: 8, boType: "BO1", advance: "4 支队伍并入入围赛" },
      { name: "入围赛", type: "single-elim", teamCount: 32, boType: "BO1", advance: "16 支队伍晋级" },
      { name: "小组赛", type: "single-elim-groups", teamCount: 16, groupCount: 4, boType: "BO3", advance: "每组 2 支队伍晋级" },
      { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3", advance: "冠军产生" },
    ],
    stageSummary: "36 队 → 最弱 8 队打资格赛（同档互打）→ 32 队单败入围（BO1）→ 16 队分 4 组组内单败 → 8 队双败",
    matchCount: 46,
    hourEstimate: 56,
    defaultRules: [
      { title: "参赛规模", detail: "赛事设置 36 个参赛席位，每支队伍注册 5 名首发选手。" },
      { title: "资格赛", detail: "依首发 5 名选手报名截止时的段位平均分排序，最弱的 8 支队伍参加资格赛，按段位相近配对、单败 BO1；4 支胜者并入入围赛，负者淘汰。" },
      { title: "入围赛", detail: "其余 28 支队伍与资格赛 4 支胜者共 32 支，经抽签确定首轮对阵，单败 BO1；16 支胜者晋级小组赛。" },
      { title: "小组赛", detail: "16 支晋级队伍分入 4 个小组，每组 4 队采用组内单败（组内半决赛 + 组内决赛），比赛为 BO3；组内决赛的两支队伍（即该组前两名）晋级淘汰赛。" },
      { title: "淘汰赛", detail: "8 支晋级队伍进入双败淘汰赛。败者组决赛与总决赛为 BO5，其余场次为 BO3。" },
      { title: "种子分档", detail: "小组赛参赛队伍依据首发 5 名选手报名截止时的段位平均分划入 4 个种子池；每组分别抽取各档 1 支队伍，组内对阵按种子位展开（一号对四号、二号对三号）。" },
      { title: "淘汰赛抽签", detail: "小组第一对阵其他小组第二；同组晋级队伍分入不同半区。" },
      { title: "赛程与改期生效", detail: "比赛时间以赛事平台最新公布的赛程为准。队伍协商改期后，须由赛事负责人确认并更新赛程，改期方可生效。" },
    ],
    constraints: {
      maxConcurrent: 2,
      durations: { BO1: 45, BO3: 90, BO5: 150 },
      sessionStart: "12:00",
      sessionEnd: "18:00",
      matchdays: [6, 7],
    },
    mapPoolIds: DEFAULT_MAP_POOL.map((m) => m.id),
  },
  {
    id: "val-32qual-16gsl-8de",
    name: "32 队 · 入围赛 + GSL 小组赛 + 双败淘汰",
    scale: "32 队",
    description: "瓦理杯完整赛制。先进行 16 场 BO1 入围赛，再由真实晋级队伍进入 4 组 GSL，最后 8 队双败淘汰。各阶段结束后分别抽签发布。",
    teamCount: 32,
    teamSize: 5,
    stages: [
      { name: "入围赛", type: "single-elim", teamCount: 32, boType: "BO1", advance: "16 支队伍晋级" },
      { name: "小组赛", type: "gsl-groups", teamCount: 16, groupCount: 4, boType: "BO3", advance: "每组 2 支队伍晋级" },
      { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3", advance: "冠军产生" },
    ],
    stageSummary: "32 队单败入围（BO1）→ 16 队 GSL 小组赛 → 8 队双败淘汰",
    matchCount: 50,
    hourEstimate: 65,
    defaultRules: [
      { title: "参赛规模", detail: "赛事设置 32 个参赛席位，每支队伍注册 5 名首发选手。" },
      { title: "入围赛", detail: "32 支队伍经随机抽签确定首轮对阵，采用单败淘汰制，比赛为 BO1；16 支胜者晋级小组赛。" },
      { title: "小组赛", detail: "16 支晋级队伍分入 4 个小组，每组采用 GSL 双败赛制，所有比赛为 BO3；各组前两名晋级淘汰赛。" },
      { title: "淘汰赛", detail: "8 支晋级队伍进入双败淘汰赛。败者组决赛与总决赛为 BO5，其余场次为 BO3。" },
      { title: "种子分档", detail: "小组赛参赛队伍依据首发 5 名选手报名截止时的段位平均分划入 4 个种子池；每组分别抽取各档 1 支队伍。" },
      { title: "淘汰赛抽签", detail: "小组第一对阵其他小组第二；同组晋级队伍分入不同半区。" },
      { title: "赛程与改期生效", detail: "比赛时间以赛事平台最新公布的赛程为准。队伍协商改期后，须由赛事负责人确认并更新赛程，改期方可生效。" },
    ],
    constraints: {
      maxConcurrent: 2,
      durations: { BO1: 45, BO3: 90, BO5: 150 },
      sessionStart: "12:00",
      sessionEnd: "18:00",
      matchdays: [6, 7],
    },
    mapPoolIds: DEFAULT_MAP_POOL.map((m) => m.id),
  },
  {
    id: "val-32ko",
    name: "32 队 · 单败入围赛",
    scale: "32 队",
    description: "适合报名人数多、赛程紧张的大型校园赛。首轮单败淘汰快速筛选 16 强，赛程短、节奏快。",
    teamCount: 32,
    teamSize: 5,
    stages: [
      { name: "入围赛", type: "single-elim", teamCount: 32, boType: "BO1", advance: "16 支队伍晋级" },
    ],
    stageSummary: "32 队单败淘汰入围赛（BO1），16 支队伍晋级",
    matchCount: 16,
    hourEstimate: 12,
    defaultRules: [
      { title: "参赛规模", detail: "赛事设置 32 个参赛席位，每支队伍注册 5 名首发选手。" },
      { title: "入围赛", detail: "32 支队伍经随机抽签确定首轮对阵，采用单败淘汰制，比赛为 BO1；16 支胜者晋级。" },
      { title: "赛程与改期生效", detail: "比赛时间以赛事平台最新公布的赛程为准。队伍协商改期后，须由赛事负责人确认并更新赛程，改期方可生效。" },
    ],
    constraints: {
      maxConcurrent: 2,
      durations: { BO1: 45, BO3: 90, BO5: 150 },
      sessionStart: "12:00",
      sessionEnd: "18:00",
      matchdays: [6, 7],
    },
    mapPoolIds: DEFAULT_MAP_POOL.map((m) => m.id),
  },
  {
    id: "val-16gsl-8de",
    name: "16 队 · GSL 小组赛 + 8 队双败淘汰",
    scale: "16 队",
    description: "瓦理杯采用赛制。小组赛 4 组 GSL 双败晋级，淘汰赛完整双败；败者组决赛与总决赛 BO5。",
    teamCount: 16,
    teamSize: 5,
    stages: [
      { name: "小组赛", type: "gsl-groups", teamCount: 16, groupCount: 4, boType: "BO3", advance: "每组 2 支队伍晋级" },
      { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3", advance: "冠军产生" },
    ],
    stageSummary: "16 队小组赛（4 组 GSL 双败）→ 8 队双败淘汰",
    matchCount: 34,
    hourEstimate: 53,
    defaultRules: [
      { title: "参赛规模", detail: "赛事设置 16 个参赛席位，每支队伍注册 5 名首发选手。" },
      { title: "小组赛", detail: "16 支队伍分入 4 个小组，每组采用 GSL 双败赛制，所有比赛为 BO3；各组前两名晋级淘汰赛。" },
      { title: "淘汰赛", detail: "8 支晋级队伍进入双败淘汰赛。败者组决赛与总决赛为 BO5，其余场次为 BO3。" },
      { title: "种子分档", detail: "参赛队伍依据首发 5 名选手报名截止时的段位平均分划入 4 个种子池；每组分别抽取各档 1 支队伍。" },
      { title: "地图池与禁选", detail: "赛事地图池及地图禁选顺序以本届竞赛规程为准。" },
      { title: "赛程与改期生效", detail: "比赛时间以赛事平台最新公布的赛程为准。队伍协商改期后，须由赛事负责人确认并更新赛程，改期方可生效。" },
      { title: "比赛报到", detail: "参赛队伍须按规定时间完成报到、阵容核验、比赛房间确认及地图禁选。" },
      { title: "争议处理", detail: "迟到、断线或比赛争议须立即报告当值裁判；未经裁决，双方不得自行变更赛果。" },
    ],
    constraints: {
      maxConcurrent: 2,
      durations: { BO1: 45, BO3: 90, BO5: 150 },
      sessionStart: "12:00",
      sessionEnd: "18:00",
      matchdays: [6, 7],
    },
    mapPoolIds: DEFAULT_MAP_POOL.map((m) => m.id),
  },
  {
    id: "val-8de",
    name: "8 队 · 双败淘汰",
    scale: "8 队",
    description: "适合院系赛或决赛阶段。完整双败淘汰，败者组决赛与总决赛 BO5，每队至少两场。",
    teamCount: 8,
    teamSize: 5,
    stages: [
      { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3", advance: "冠军产生" },
    ],
    stageSummary: "8 队双败淘汰（败者组决赛与总决赛 BO5）",
    matchCount: 14,
    hourEstimate: 23,
    defaultRules: [
      { title: "参赛规模", detail: "赛事设置 8 个参赛席位，每支队伍注册 5 名首发选手。" },
      { title: "淘汰赛", detail: "8 支队伍进入双败淘汰赛。败者组决赛与总决赛为 BO5，其余场次为 BO3。" },
      { title: "赛程与改期生效", detail: "比赛时间以赛事平台最新公布的赛程为准。队伍协商改期后，须由赛事负责人确认并更新赛程，改期方可生效。" },
      { title: "争议处理", detail: "迟到、断线或比赛争议须立即报告当值裁判，并服从赛事组裁决。" },
    ],
    constraints: {
      maxConcurrent: 2,
      durations: { BO1: 45, BO3: 90, BO5: 150 },
      sessionStart: "12:00",
      sessionEnd: "18:00",
      matchdays: [6, 7],
    },
    mapPoolIds: DEFAULT_MAP_POOL.map((m) => m.id),
  },
  {
    id: "val-6rr",
    name: "6 队 · 单循环积分赛",
    scale: "6 队",
    description: "适合人数少的交流赛。每队与所有队伍各打一场，积分定排名，比赛体验最完整。",
    teamCount: 6,
    teamSize: 5,
    stages: [
      { name: "小组赛", type: "round-robin", teamCount: 6, groupCount: 1, boType: "BO1", advance: "积分排名前 2 名进入决赛" },
      { name: "决赛", type: "single-elim", teamCount: 2, boType: "BO3", advance: "冠军产生" },
    ],
    stageSummary: "6 队单循环积分赛（BO1）→ 前 2 名决赛（BO3）",
    matchCount: 16,
    hourEstimate: 13,
    defaultRules: [
      { title: "参赛规模", detail: "赛事设置 6 个参赛席位，每支队伍注册 5 名首发选手。" },
      { title: "小组赛", detail: "6 支队伍进行单循环赛，每队完成 5 场 BO1；胜方积 1 分，负方积 0 分，并依据积分确定排名。" },
      { title: "决赛", detail: "积分排名前两位的队伍晋级 BO3 总决赛。" },
      { title: "赛程与改期生效", detail: "比赛时间以赛事平台最新公布的赛程为准。队伍协商改期后，须由赛事负责人确认并更新赛程，改期方可生效。" },
    ],
    constraints: {
      maxConcurrent: 2,
      durations: { BO1: 45, BO3: 90, BO5: 150 },
      sessionStart: "12:00",
      sessionEnd: "18:00",
      matchdays: [6, 7],
    },
    mapPoolIds: DEFAULT_MAP_POOL.map((m) => m.id),
  },
];

export function getFormatTemplate(id: string): FormatTemplate | undefined {
  return FORMAT_TEMPLATES.find((t) => t.id === id);
}

/** 按模板 id 解析默认地图池（id 不存在时回退默认池） */
export function resolveTemplateMapPool(templateId: string): { id: string; name: string }[] {
  const template = getFormatTemplate(templateId);
  if (!template) return DEFAULT_MAP_POOL;
  const byId = new Map(DEFAULT_MAP_POOL.map((m) => [m.id, m]));
  return template.mapPoolIds.map((id) => byId.get(id)).filter((m): m is { id: string; name: string } => Boolean(m));
}

export interface NewEventInput {
  id: string;
  name: string;
  game: string;
  organizer: string;
  templateId: string;
  /** 细致赛制配置（新建赛事第二步的产物）；缺省时由模板推导 */
  stageConfigs?: StageConfig[];
  description?: string;
  registrationStart?: string;
  registrationEnd?: string;
  teamRegistrationEnd?: string;
  eventDateLabel?: string;
  prizePool?: string;
  coverColor?: string;
  /** 负责人维护的平台通用规则；缺省时使用内置基线。 */
  commonRules?: EditableRule[];
}

export const DEFAULT_COMMON_HANDBOOK_RULES: EditableRule[] = [
  { title: "参赛资格", detail: "参赛选手须符合本届赛事公布的身份及报名条件，并使用真实、完整且可核验的信息完成登记。", category: "conduct", emphasis: "normal" },
  { title: "名单与替补", detail: "参赛阵容以赛事平台最终审核记录为准。未经赛事组正式确认，任何队伍不得擅自更换或新增选手。", category: "conduct", emphasis: "important" },
  { title: "地图池与禁选", detail: "比赛采用赛事平台公布的赛事地图池。双方队长须在当值裁判监督下，按规定顺序完成地图禁选。", category: "match-day", emphasis: "normal" },
  { title: "赛程与改期生效", detail: "比赛时间以赛事平台最新公布的赛程为准。队伍协商改期后，须由赛事负责人确认并更新赛程，改期方可生效。", category: "match-day", emphasis: "important" },
  { title: "比赛报到", detail: "参赛队伍须于计划开赛时间前 15 分钟完成报到、阵容核验、房间确认及地图禁选。", category: "match-day", emphasis: "normal" },
  { title: "录屏与证据", detail: "赛事组可要求参赛选手保留完整比赛录制。涉及技术故障、违规或赛果争议时，申请方须按要求提交有效证据。", category: "match-day", emphasis: "important" },
  { title: "技术暂停", detail: "发生断线、设备或网络故障时，队长须立即向当值裁判报告。未经裁判许可，任何队伍不得擅自暂停、重开或退出比赛。", category: "incident", emphasis: "important" },
  { title: "竞技行为规范", detail: "参赛人员须遵守竞技道德与赛事秩序。侮辱、挑衅、刷屏、恶意攻击及干扰比赛的行为将依据情节予以处理。", category: "conduct", emphasis: "important" },
  { title: "迟到与弃赛", detail: "队伍无法按时参赛时须提前向赛事组报备。迟到、无故缺席或弃赛按照已公布竞赛规程及当值裁判裁决处理。", category: "incident", emphasis: "warning" },
  { title: "竞赛完整性", detail: "严禁使用外挂、代打、窥屏、未经批准的换人或其他获取不当竞争优势的行为。经核实后，赛事组可判处地图判负、系列赛判负或取消参赛资格。", category: "conduct", emphasis: "warning" },
  { title: "争议与申诉", detail: "赛果、判罚或比赛异常的申诉，仅由队长在规定时限内向当值裁判提出，并同时提交相关证据。", category: "appeal", emphasis: "important" },
  { title: "判罚依据", detail: "赛事组依据竞赛规程、平台记录、裁判报告及有效证据作出裁决，并对本届赛事规则保留最终解释权。", category: "appeal", emphasis: "normal" },
];

function withRulePresentation(rule: EditableRule): EditableRule {
  if (rule.category && rule.emphasis) return rule;
  const category: NonNullable<EditableRule["category"]> = /申诉|判罚|裁决|异议/.test(rule.title)
    ? "appeal"
    : /迟到|弃赛|暂停|设备|网络|掉线|重赛|异常|争议处理/.test(rule.title)
      ? "incident"
      : /地图|BP|赛程确认|赛程与改期|比赛报到|赛前|录屏|证据/.test(rule.title)
        ? "match-day"
        : /规模|入围赛|小组赛|淘汰赛|赛制|种子|抽签|决赛/.test(rule.title)
          ? "format"
          : "conduct";
  const emphasis: NonNullable<EditableRule["emphasis"]> = /作弊/.test(rule.title)
    ? "warning"
    : /确认|争议|名单|录屏|暂停/.test(rule.title)
      ? "important"
      : "normal";
  return { ...rule, category, emphasis };
}

function sameStage(a: StageConfig, b: FormatTemplateStage): boolean {
  return a.name === b.name
    && a.type === b.type
    && a.teamCount === b.teamCount
    && a.boType === b.boType
    && (a.groupCount ?? 0) === (b.groupCount ?? 0);
}

/** 根据实际阶段配置选择最匹配模板，避免所有非 32 队赛事错误继承 16 队 GSL 文案。 */
export function resolveTemplateIdFromStages(stages: StageConfig[]): string {
  const exact = FORMAT_TEMPLATES.find(
    (template) => template.stages.length === stages.length
      && stages.every((stage, index) => sameStage(stage, template.stages[index])),
  );
  if (exact) return exact.id;
  if (stages.length === 1 && stages[0]?.type === "double-elim" && stages[0].teamCount === 8) return "val-8de";
  if (stages.length === 1 && stages[0]?.type === "single-elim" && stages[0].teamCount === 32) return "val-32ko";
  // 兜底 id 只能尽力而为（多阶段组合没有一一对应的模板 id）。
  if (stages.some((stage) => stage.type === "single-elim-groups")) return "val-36playin-32qual-16seg-8de";
  if (stages.some((stage) => stage.type === "gsl-groups")) return "val-16gsl-8de";
  return FORMAT_TEMPLATES[0].id;
}

/**
 * 这套阶段配置一共需要多少支队伍报名。
 *
 * 不能用 `stages[0].teamCount`：四阶段赛制的第一个阶段是**并入型**资格赛
 * （8 队里 4 队晋级，并入 32 队入围赛），报名的实际是 28 + 8 = 36 支。
 * 之前直接取首阶段队伍数，会把 36 队赛事声明成「8 队」，报名页与赛事规模都跟着错。
 *
 * 判据：下一阶段比本阶段大 → 本阶段是并入型，总队伍数 = (本阶段 − 本阶段一半) + 下一阶段。
 */
export function totalTeamsFromStages(stages: StageConfig[]): number {
  const first = stages[0];
  if (!first) return 0;
  const next = stages[1];
  if (next && first.type === "single-elim" && next.teamCount > first.teamCount) {
    return first.teamCount - first.teamCount / 2 + next.teamCount;
  }
  return first.teamCount;
}

function formatRulesFromStages(stages: StageConfig[], teamSize: number): EditableRule[] {
  const rules: EditableRule[] = [
    {
      title: "参赛规模",
      detail: `赛事设置 ${totalTeamsFromStages(stages)} 个参赛席位，每支队伍注册 ${teamSize} 名首发选手。`,
      category: "format",
      emphasis: "normal",
    },
  ];

  stages.forEach((stage, index) => {
    const next = stages[index + 1];
    let detail = "";
    if (stage.type === "single-elim") {
      // 并入型阶段（如资格赛 8 队）：胜者并入下一阶段，晋级数 = 本阶段队伍数的一半。
      const advancing = next && next.teamCount > stage.teamCount ? stage.teamCount / 2 : next?.teamCount;
      detail = next
        ? `${stage.teamCount} 支队伍采用单败淘汰制，比赛为 ${stage.boType}；${advancing} 支胜者${next.teamCount > stage.teamCount ? "并入" : "晋级"}${next.name}。`
        : `${stage.teamCount} 支队伍采用单败淘汰制，比赛为 ${stage.boType}；负者淘汰，直至决出冠军。`;
    } else if (stage.type === "single-elim-groups") {
      const groups = stage.groupCount ?? 1;
      const advancingPerGroup = next ? Math.max(1, Math.round(next.teamCount / groups)) : 2;
      detail = `${stage.teamCount} 支队伍分入 ${groups} 个小组，每组采用组内单败（组内半决赛 + 组内决赛），比赛为 ${stage.boType}；每组前 ${advancingPerGroup} 名晋级${next?.name ?? "下一阶段"}。`;
    } else if (stage.type === "gsl-groups") {
      const groups = stage.groupCount ?? 1;
      const advancingPerGroup = next ? Math.max(1, Math.round(next.teamCount / groups)) : 2;
      detail = `${stage.teamCount} 支队伍分入 ${groups} 个小组，每组采用 GSL 双败赛制，比赛为 ${stage.boType}；每组前 ${advancingPerGroup} 名晋级${next?.name ?? "下一阶段"}。`;
    } else if (stage.type === "double-elim") {
      detail = stage.teamCount === 8
        ? `8 支队伍采用双败淘汰制。败者组决赛与总决赛为 BO5，其余场次为 ${stage.boType}。`
        : `${stage.teamCount} 支队伍采用双败淘汰制，比赛为 ${stage.boType}；获得两败的队伍淘汰。`;
    } else {
      const groups = stage.groupCount ?? 1;
      detail = `${stage.teamCount} 支队伍分入 ${groups} 个小组进行单循环赛，比赛为 ${stage.boType}，排名及晋级依据本届积分规则确定。`;
    }
    rules.push({ title: stage.name, detail, category: "format", emphasis: "normal" });
  });

  if (stages.some((stage) => stage.type === "gsl-groups" || stage.type === "single-elim-groups")) {
    rules.push({
      title: "种子分档",
      detail: "小组赛队伍依据已确认的种子规则分档；同一种子池队伍分入不同小组，首轮按一号种子对四号种子、二号种子对三号种子生成对阵。",
      category: "format",
      emphasis: "important",
    });
  }
  if (stages.some((stage) => stage.type === "gsl-groups" || stage.type === "single-elim-groups") && stages.some((stage) => stage.type === "double-elim")) {
    rules.push({
      title: "淘汰赛抽签",
      detail: "小组第一对阵其他小组第二；同组晋级队伍分入不同半区，避免在淘汰赛首轮再次相遇。",
      category: "format",
      emphasis: "important",
    });
  }
  return rules;
}

/** 新赛事默认规程 = 赛制配置自动生成 + 赛事组织通用规则继承。 */
export function buildDefaultEventRules(
  stages: StageConfig[],
  teamSize = 5,
  commonPreset: EditableRule[] = DEFAULT_COMMON_HANDBOOK_RULES,
): EditableRule[] {
  const formatRules = formatRulesFromStages(stages, teamSize).map((rule) => ({
    ...withRulePresentation(rule),
    source: "format" as const,
    customized: false,
    confirmed: true,
  }));
  const formatTitles = new Set(formatRules.map((rule) => rule.title));
  const commonRules = commonPreset
    .filter((rule) => !formatTitles.has(rule.title))
    .map((rule) => ({
      ...withRulePresentation(rule),
      source: "common" as const,
      customized: false,
      confirmed: rule.emphasis !== "warning",
    }));
  return [...formatRules, ...commonRules];
}

/**
 * 实例化一个新赛事（基础信息 + 赛制配置两步）：
 * 产出规则、赛制摘要和阶段配置均已就绪的赛事。
 */
export function buildEventFromTemplate(input: NewEventInput): EditableEvent {
  const template = getFormatTemplate(input.templateId) ?? FORMAT_TEMPLATES[0];
  const now = new Date().toISOString();
  // 赛制配置优先用办赛者细致配置，缺省时由模板阶段推导
  const stageConfigs: StageConfig[] = input.stageConfigs && input.stageConfigs.length > 0
    ? input.stageConfigs
    : template.stages.map((st) => ({
        name: st.name,
        type: st.type,
        teamCount: st.teamCount,
        boType: st.boType,
        ...(st.groupCount !== undefined ? { groupCount: st.groupCount } : {}),
      }));
  return {
    id: input.id,
    name: input.name.trim() || "未命名赛事",
    game: input.game.trim() || getGameConfig().displayName,
    status: "draft",
    visibility: "private",
    teamCount: totalTeamsFromStages(stageConfigs) || template.teamCount,
    teamSize: template.teamSize,
    description: input.description?.trim() || `${template.name}。竞赛日期、报名安排及奖金奖项以赛事组正式公告为准。`,
    organizer: input.organizer.trim() || "赛事组",
    registrationStart: input.registrationStart ?? "",
    registrationEnd: input.registrationEnd ?? "",
    teamRegistrationEnd: input.teamRegistrationEnd ?? input.registrationEnd ?? "",
    eventDateLabel: input.eventDateLabel?.trim() || "竞赛日期待公布",
    registrationLabel: "报名尚未开放",
    stageSummary: stageConfigSummary(stageConfigs),
    prizePool: input.prizePool?.trim() || "奖金及奖品方案待公布",
    coverColor: input.coverColor ?? "#ff4655",
    posterImage: "",
    mapPool: resolveTemplateMapPool(input.templateId),
    preparationSteps: [
      { number: "01", title: "选手注册", detail: "参赛选手须通过赛事报名页面提交真实、完整且可核验的信息，并妥善保管参赛管理码。" },
      { number: "02", title: "队伍组建", detail: "队长须完成队伍创建与选手邀请；自由选手可向未满编队伍提交入队申请。" },
      { number: "03", title: "阵容提交", detail: "队长须于队伍报名截止前提交正式参赛名单，经赛事组审核确认后进入抽签程序。" },
      { number: "04", title: "查看分组与比赛时间", detail: "赛事组将分阶段公布分组、对阵和比赛时间。参赛队伍须查看平台发布的最新赛程。" },
      { number: "05", title: "赛前报到", detail: "参赛队伍须于计划开赛时间前 15 分钟进入指定比赛房间并完成核验。" },
      { number: "06", title: "地图禁选与开赛", detail: "双方队长须在当值裁判监督下完成地图禁选；裁判确认双方就绪后宣布比赛开始。" },
    ],
    rules: buildDefaultEventRules(stageConfigs, template.teamSize, input.commonRules),
    formatTemplateId: template.id,
    stageConfigs,
    proposal: { background: "", purpose: "", budget: "", prizes: "", leader: "", contact: "" },
    eventQqGroup: "",
    // 新赛事默认「自由约赛」；排期模式由负责人在赛事设置里选定
    scheduleMode: "open" as const,
    createdAt: now,
  };
}
