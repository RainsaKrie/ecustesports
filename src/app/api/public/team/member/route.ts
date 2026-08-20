// =====================
// 公开组队接口：队长把选手池成员加入队伍（无需登录）
// 只做单次动作，不做全量覆盖
// =====================

import { readEventData, writeEventData } from "@/lib/data-store";
import { getEvent, getSiteConfig } from "@/lib/site-config";
import { initialRegistration, normalizeRegistrationState, type RegistrationState } from "@/lib/scheduling/registration-data";
import { addMemberOp, type PlayerRole } from "@/lib/scheduling/registration-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 20_000) {
      return Response.json({ message: "请求内容过长。" }, { status: 413 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const teamId = typeof body.teamId === "string" ? body.teamId : "";
    const playerId = typeof body.playerId === "string" ? body.playerId : "";
    const role = body.role as PlayerRole;
    if (!teamId || !playerId) {
      return Response.json({ message: "缺少队伍或选手信息。" }, { status: 400 });
    }

    // 报名时间窗口校验
    const config = await getSiteConfig();
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    if (eventId && !config.events.some((event) => event.id === eventId)) {
      return Response.json({ message: "赛事不存在或已下线。" }, { status: 404 });
    }
    const event = getEvent(config, eventId);
    const { registrationStart, teamRegistrationEnd } = event;
    if (registrationStart && teamRegistrationEnd) {
      const now = Date.now();
      const start = new Date(`${registrationStart}T00:00:00`).getTime();
      const end = new Date(`${teamRegistrationEnd}T23:59:59`).getTime();
      if (now < start || now > end) {
        return Response.json({ message: "当前不在队伍申报时间内。" }, { status: 403 });
      }
    }

    const state = normalizeRegistrationState(
      await readEventData<RegistrationState>(event.id, "registration", initialRegistration()),
    );
    if (state.teamRegistrationClosed) {
      return Response.json({ message: "队伍申报已截止，不能再调整成员。" }, { status: 403 });
    }

    const result = addMemberOp(state, { teamId, playerId, role });
    if (!result.ok || !result.state) {
      return Response.json({ message: result.message ?? "入队失败" }, { status: 400 });
    }

    await writeEventData(event.id, "registration", result.state);
    return Response.json({ team: result.team, state: result.state });
  } catch {
    return Response.json({ message: "入队失败，请稍后重试。" }, { status: 400 });
  }
}
