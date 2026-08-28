import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { updateEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { findParticipant, readParticipantToken } from "@/lib/participant-auth";
import { addMemberOp, type PlayerRole } from "@/lib/scheduling/registration-ops";
import {
  initialRegistration,
  normalizeRegistrationState,
  type RegistrationState,
  type TeamRequest,
  type TeamRequestType,
} from "@/lib/scheduling/registration-data";
import { isEventPublic } from "@/lib/configured-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES: PlayerRole[] = ["首发", "替补", "教练"];

async function resolveEvent(eventId: string) {
  const config = await getSiteConfig();
  return config.events.find((event) => event.id === eventId && isEventPublic(event) && event.status !== "archived");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    const type = body.type as TeamRequestType;
    const teamId = typeof body.teamId === "string" ? body.teamId.trim() : "";
    const role = body.role as PlayerRole;
    const targetGameId = typeof body.targetGameId === "string" ? body.targetGameId.trim().slice(0, 40) : "";
    if (!await resolveEvent(eventId)) return Response.json({ message: "赛事不存在或尚未公开。" }, { status: 404 });
    if (!teamId || !["application", "invitation"].includes(type) || !ROLES.includes(role)) {
      return Response.json({ message: "组队请求信息不完整。" }, { status: 400 });
    }

    const token = readParticipantToken(request);
    let message = "";
    let created: TeamRequest | undefined;
    await updateEventData<RegistrationState>(eventId, "registration", initialRegistration(), (stored) => {
      const state = normalizeRegistrationState(stored);
      const actor = findParticipant(state, token);
      const team = state.teams.find((item) => item.id === teamId);
      if (!actor) {
        message = "参赛管理码无效。";
        return state;
      }
      if (state.teamRegistrationClosed) {
        message = "队伍申报已截止。";
        return state;
      }
      if (!team || team.status !== "报名中") {
        message = "该队伍当前不能接收组队请求。";
        return state;
      }

      let playerId = actor.id;
      if (type === "application") {
        if (actor.teamId) {
          message = "你已经加入队伍，不能重复申请。";
          return state;
        }
      } else {
        if (team.captainId !== actor.id) {
          message = "只有队长可以发送邀请。";
          return state;
        }
        const target = state.players.find((item) => item.gameId.toLowerCase() === targetGameId.toLowerCase() && item.status === "已报名");
        if (!target || !targetGameId) {
          message = "未找到可邀请的选手，请核对完整游戏 ID。";
          return state;
        }
        playerId = target.id;
      }

      const requests = state.teamRequests ?? [];
      if (requests.some((item) => item.teamId === teamId && item.playerId === playerId && item.status === "pending")) {
        message = "双方之间已有待处理请求。";
        return state;
      }
      created = {
        id: `TR-${randomUUID()}`,
        type,
        teamId,
        playerId,
        role,
        initiatedByPlayerId: actor.id,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      return { ...state, teamRequests: [...requests, created] };
    });
    if (message || !created) return Response.json({ message: message || "请求创建失败。" }, { status: message.includes("管理码") ? 401 : 400 });
    return Response.json({ request: created });
  } catch {
    return Response.json({ message: "请求提交失败，请稍后重试。" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
    const decision = body.decision === "accept" ? "accept" : body.decision === "reject" ? "reject" : "";
    if (!await resolveEvent(eventId)) return Response.json({ message: "赛事不存在或尚未公开。" }, { status: 404 });
    if (!requestId || !decision) return Response.json({ message: "缺少处理结果。" }, { status: 400 });

    const token = readParticipantToken(request);
    let message = "";
    await updateEventData<RegistrationState>(eventId, "registration", initialRegistration(), (stored) => {
      const state = normalizeRegistrationState(stored);
      const actor = findParticipant(state, token);
      const requests = state.teamRequests ?? [];
      const target = requests.find((item) => item.id === requestId);
      if (!actor) {
        message = "参赛管理码无效。";
        return state;
      }
      if (!target || target.status !== "pending") {
        message = "该请求已失效或已处理。";
        return state;
      }
      const team = state.teams.find((item) => item.id === target.teamId);
      const canResolve = target.type === "application"
        ? team?.captainId === actor.id
        : target.playerId === actor.id;
      if (!canResolve) {
        message = "你无权处理该请求。";
        return state;
      }
      const resolvedAt = new Date().toISOString();
      if (decision === "reject") {
        return { ...state, teamRequests: requests.map((item) => item.id === target.id ? { ...item, status: "rejected" as const, resolvedAt } : item) };
      }
      if (state.teamRegistrationClosed) {
        message = "队伍申报已截止，不能再确认入队。";
        return state;
      }
      const result = addMemberOp(state, { teamId: target.teamId, playerId: target.playerId, role: target.role });
      if (!result.ok || !result.state) {
        message = result.message ?? "确认入队失败。";
        return state;
      }
      return {
        ...result.state,
        teamRequests: requests.map((item) => {
          if (item.id === target.id) return { ...item, status: "accepted" as const, resolvedAt };
          if (item.playerId === target.playerId && item.status === "pending") return { ...item, status: "cancelled" as const, resolvedAt };
          return item;
        }),
      };
    });
    if (message) return Response.json({ message }, { status: message.includes("管理码") ? 401 : 400 });
    return Response.json({ message: decision === "accept" ? "已确认入队。" : "已拒绝请求。" });
  } catch {
    return Response.json({ message: "请求处理失败，请稍后重试。" }, { status: 400 });
  }
}
