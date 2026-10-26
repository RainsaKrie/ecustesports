// =====================
// 赛事阶段判定与阶段配置（阶段驱动 UI 的核心）
// 阶段 = 筹备 / 报名 / 分组 / 比赛 / 赛后
// =====================

export type EventStage = "筹备" | "报名" | "分组" | "比赛" | "赛后";

/** 阶段展示标签（后台总览、状态徽章等） */
export const STAGE_LABELS: Record<EventStage, string> = {
  筹备: "筹备中",
  报名: "报名中",
  分组: "分组中",
  比赛: "进行中",
  赛后: "已结束",
};

/** 根据 status + 时间窗口 + 是否有赛程，自动判定当前阶段 */
export function getEventStage(params: {
  status: string;
  registrationStart?: string;
  registrationEnd?: string;
  hasSchedule?: boolean;
}): EventStage {
  const { status, registrationStart, registrationEnd, hasSchedule = false } = params;

  // 明确终态：已结束 / 已归档
  if (status === "completed" || status === "archived") return "赛后";
  // 草稿不会因为填写了日期而自动公开或进入报名阶段。
  if (status === "draft") return "筹备";
  // 进行中：有赛程 = 比赛期，没赛程 = 分组期
  if (status === "ongoing") return hasSchedule ? "比赛" : "分组";
  // 报名中
  if (status === "registration") return "报名";
  // 兼容无明确状态的旧数据：若报名时间窗口已开启，判定为报名期。
  if (registrationStart && registrationEnd) {
    const now = Date.now();
    const start = new Date(registrationStart).getTime();
    const end = new Date(registrationEnd).getTime();
    if (now >= start && now <= end) return "报名";
  }
  return "筹备";
}

export interface EventStageConfig {
  title: string;
  description: string;
  cta: string; // 主 CTA 按钮文字
  ctaHref: string; // 主 CTA 链接（含 {id} 占位符）
  defaultTab: string; // 详情页默认选中的 tab
}

export const STAGE_CONFIGS: Record<EventStage, EventStageConfig> = {
  筹备: {
    title: "竞赛规程与报名信息",
    description: "竞赛赛制、参赛资格及报名时间以赛事组正式公告为准。",
    cta: "查看竞赛规程",
    ctaHref: "/events/{id}?tab=赛事手册#event-content",
    defaultTab: "赛事手册",
  },
  报名: {
    title: "参赛报名",
    description: "参赛选手须在规定期限内完成个人登记与队伍申报。",
    cta: "提交参赛报名",
    ctaHref: "/events/{id}/register",
    defaultTab: "队伍名单",
  },
  分组: {
    title: "分组与首轮对阵",
    description: "赛事分组、种子顺位及首轮对阵以抽签结果为准。",
    cta: "查看分组对阵",
    ctaHref: "/events/{id}?tab=对阵图#event-content",
    defaultTab: "对阵图",
  },
  比赛: {
    title: "赛事赛程与比赛状态",
    description: "所有比赛以赛事平台公布的最新有效赛程为准。",
    cta: "查看赛事赛程",
    ctaHref: "/events/{id}?tab=赛程#event-content",
    defaultTab: "赛程",
  },
  赛后: {
    title: "最终赛果与赛事排名",
    description: "最终赛果、赛事排名及完整对阵以赛事组公布记录为准。",
    cta: "查看最终赛果",
    ctaHref: "/events/{id}?tab=赛程#event-content",
    defaultTab: "赛程",
  },
};
