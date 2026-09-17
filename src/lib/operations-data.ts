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

/** 3 个赛事运营模块；策划案作为独立文档，不进入办赛工作台。 */
export const operationsModules: OperationsModule[] = [
  {
    number: "01",
    label: "报名与队伍",
    shortLabel: "报名",
    description: "选手报名、队伍申报与名单审核。",
    href: `/admin/events/${activeEvent.id}/registration`,
    phase: "REGISTER",
  },
  {
    number: "02",
    label: "赛程",
    shortLabel: "赛程",
    description: "一张对阵图：抽签、排期、BP、报分与晋级。",
    href: `/admin/events/${activeEvent.id}/schedule`,
    phase: "SCHEDULE",
    core: true,
  },
  {
    number: "03",
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
}

export type ModuleWithState = OperationsModule & { state: ModuleState; stateLabel: string };

export interface StageGuidance {
  label: string;
  objective: string;
  blockers: string[];
  actionLabel: string;
  actionHref: string;
  /** 仅生命周期推进使用；普通下一步仍然是页面链接。 */
  actionKind?: "open-registration" | "close-registration" | "complete-event";
}

export interface StageGuidanceInput {
  eventId: string;
  visibility: "private" | "public";
  publishIssues: string[];
  activeTeamCount: number;
  confirmedTeamCount: number;
  requiredTeamCount: number;
  pendingReviewCount: number;
  hasFormat: boolean;
  matchCount: number;
  unscheduledMatchCount: number;
  completedMatchCount: number;
  pendingRescheduleCount: number;
  publicContentIssues: string[];
}

const STAGE_ORDER: Record<EventStage, number> = { 筹备: 0, 报名: 1, 分组: 2, 比赛: 3, 赛后: 4 };

function moduleStatus(number: string, order: number, input: ModuleStatusInput): { state: ModuleState; stateLabel: string } {
  switch (number) {
    case "01": // 报名与队伍
      if (order === 0) return { state: "planned", stateLabel: "报名未开放" };
      if (order === 1) return { state: "in-progress", stateLabel: input.teamCount > 0 ? `${input.teamCount} 队报名中` : "报名进行中" };
      return { state: "ready", stateLabel: input.frozen ? "报名已截止" : "已截止" };
    case "02": // 赛程
      if (order < 2) return { state: "planned", stateLabel: "待抽签" };
      if (order === 2) return input.hasFormat ? { state: "in-progress", stateLabel: "待排期" } : { state: "in-progress", stateLabel: "待抽签" };
      if (order === 3) return { state: "in-progress", stateLabel: "比赛进行中" };
      return { state: "ready", stateLabel: "已结束" };
    case "03": // 赛事设置
      return order === 0 ? { state: "in-progress", stateLabel: "配置中" } : { state: "ready", stateLabel: "已配置" };
    default:
      return { state: "planned", stateLabel: "" };
  }
}

/** 按阶段 + 真实数据计算 3 个模块的当前状态 */
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

/**
 * 把抽象生命周期翻译成负责人此刻真正需要处理的目标、阻塞与入口。
 * 阶段本身仍由负责人控制；这里只读取真实数据，不自动推进或发布。
 */
export function getStageGuidance(stage: EventStage, input: StageGuidanceInput): StageGuidance {
  const base = `/admin/events/${input.eventId}`;
  const visibilityBlocker = input.visibility === "private" ? ["赛事尚未发布，玩家侧当前不可访问"] : [];

  if (stage === "筹备") {
    const blockers = [...input.publishIssues, ...visibilityBlocker];
    const canOpenRegistration = input.publishIssues.length === 0 && input.visibility === "public";
    return {
      label: "筹备中",
      objective: "完成赛事基础信息、竞赛规程及玩家侧公开内容审核。",
      blockers,
      actionLabel: input.publishIssues.length > 0 ? "补齐赛事设置" : input.visibility === "private" ? "预览并发布赛事" : "进入报名阶段",
      actionHref: `${base}/settings`,
      ...(canOpenRegistration ? { actionKind: "open-registration" as const } : {}),
    };
  }

  if (stage === "报名") {
    const blockers = [
      ...visibilityBlocker,
      ...(input.pendingReviewCount > 0 ? [`${input.pendingReviewCount} 名选手资料待修改`] : []),
      ...(input.requiredTeamCount > 0 && input.confirmedTeamCount < input.requiredTeamCount
        ? [`正式队伍 ${input.confirmedTeamCount}/${input.requiredTeamCount} 支`]
        : []),
    ];
    const rosterReady = input.requiredTeamCount > 0 && input.confirmedTeamCount >= input.requiredTeamCount;
    return {
      label: "报名中",
      objective: "确认正式参赛名单。报名默认通过，只需处理标记为待修改的选手。",
      blockers,
      actionLabel: input.pendingReviewCount > 0
        ? `处理 ${input.pendingReviewCount} 名资料待修改的选手`
        : rosterReady ? "结束报名并进入分组" : `继续确认队伍（${input.activeTeamCount} 支）`,
      actionHref: rosterReady ? `${base}/schedule/draw` : `${base}/registration`,
      ...(rosterReady && input.pendingReviewCount === 0 && input.visibility === "public"
        ? { actionKind: "close-registration" as const }
        : {}),
    };
  }

  if (stage === "分组") {
    const rosterShort = input.requiredTeamCount > 0 && input.confirmedTeamCount < input.requiredTeamCount;
    const blockers = [
      ...visibilityBlocker,
      ...(rosterShort ? [`正式队伍 ${input.confirmedTeamCount}/${input.requiredTeamCount} 支，暂不能抽签`] : []),
      ...(!input.hasFormat ? ["抽签尚未完成，赛程骨架还未发布"] : []),
    ];
    return {
      label: "分组中",
      objective: "完成赛事抽签，并发布分组及对阵结构。",
      blockers,
      actionLabel: rosterShort ? "返回确认正式名单" : input.hasFormat ? "检查并发布对阵" : "开始抽签",
      actionHref: rosterShort ? `${base}/registration` : `${base}/schedule/draw`,
    };
  }

  if (stage === "比赛") {
    const allCompleted = input.matchCount > 0 && input.completedMatchCount === input.matchCount;
    const blockers = [
      ...visibilityBlocker,
      ...(input.pendingRescheduleCount > 0 ? [`${input.pendingRescheduleCount} 条改期申请待处理`] : []),
      ...(input.unscheduledMatchCount > 0 ? [`${input.unscheduledMatchCount} 场比赛尚未排期`] : []),
      ...(allCompleted ? ["全部比赛已完成，赛事阶段尚未切换为已结束"] : []),
    ];
    return {
      label: "比赛中",
      objective: "执行有效赛程，完成改期审批、地图禁选、赛果登记及阶段晋级。",
      blockers,
      actionLabel: allCompleted
        ? "结束赛事"
        : input.pendingRescheduleCount > 0 ? "处理改期申请"
          : input.unscheduledMatchCount > 0 ? `安排 ${input.unscheduledMatchCount} 场比赛`
            : "继续比赛执行",
      actionHref: allCompleted ? `${base}/settings` : `${base}/schedule`,
      ...(allCompleted && input.visibility === "public" ? { actionKind: "complete-event" as const } : {}),
    };
  }

  const postEventIssues = input.publicContentIssues;
  return {
    label: "已结束",
    objective: "核验最终赛果、赛事排名与公开资料，并完成赛事归档。",
    blockers: postEventIssues,
    actionLabel: postEventIssues.length > 0 ? "更新官网赛后内容" : "核对最终赛果",
    actionHref: postEventIssues.length > 0 ? `/admin/site-content?eventId=${input.eventId}` : `${base}/schedule`,
  };
}

export const stateStyles: Record<ModuleState, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
  "in-progress": "border-[#ff4655]/25 bg-[#fff1f2] text-[#c83242]",
  planned: "border-slate-200 bg-slate-50 text-slate-500",
};
