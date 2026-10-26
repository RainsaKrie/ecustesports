// =====================
// 赛事进度：判断「赛程是不是真的打完了」（2026-10-13）
//
// 为什么单独一份：管理端「赛事阶段」面板与服务端的「结束赛事」校验原先各自数一遍
//   「已完成的场次数 === 赛程里的总场次数」
// —— 那条判据只覆盖**赛程里当前已经存在的比赛**，没有「赛制后面还有阶段、对阵还没生成」这个概念。
//
// 于是本届（四阶段：资格赛 → 入围赛 → 小组赛 → 淘汰赛）会出现：
//   赛程在入围赛阶段只有 20 场（资格赛 4 + 入围赛 16），
//   **16 场入围赛一录完就是 20/20** → 面板说「全部比赛已完成」并把按钮换成「结束赛事」，
//   而小组赛与淘汰赛一场都还没打。服务端用的是同一条判据，所以点下去会真的结束赛事。
//
// 修法：在「比赛全部完成」之外再加一条 —— **赛制里每一个阶段都已经在赛程里出现过**。
// 单阶段赛制（如 16 队单败）本来就没有后续阶段，那条旧判据对它是正确的，这里自然成立。
//
// 守卫与逐形态用例见 `event-progress.test.ts`。
// =====================

import { resolveSupportedFormat, type SupportedFormat } from "./format-support.ts";
import type { FormatStageConfig } from "./format-templates.ts";
import type { ScheduleMatch } from "./schedule-data.ts";

/**
 * 一个赛制里阶段的先后顺序（含「并入型」的资格赛 —— 它虽然不产生淘汰者之外的晋级，
 * 但确实是赛程里的一个阶段，漏掉它会让「只打完资格赛」被误判成「赛事打完」）。
 * 识别不了的赛制返回空数组，调用方据此退回旧判据。
 */
export function formatStageNames(format: SupportedFormat): string[] {
  switch (format.kind) {
    case "staged-playin":
      return [format.playInStage.name, ...format.stages.map((stage) => stage.name)];
    case "staged-32-gsl-double-elim":
      return format.stages.map((stage) => stage.name);
    case "gsl-double-elim":
      return [format.groupStage.name, format.knockoutStage.name];
    case "slot-draw":
      return [format.stage.name];
    case "swiss":
    case "round-robin":
      return [format.stage.name];
    case "unsupported":
      return [];
  }
}

export interface EventProgress {
  /** 赛制里的阶段顺序（识别不了则为空） */
  stageNames: string[];
  /** 赛程里还一场都没有的阶段（按赛制顺序） */
  stagesNotStarted: string[];
  /** 下一个尚未开始的阶段（都开始了则为 null） */
  nextStageName: string | null;
  /** 赛程里现有比赛是否已全部完成 */
  allMatchesCompleted: boolean;
  /** **赛事真的打完了**：现有比赛全部完成，且赛制里每个阶段都已经有比赛 */
  finished: boolean;
}

/**
 * 由赛制配置与赛程算出进度。
 *
 * 两个调用方共用它，避免「面板」与「服务端校验」再各数一遍：
 *   · `src/app/admin/events/[id]/layout.tsx` —— 驱动阶段面板的提示与按钮；
 *   · `src/app/api/admin/events/stage/route.ts` —— 结束赛事前的服务端校验。
 */
export function resolveEventProgress(
  stageConfigs: FormatStageConfig[],
  matches: ScheduleMatch[],
): EventProgress {
  const stageNames = formatStageNames(resolveSupportedFormat(stageConfigs));
  const startedPhases = new Set(matches.map((match) => match.phase));
  const stagesNotStarted = stageNames.filter((name) => !startedPhases.has(name));
  const allMatchesCompleted = matches.length > 0 && matches.every((match) => match.status === "已完成");

  return {
    stageNames,
    stagesNotStarted,
    nextStageName: stagesNotStarted[0] ?? null,
    allMatchesCompleted,
    finished: allMatchesCompleted && stagesNotStarted.length === 0,
  };
}

/**
 * 「现在能不能结束赛事」的判定，返回拒绝理由；`null` 表示可以结束。
 *
 * 提成纯函数而不是留在路由里，是为了让它**能被单测** ——
 * 「面板不骗人」与「服务端真的拦得住」是两件事，后者必须单独断言：
 * 面板只是提示，拦截才是最后一道闸。
 * 三段检查的顺序保持与原先路由里一致（先比赛、再改期申请、最后阶段）。
 */
export function completeEventRefusal(
  stageConfigs: FormatStageConfig[],
  schedule: { matches: ScheduleMatch[]; requests: Array<{ status: string }> },
): string | null {
  if (schedule.matches.length === 0 || schedule.matches.some((match) => match.status !== "已完成")) {
    return "仍有比赛未完成，不能结束赛事";
  }
  if (schedule.requests.some((request) => request.status === "待对手确认" || request.status === "待审批")) {
    return "仍有改期申请待处理，不能结束赛事";
  }
  const progress = resolveEventProgress(stageConfigs, schedule.matches);
  if (!progress.finished) {
    return `赛制还有 ${progress.stagesNotStarted.length} 个阶段未开始：${progress.stagesNotStarted.join("、")}，不能结束赛事`;
  }
  return null;
}
