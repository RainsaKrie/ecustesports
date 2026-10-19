// =====================
// 用例：赛事阶段推进（advance-stage）
//
// 架构里的 L2 —— 唯一允许跨领域的地方。这里跨了五个领域：
// content（发布检查）、registration（报名与队伍）、schedule（赛程进度）、
// site-config（赛事状态）、以及 data-store（读取）。
//
// **什么没搬进来**：鉴权（isAdminRequest）、留痕（recordOperationAuditSafely）、HTTP 响应。
// 它们要么依赖原始 request、要么是横切关注，留在 L3 更合适 —— 守卫的三份登记
// （写入点清单 / 鉴权登记 / 留痕归属）因此都不用改。
// =====================

import { readEventData, updateEventData } from "@/lib/data-store";
import { publicationChecklist } from "@/lib/domains/content/publication-check";
import { getSiteConfig, updateSiteConfig } from "@/lib/site-config";
import { initialRegistration, normalizeRegistrationState, type RegistrationState } from "@/lib/domains/registration/data";
import { emptySchedule, normalizeScheduleState, type ScheduleState } from "@/lib/domains/schedule/schedule-data";
import { completeEventRefusal } from "@/lib/domains/schedule/event-progress";

export class StageTransitionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type StageAction = "open-registration" | "close-registration" | "complete-event";

export function isStageAction(value: unknown): value is StageAction {
  return value === "open-registration" || value === "close-registration" || value === "complete-event";
}

export interface StageTransitionResult {
  /** 推进前的状态，供留痕使用 */
  from: string;
  /** 推进后的状态 */
  to: string;
  message: string;
  event: unknown;
}

const TO_STATUS: Record<StageAction, "registration" | "ongoing" | "completed"> = {
  "open-registration": "registration",
  "close-registration": "ongoing",
  "complete-event": "completed",
};

const MESSAGE: Record<StageAction, string> = {
  "open-registration": "赛事已进入报名阶段",
  "close-registration": "报名已结束，赛事已进入分组阶段",
  "complete-event": "赛事已结束",
};

/**
 * 校验并推进赛事阶段。
 * 失败一律抛 `StageTransitionError`（带状态码），由 L3 统一映射成响应。
 */
export async function runStageTransition(eventId: string, action: StageAction): Promise<StageTransitionResult> {
  const currentConfig = await getSiteConfig();
  const currentEvent = currentConfig.events.find((item) => item.id === eventId);
  if (!currentEvent) throw new StageTransitionError("赛事不存在", 404);

  if (action === "close-registration") {
    if (currentEvent.status !== "registration") {
      throw new StageTransitionError("当前赛事已不在报名阶段，请刷新页面", 409);
    }
    if (currentEvent.visibility !== "public") {
      throw new StageTransitionError("赛事未公开，不能进入分组阶段", 409);
    }
    const registration = normalizeRegistrationState(
      await readEventData<RegistrationState>(eventId, "registration", initialRegistration()),
    );
    const activePlayers = registration.players.filter((player) => player.status !== "已退赛");
    const pendingReviewCount = activePlayers.filter((player) => (player.reviewStatus ?? "已通过") !== "已通过").length;
    const confirmedTeamCount = registration.teams.filter((team) => team.status === "已冻结").length;
    if (pendingReviewCount > 0) {
      throw new StageTransitionError(`仍有 ${pendingReviewCount} 名选手被标记为资料不合规，请先处理`, 409);
    }
    if (confirmedTeamCount < currentEvent.teamCount) {
      throw new StageTransitionError(`正式队伍 ${confirmedTeamCount}/${currentEvent.teamCount} 支，暂不能进入分组`, 409);
    }
    await updateEventData<RegistrationState>(eventId, "registration", initialRegistration(), (stored) => ({
      ...normalizeRegistrationState(stored),
      playerRegistrationClosed: true,
      teamRegistrationClosed: true,
    }));
  }

  if (action === "complete-event") {
    if (currentEvent.status !== "ongoing") {
      throw new StageTransitionError("当前赛事不在比赛阶段，请刷新页面", 409);
    }
    const schedule = normalizeScheduleState(await readEventData<ScheduleState>(eventId, "schedule", emptySchedule()));
    // 判断已提到 event-progress 的 completeEventRefusal（纯函数、有单测），面板用的是同一份判断，
    // 避免"两处口径走偏"——这条注释在抽取前就在，原样保留。
    const refusal = completeEventRefusal(currentEvent.stageConfigs ?? [], schedule);
    if (refusal) throw new StageTransitionError(refusal, 409);
  }

  const saved = await updateSiteConfig((config) => {
    const event = config.events.find((item) => item.id === eventId);
    if (!event) throw new StageTransitionError("赛事不存在", 404);
    if (action === "open-registration") {
      if (event.status !== "draft") throw new StageTransitionError("当前赛事已不在筹备阶段，请刷新页面", 409);
      if (event.visibility !== "public") throw new StageTransitionError("请先发布赛事，再进入报名阶段", 409);
      const issues = publicationChecklist(event).filter((item) => !item.ok);
      if (issues.length > 0) throw new StageTransitionError(`仍有 ${issues.length} 项发布信息需要确认`, 409);
    } else if (action === "close-registration" && event.status !== "registration") {
      throw new StageTransitionError("当前赛事已不在报名阶段，请刷新页面", 409);
    } else if (action === "complete-event" && event.status !== "ongoing") {
      throw new StageTransitionError("当前赛事已不在比赛阶段，请刷新页面", 409);
    }

    return {
      ...config,
      events: config.events.map((item) => (item.id === eventId ? { ...item, status: TO_STATUS[action] } : item)),
    };
  });

  return {
    from: currentEvent.status,
    to: TO_STATUS[action],
    message: MESSAGE[action],
    event: saved.events.find((item) => item.id === eventId),
  };
}
