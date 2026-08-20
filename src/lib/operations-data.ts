import type { EventStage } from "@/lib/scheduling/stage";

export type ModuleState = "ready" | "in-progress" | "planned";

export interface OperationsModule {
  number: string;
  label: string;
  shortLabel: string;
  description: string;
  href: string;
  phase: string;
  core?: boolean;
}

export const activeEvent = {
  id: "event-1",
  name: "第三届华理瓦理杯",
  game: "无畏契约",
  teamCount: 32,
  refereeCount: 4,
  organizer: "华东理工大学电竞社",
  format: "32 队入围赛 → 16 队小组赛 → 8 队双败淘汰",
};

/** 4 个运营模块的静态定义（状态由 getOperationsModules 按阶段 + 真实数据动态计算） */
export const operationsModules: OperationsModule[] = [
  {
    number: "01",
    label: "策划案",
    shortLabel: "策划案",
    description: "查看、编辑并导出提交审核的策划案。",
    href: `/admin/events/${activeEvent.id}/planning`,
    phase: "PREPARE",
  },
  {
    number: "02",
    label: "报名与队伍",
    shortLabel: "报名",
    description: "选手报名、队伍申报与名单审核。",
    href: `/admin/events/${activeEvent.id}/registration`,
    phase: "REGISTER",
  },
  {
    number: "03",
    label: "赛程",
    shortLabel: "赛程",
    description: "一张对阵图：抽签、排期、BP、报分与晋级。",
    href: `/admin/events/${activeEvent.id}/schedule`,
    phase: "SCHEDULE",
    core: true,
  },
  {
    number: "04",
    label: "赛事设置",
    shortLabel: "设置",
    description: "赛事信息、参赛规则与地图池。",
    href: `/admin/events/${activeEvent.id}/settings`,
    phase: "GOVERN",
  },
];

/** 动态模块状态所需的真实数据快照 */
export interface ModuleStatusInput {
  teamCount: number; // 已报名队伍数
  frozen: boolean; // 名单是否冻结
  matchCount: number; // 赛程中的比赛数
  hasFormat: boolean; // 是否已抽签分组
  pendingNotifications: number; // 待审核通知数
}

export type ModuleWithState = OperationsModule & { state: ModuleState; stateLabel: string };

const STAGE_ORDER: Record<EventStage, number> = { 筹备: 0, 报名: 1, 分组: 2, 比赛: 3, 赛后: 4 };

function moduleStatus(number: string, order: number, input: ModuleStatusInput): { state: ModuleState; stateLabel: string } {
  switch (number) {
    case "01": // 策划案
      return order === 0 ? { state: "in-progress", stateLabel: "待生成" } : { state: "ready", stateLabel: "已生成" };
    case "02": // 报名与队伍
      if (order === 0) return { state: "planned", stateLabel: "报名未开放" };
      if (order === 1) return { state: "in-progress", stateLabel: input.teamCount > 0 ? `${input.teamCount} 队报名中` : "报名进行中" };
      return { state: "ready", stateLabel: input.frozen ? "报名已截止" : "已截止" };
    case "03": // 赛程
      if (order < 2) return { state: "planned", stateLabel: "待抽签" };
      if (order === 2) return input.hasFormat ? { state: "in-progress", stateLabel: "待排期" } : { state: "in-progress", stateLabel: "待抽签" };
      if (order === 3) return { state: "in-progress", stateLabel: "比赛进行中" };
      return { state: "ready", stateLabel: "已结束" };
    case "04": // 赛事设置
      return order === 0 ? { state: "in-progress", stateLabel: "配置中" } : { state: "ready", stateLabel: "已配置" };
    default:
      return { state: "planned", stateLabel: "" };
  }
}

/** 按阶段 + 真实数据计算 4 个模块的当前状态 */
export function getOperationsModules(stage: EventStage, input: ModuleStatusInput): ModuleWithState[] {
  const order = STAGE_ORDER[stage];
  return operationsModules.map((m) => ({ ...m, ...moduleStatus(m.number, order, input) }));
}

/** 生命周期 5 段（供侧边栏阶段指示），返回当前阶段索引 */
export function getLifecycleStages(stage: EventStage) {
  const labels = ["筹备", "报名", "分组", "比赛", "赛后"] as const;
  const activeIndex: Record<EventStage, number> = { 筹备: 0, 报名: 1, 分组: 2, 比赛: 3, 赛后: 4 };
  return labels.map((label, i) => ({ label, state: i === activeIndex[stage] ? "active" : i < activeIndex[stage] ? "done" : "waiting" }));
}

export const stateStyles: Record<ModuleState, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
  "in-progress": "border-[#ff4655]/25 bg-[#fff1f2] text-[#c83242]",
  planned: "border-slate-200 bg-slate-50 text-slate-500",
};
