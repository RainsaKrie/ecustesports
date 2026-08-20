// =====================
// 公开组队接口：玩家建队（无需登录）
// 只做单次动作，不做全量覆盖
// =====================

import { readEventData, writeEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { initialRegistration, type RegistrationState } from "@/lib/scheduling/registration-data";
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
    const captainId = typeof body.captainId === "string" ? body.captainId : "";
    if (!captainId) {
      return Response.json({ message: "缺少队长身份，请先完成报名。" }, { status: 400 });
    }

    // 报名时间窗口校验
    const config = await getSiteConfig();
    const { registrationStart, registrationEnd } = config.events.find((e) => e.id === config.currentEventId) ?? config.events[0];
    if (registrationStart && registrationEnd) {
      const now = Date.now();
      const start = new Date(`${registrationStart}T00:00:00`).getTime();
      const end = new Date(`${registrationEnd}T23:59:59`).getTime();
      if (now < start || now > end) {
        return Response.json({ message: "当前不在报名时间内。" }, { status: 403 });
      }
    }

    const state = await readEventData<RegistrationState>(config.currentEventId, "registration", initialRegistration());
    if (state.frozen) {
      return Response.json({ message: "名单已冻结，不能再新建队伍。" }, { status: 403 });
    }

    const result = createTeamOp(state, { name, captainId });
    if (!result.ok || !result.state) {
      return Response.json({ message: result.message ?? "建队失败" }, { status: 400 });
    }

    await writeEventData(config.currentEventId, "registration", result.state);
    return Response.json({ team: result.team, state: result.state });
  } catch {
    return Response.json({ message: "建队失败，请稍后重试。" }, { status: 400 });
  }
}
