import type { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/domains/identity/admin-session";
import { readEventData, updateEventData } from "@/lib/data-store";
import { publicationChecklist } from "@/lib/domains/content/publication-check";
import { getSiteConfig, updateSiteConfig } from "@/lib/site-config";
import { initialRegistration, normalizeRegistrationState, type RegistrationState } from "@/lib/domains/registration/data";
import { emptySchedule, normalizeScheduleState, type ScheduleState } from "@/lib/scheduling/schedule-data";
import { completeEventRefusal } from "@/lib/scheduling/event-progress";
import { recordOperationAuditSafely } from "@/lib/operation-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class StageTransitionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type StageAction = "open-registration" | "close-registration" | "complete-event";

function isStageAction(value: unknown): value is StageAction {
  return value === "open-registration" || value === "close-registration" || value === "complete-event";
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const eventId = typeof input.eventId === "string" ? input.eventId.trim() : "";
    const action = input.action;
    if (!eventId || !isStageAction(action)) {
      throw new StageTransitionError("阶段操作不合法", 400);
    }

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
      const schedule = normalizeScheduleState(
        await readEventData<ScheduleState>(eventId, "schedule", emptySchedule()),
      );
      /**
       * ★ 这里原来只问「赛程里现有比赛是否都完成」，而四阶段赛制录完入围赛时
       * 赛程里只有资格赛 + 入围赛（20 场）——20/20 会让它判定「赛事结束」，
       * 把小组赛与淘汰赛整段跳过。判断已提到 `scheduling/event-progress` 的
       * `completeEventRefusal`（纯函数，有单测），面板用的是同一份判断，避免两处口径再走偏。
       */
      const refusal = completeEventRefusal(currentEvent.stageConfigs ?? [], schedule);
      if (refusal) throw new StageTransitionError(refusal, 409);
    }

    const saved = await updateSiteConfig((config) => {
      const event = config.events.find((item) => item.id === eventId);
      if (!event) throw new StageTransitionError("赛事不存在", 404);
      if (action === "open-registration") {
        if (event.status !== "draft") {
          throw new StageTransitionError("当前赛事已不在筹备阶段，请刷新页面", 409);
        }
        if (event.visibility !== "public") {
          throw new StageTransitionError("请先发布赛事，再进入报名阶段", 409);
        }
        const issues = publicationChecklist(event).filter((item) => !item.ok);
        if (issues.length > 0) {
          throw new StageTransitionError(`仍有 ${issues.length} 项发布信息需要确认`, 409);
        }
      } else if (action === "close-registration" && event.status !== "registration") {
        throw new StageTransitionError("当前赛事已不在报名阶段，请刷新页面", 409);
      } else if (action === "complete-event" && event.status !== "ongoing") {
        throw new StageTransitionError("当前赛事已不在比赛阶段，请刷新页面", 409);
      }

      return {
        ...config,
        events: config.events.map((item) => item.id === eventId
          ? {
              ...item,
              status: action === "open-registration"
                ? "registration" as const
                : action === "close-registration"
                  ? "ongoing" as const
                  : "completed" as const,
            }
          : item),
      };
    });

    const nextStatus = action === "open-registration"
      ? "registration"
      : action === "close-registration"
        ? "ongoing"
        : "completed";
    await recordOperationAuditSafely(request, {
      eventId,
      actorType: "admin",
      action: `event.stage.${action}`,
      target: currentEvent.name,
      metadata: { from: currentEvent.status, to: nextStatus },
    });

    return Response.json({
      message: action === "open-registration"
        ? "赛事已进入报名阶段"
        : action === "close-registration"
          ? "报名已结束，赛事已进入分组阶段"
          : "赛事已结束",
      event: saved.events.find((item) => item.id === eventId),
    });
  } catch (error) {
    if (error instanceof StageTransitionError) {
      return Response.json({ message: error.message }, { status: error.status });
    }
    return Response.json({ message: "阶段更新失败，请稍后重试" }, { status: 400 });
  }
}
