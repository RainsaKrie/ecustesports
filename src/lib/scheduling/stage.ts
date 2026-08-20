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
  // 进行中：有赛程 = 比赛期，没赛程 = 分组期
  if (status === "ongoing") return hasSchedule ? "比赛" : "分组";
  // 报名中
  if (status === "registration") return "报名";
  // 筹备中：若报名时间窗口已开启，自动进报名期
  if (registrationStart && registrationEnd) {
    const now = Date.now();
    const start = new Date(registrationStart).getTime();
    const end = new Date(registrationEnd).getTime();
    if (now >= start && now <= end) return "报名";
  }
  return "筹备";
}

export interface StageConfig {
  cta: string; // 主 CTA 按钮文字
  ctaHref: string; // 主 CTA 链接（含 {id} 占位符）
  defaultTab: string; // 详情页默认选中的 tab
}

export const STAGE_CONFIGS: Record<EventStage, StageConfig> = {
  筹备: {
    cta: "查看参赛须知",
    ctaHref: "/events/{id}",
    defaultTab: "选手名单",
  },
  报名: {
    cta: "立即报名",
    ctaHref: "/events/{id}/register",
    defaultTab: "队伍名单",
  },
  分组: {
    cta: "查看分组",
    ctaHref: "/events/{id}",
    defaultTab: "对阵图",
  },
  比赛: {
    cta: "看今日赛程",
    ctaHref: "/events/{id}",
    defaultTab: "对阵图",
  },
  赛后: {
    cta: "查看赛果",
    ctaHref: "/events/{id}",
    defaultTab: "对阵图",
  },
};
