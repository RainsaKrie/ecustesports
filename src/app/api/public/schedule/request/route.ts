import type { NextRequest } from "next/server";
import { readEventData, updateEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { isEventPublic } from "@/lib/configured-events";
import { findParticipant, readParticipantToken } from "@/lib/participant-auth";
import {
  initialRegistration,
  normalizeRegistrationState,
  type RegistrationState,
} from "@/lib/scheduling/registration-data";
import {
  emptySchedule,
  normalizeScheduleState,
  type ScheduleState,
} from "@/lib/scheduling/schedule-data";
import {
  resolveCaptainRequestOp,
  stampScheduleVersion,
  submitCaptainRequestOp,
  type CaptainRequestResult,
} from "@/lib/scheduling/schedule-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function shortText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function resolveContext(request: NextRequest, eventId: string) {
  const config = await getSiteConfig();
  const event = config.events.find((item) => item.id === eventId && isEventPublic(item) && item.status !== "archived");
  if (!event) return { error: "赛事不存在或尚未公开。", status: 404 as const };
  const registration = normalizeRegistrationState(
    await readEventData<RegistrationState>(eventId, "registration", initialRegistration()),
  );
  const player = findParticipant(registration, readParticipantToken(request));
  if (!player) return { error: "参赛管理码无效。", status: 401 as const };
  const team = player.teamId ? registration.teams.find((item) => item.id === player.teamId) : undefined;
  if (!team || team.captainId !== player.id) {
    return { error: "只有本场参赛队伍的队长可以操作约赛时间。", status: 403 as const };
  }
  return { event, player, team };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const eventId = shortText(body.eventId, 60);
    const matchId = shortText(body.matchId, 80);
    const newStartTime = shortText(body.newStartTime, 32);
    const reason = shortText(body.reason, 160);
    if (!eventId || !matchId || !newStartTime || Number.isNaN(new Date(newStartTime).getTime())) {
      return Response.json({ message: "请填写完整、有效的比赛时间。" }, { status: 400 });
    }
    const context = await resolveContext(request, eventId);
    if ("error" in context) return Response.json({ message: context.error }, { status: context.status });

    let result: CaptainRequestResult = { ok: false, message: "约赛申请创建失败。" };
    await updateEventData<ScheduleState>(eventId, "schedule", emptySchedule(), (stored) => {
      const state = normalizeScheduleState(stored);
      const output = submitCaptainRequestOp(state, {
        matchId,
        newStartTime: newStartTime.length === 16 ? `${newStartTime}:00` : newStartTime,
        reason,
        proposedByTeamId: context.team.id,
      }, state.config);
      result = output.value ?? result;
      return stampScheduleVersion(state, output.state);
    });
    return Response.json(result, { status: result.ok ? 200 : result.validation ? 409 : 400 });
  } catch {
    return Response.json({ message: "约赛申请提交失败，请稍后重试。" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const eventId = shortText(body.eventId, 60);
    const requestId = shortText(body.requestId, 100);
    const decision = body.decision === "accept" ? "accept" : body.decision === "reject" ? "reject" : "";
    if (!eventId || !requestId || !decision) {
      return Response.json({ message: "缺少约赛申请或处理结果。" }, { status: 400 });
    }
    const context = await resolveContext(request, eventId);
    if ("error" in context) return Response.json({ message: context.error }, { status: context.status });

    let result: CaptainRequestResult = { ok: false, message: "约赛申请处理失败。" };
    await updateEventData<ScheduleState>(eventId, "schedule", emptySchedule(), (stored) => {
      const state = normalizeScheduleState(stored);
      const output = resolveCaptainRequestOp(state, {
        requestId,
        actorTeamId: context.team.id,
        decision,
      }, state.config);
      result = output.value ?? result;
      return stampScheduleVersion(state, output.state);
    });
    return Response.json(result, { status: result.ok ? 200 : result.validation ? 409 : 400 });
  } catch {
    return Response.json({ message: "约赛申请处理失败，请稍后重试。" }, { status: 400 });
  }
}
