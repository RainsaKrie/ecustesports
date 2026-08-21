// =====================
// 公开组队接口：玩家建队（无需登录）
// 只做单次动作，不做全量覆盖
// =====================

import { updateEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { findParticipant, readParticipantToken } from "@/lib/participant-auth";
import { initialRegistration, normalizeRegistrationState, type RegistrationState } from "@/lib/scheduling/registration-data";
import { createTeamOp } from "@/lib/scheduling/registration-ops";

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
    const token = readParticipantToken(request);

    // 报名时间窗口校验
    const config = await getSiteConfig();
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    if (eventId && !config.events.some((event) => event.id === eventId)) {
      return Response.json({ message: "赛事不存在或已下线。" }, { status: 404 });
    }
    const event = config.events.find((item) => item.id === eventId && item.status !== "draft" && item.status !== "archived");
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
      const result = createTeamOp(state, { name, captainId: captain.id });
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
