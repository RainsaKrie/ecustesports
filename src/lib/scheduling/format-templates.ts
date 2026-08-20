// =====================
// 赛制模板库：办赛者新建比赛时「选择而不是填写」赛制
// 每个模板包含阶段结构、默认规则文案、默认硬约束与地图池
// 新建比赛时按模板实例化赛事（规则、赛制摘要、约束就绪）
// =====================

import type { EditableRule } from "@/lib/site-config-schema";
import type { EditableEvent } from "@/lib/site-config-schema";
import { DEFAULT_MAP_POOL } from "@/lib/maps";

export type StageType = "single-elim" | "gsl-groups" | "double-elim" | "round-robin";

/** 一个比赛阶段的可配置项（新建比赛赛制配置器的产物） */
export interface StageConfig {
  name: string;
  type: StageType;
  teamCount: number;
  boType: "BO1" | "BO3" | "BO5";
  /** gsl-groups / round-robin 的分组数 */
  groupCount?: number;
}

export const STAGE_TYPE_LABELS: Record<StageType, string> = {
  "single-elim": "单败淘汰",
  "double-elim": "双败淘汰",
  "gsl-groups": "GSL 小组双败",
  "round-robin": "单循环",
};

/** 赛制类型的默认 BO（新建阶段时预填） */
export const STAGE_TYPE_DEFAULT_BO: Record<StageType, "BO1" | "BO3" | "BO5"> = {
  "single-elim": "BO1",
  "double-elim": "BO3",
  "gsl-groups": "BO3",
  "round-robin": "BO1",
};

/** 由阶段配置估算总场次与比赛小时数 */
export function estimateStageConfig(stages: StageConfig[]): { matchCount: number; hourEstimate: number } {
  const DURATION: Record<string, number> = { BO1: 45, BO3: 90, BO5: 150 };
  let matchCount = 0;
  let minutes = 0;
  for (const st of stages) {
    const dur = DURATION[st.boType] ?? 90;
    let matches = 0;
    switch (st.type) {
      case "single-elim":
        matches = Math.max(0, st.teamCount - 1);
        break;
      case "double-elim":
        // 双败：约 2n-1 场（含败者组），决赛不重置
        matches = st.teamCount > 1 ? st.teamCount * 2 - 1 : 0;
        break;
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
    matchCount += Math.round(matches);
    minutes += Math.round(matches) * dur;
  }
  return { matchCount, hourEstimate: Math.round(minutes / 60) };
}

/** 阶段配置 → 赛制摘要文案（写入赛事与策划案） */
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

/** 内置赛制模板（首发 4 个，覆盖常见校园赛规模） */
export const FORMAT_TEMPLATES: FormatTemplate[] = [
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
      { title: "参赛规模", detail: "共 32 支队伍，每队 5 名首发选手" },
      { title: "入围赛", detail: "32 支队伍随机配对，单败淘汰 BO1，16 支队伍晋级" },
      { title: "赛程确认", detail: "比赛时间以赛事组发布的有效赛程为准" },
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
    matchCount: 26,
    hourEstimate: 39,
    defaultRules: [
      { title: "参赛规模", detail: "共 16 支队伍，每队 5 名首发选手" },
      { title: "小组赛", detail: "16 支队伍分为 4 组，进行 GSL 双败赛，全部比赛为 BO3；每组两支队伍晋级" },
      { title: "淘汰赛", detail: "8 支队伍进行双败淘汰；败者组决赛和总决赛为 BO5，其余比赛为 BO3" },
      { title: "种子分档", detail: "按首发 5 人报名截止时的当前段位平均分划分 4 个种子池，每组从每个种子池抽取 1 队" },
      { title: "地图与 BP", detail: "地图池和具体 BP 顺序以参赛手册为准" },
      { title: "赛程确认", detail: "两队可协商比赛时间，但最终时间以赛事组发布的有效赛程为准" },
      { title: "比赛报到", detail: "参赛队伍应按通知提前进入赛事群和指定房间，配合裁判完成地图 BP" },
      { title: "争议处理", detail: "如遇迟到、掉线或比赛争议，请第一时间联系当值裁判，不要自行判定赛果" },
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
    hourEstimate: 21,
    defaultRules: [
      { title: "参赛规模", detail: "共 8 支队伍，每队 5 名首发选手" },
      { title: "淘汰赛", detail: "8 支队伍进行双败淘汰；败者组决赛和总决赛为 BO5，其余比赛为 BO3" },
      { title: "赛程确认", detail: "比赛时间以赛事组发布的有效赛程为准" },
      { title: "争议处理", detail: "如遇迟到、掉线或比赛争议，请第一时间联系当值裁判" },
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
      { title: "参赛规模", detail: "共 6 支队伍，每队 5 名首发选手" },
      { title: "小组赛", detail: "6 队单循环，每队 5 场 BO1；胜 1 分，负 0 分，按积分排名" },
      { title: "决赛", detail: "积分前 2 名进行 BO3 决赛" },
      { title: "赛程确认", detail: "比赛时间以赛事组发布的有效赛程为准" },
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
  /** 细致赛制配置（新建比赛向导第三步的产物）；缺省时由模板推导 */
  stageConfigs?: StageConfig[];
  description?: string;
  registrationStart?: string;
  registrationEnd?: string;
  teamRegistrationEnd?: string;
  eventDateLabel?: string;
  prizePool?: string;
  coverColor?: string;
}

/**
 * 实例化一个新赛事（新建比赛三步流程的产物）：
 * 基础信息 + 赛制配置 + 策划案信息一次填写，
 * 产出赛事（规则/赛制摘要/阶段配置就绪）+ 策划案素材。
 */
export function buildEventFromTemplate(input: NewEventInput): EditableEvent {
  const template = getFormatTemplate(input.templateId) ?? FORMAT_TEMPLATES[1];
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
    game: input.game.trim() || "无畏契约",
    status: "draft",
    teamCount: stageConfigs[0]?.teamCount ?? template.teamCount,
    teamSize: template.teamSize,
    description: input.description?.trim() || `${template.name}。报名时间、比赛日期和奖项将在确认后统一公布。`,
    organizer: input.organizer.trim() || "赛事组",
    registrationStart: input.registrationStart ?? "",
    registrationEnd: input.registrationEnd ?? "",
    teamRegistrationEnd: input.teamRegistrationEnd ?? input.registrationEnd ?? "",
    eventDateLabel: input.eventDateLabel?.trim() || "比赛时间待公布",
    registrationLabel: "尚未开放",
    stageSummary: stageConfigSummary(stageConfigs),
    prizePool: input.prizePool?.trim() || "奖项与奖品将在报名开启前公布",
    coverColor: input.coverColor ?? "#ff4655",
    posterImage: "",
    mapPool: resolveTemplateMapPool(input.templateId),
    preparationSteps: [
      { number: "01", title: "准备队伍", detail: "报名开放前确认队伍名称、首发和有效联系方式。" },
      { number: "02", title: "关注赛事公告", detail: "报名时间、比赛日期、地图池和奖项将由赛事组统一公布。" },
      { number: "03", title: "按最新赛程参赛", detail: "分组抽签完成后公布比赛时间；临时调整以赛事组通知为准。" },
    ],
    rules: template.defaultRules,
    formatTemplateId: template.id,
    stageConfigs,
    proposal: { background: "", purpose: "", budget: "", prizes: "", leader: "", contact: "" },
    createdAt: now,
  };
}
