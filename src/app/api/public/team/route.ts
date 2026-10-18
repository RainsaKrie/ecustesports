// =====================
// 公开组队接口：玩家建队（无需登录）
// 只做单次动作，不做全量覆盖
// =====================

import { updateEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { findParticipant, readParticipantToken } from "@/lib/domains/identity/participant-auth";
import { initialRegistration, normalizeRegistrationState, type RegistrationState } from "@/lib/domains/registration/data";
import { createTeamOp, dissolveTeamOp, leaveTeamOp, renameTeamOp, setMemberRoleOp, type PlayerRole } from "@/lib/scheduling/registration-ops";
import { isEventPublic } from "@/lib/configured-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 20_000) {
      return Response.json({ message: "请求内容过长。" }, { status: 413 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name : "";
    const action = typeof body.action === "string" ? body.action.trim() : "";
    const role = (typeof body.role === "string" && ["首发", "替补", "教练"].includes(body.role)) ? body.role as PlayerRole : undefined;
    const playerId = typeof body.playerId === "string" ? body.playerId.trim() : "";
    const token = readParticipantToken(request);

    // 报名时间窗口校验
    const config = await getSiteConfig();
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    if (eventId && !config.events.some((event) => event.id === eventId)) {
      return Response.json({ message: "赛事不存在或已下线。" }, { status: 404 });
    }
    const event = config.events.find((item) => item.id === eventId && isEventPublic(item) && item.status !== "archived");
    if (!event) return Response.json({ message: "赛事不存在或尚未公开。" }, { status: 404 });
    const { registrationStart, teamRegistrationEnd } = event;
    if (registrationStart && teamRegistrationEnd) {
      const now = Date.now();
      const start = new Date(`${registrationStart}T00:00:00`).getTime();
      const end = new Date(`${teamRegistrationEnd}T23:59:59`).getTime();
      if (now < start || now > end) {
        return Response.json({ message: "当前不在队伍申报时间内。" }, { status: 403 });
      }
    }

    if (action === "leave" || action === "dissolve") {
      return handleLeaveOrDissolve(event.id, token, action);
    }
    if (action === "rename") {
      return handleRename(event.id, token, name);
    }
    if (action === "set-role") {
      return handleSetRole(event.id, token, playerId, role);
    }

    let message = "";
    let createdTeam: ReturnType<typeof createTeamOp>["team"];
    await updateEventData<RegistrationState>(event.id, "registration", initialRegistration(), (stored) => {
      const state = normalizeRegistrationState(stored);
      const captain = findParticipant(state, token);
      if (!captain) {
        message = "参赛管理码无效，请重新进入参赛管理。";
        return state;
      }
      if (state.teamRegistrationClosed) {
        message = "队伍申报已截止，不能再新建队伍。";
        return state;
      }
      const result = createTeamOp(state, { name, captainId: captain.id, captainRole: role });
      if (!result.ok || !result.state) {
        message = result.message ?? "建队失败";
        return state;
      }
      createdTeam = result.team;
      return result.state;
    });
    if (message || !createdTeam) return Response.json({ message: message || "建队失败" }, { status: message.includes("管理码") ? 401 : 400 });
    return Response.json({ team: createdTeam });
  } catch {
    return Response.json({ message: "建队失败，请稍后重试。" }, { status: 400 });
  }
}

async function handleLeaveOrDissolve(eventId: string, token: string, action: "leave" | "dissolve") {
  let message = "";
  await updateEventData<RegistrationState>(eventId, "registration", initialRegistration(), (stored) => {
    const state = normalizeRegistrationState(stored);
    const actor = findParticipant(state, token);
    if (!actor) {
      message = "参赛管理码无效，请重新进入参赛管理。";
      return state;
    }
    if (state.teamRegistrationClosed) {
      message = "队伍申报已截止。";
      return state;
    }
    const result = action === "leave"
      ? leaveTeamOp(state, { playerId: actor.id })
      : dissolveTeamOp(state, { teamId: actor.teamId ?? "" });
    if (!result.ok || !result.state) {
      message = result.message ?? "操作失败";
      return state;
    }
    return result.state;
  });
  if (message) return Response.json({ message }, { status: message.includes("管理码") ? 401 : 400 });
  return Response.json({ message: action === "leave" ? "已退出队伍。" : "队伍已解散。" });
}

async function handleRename(eventId: string, token: string, name: string) {
  let message = "";
  await updateEventData<RegistrationState>(eventId, "registration", initialRegistration(), (stored) => {
    const state = normalizeRegistrationState(stored);
    const actor = findParticipant(state, token);
    if (!actor) {
      message = "参赛管理码无效，请重新进入参赛管理。";
      return state;
    }
    if (state.teamRegistrationClosed) {
      message = "队伍申报已截止。";
      return state;
    }
    const team = state.teams.find((t) => t.id === actor.teamId);
    if (!team) {
      message = "你尚未加入任何队伍。";
      return state;
    }
    if (team.captainId !== actor.id) {
      message = "只有队长可以修改队名。";
      return state;
    }
    const result = renameTeamOp(state, { teamId: team.id, name });
    if (!result.ok || !result.state) {
      message = result.message ?? "改名失败";
      return state;
    }
    return result.state;
  });
  if (message) return Response.json({ message }, { status: message.includes("管理码") ? 401 : 400 });
  return Response.json({ message: "队名已更新。" });
}

async function handleSetRole(eventId: string, token: string, playerId: string, role?: PlayerRole) {
  if (!role) return Response.json({ message: "角色不合法。" }, { status: 400 });
  let message = "";
  await updateEventData<RegistrationState>(eventId, "registration", initialRegistration(), (stored) => {
    const state = normalizeRegistrationState(stored);
    const actor = findParticipant(state, token);
    if (!actor) {
      message = "参赛管理码无效，请重新进入参赛管理。";
      return state;
    }
    if (state.teamRegistrationClosed) {
      message = "队伍申报已截止。";
      return state;
    }
    const team = state.teams.find((t) => t.id === actor.teamId);
    if (!team) {
      message = "你尚未加入任何队伍。";
      return state;
    }
    // 选手只能改自己的角色（队长也在此列，可改自己）；管理员改任意成员走管理接口。
    const targetId = playerId || actor.id;
    if (targetId === actor.id) {
      const result = setMemberRoleOp(state, { teamId: team.id, playerId: targetId, role });
      if (!result.ok || !result.state) {
        message = result.message ?? "调整角色失败";
        return state;
      }
      return result.state;
    }
    if (team.captainId !== actor.id) {
      message = "无权调整其他成员的角色。";
      return state;
    }
    const result = setMemberRoleOp(state, { teamId: team.id, playerId: targetId, role });
    if (!result.ok || !result.state) {
      message = result.message ?? "调整角色失败";
      return state;
    }
    return result.state;
  });
  if (message) return Response.json({ message }, { status: message.includes("管理码") ? 401 : 400 });
  return Response.json({ message: "角色已更新。" });
}
