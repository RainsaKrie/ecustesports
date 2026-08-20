// =====================
// 赛事管理接口（管理员）
// POST /api/admin/events        新建比赛（按赛制模板实例化）
// POST /api/admin/events/switch 切换当前赛事
// =====================

import { getSiteConfig, saveSiteConfig } from "@/lib/site-config";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { buildEventFromTemplate, type StageConfig } from "@/lib/scheduling/format-templates";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdmin(request: NextRequest): boolean {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

function text(v: unknown, max = 500): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => null);
    const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

    const name = typeof input.name === "string" ? input.name.trim() : "";
    const organizer = typeof input.organizer === "string" ? input.organizer.trim() : "";
    if (!name || !organizer) {
      return Response.json({ message: "赛事名称和主办方为必填项" }, { status: 400 });
    }

    // 赛制阶段配置（三步向导第二步的产物）
    const rawStages = Array.isArray(input.stageConfigs) ? input.stageConfigs : [];
    const validTypes = ["single-elim", "gsl-groups", "double-elim", "round-robin"];
    const validBo = ["BO1", "BO3", "BO5"];
    const stageConfigs: StageConfig[] = rawStages
      .map((raw) => {
        const st = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
        const type = validTypes.includes(st.type as string) ? (st.type as StageConfig["type"]) : "single-elim";
        const boType = validBo.includes(st.boType as string) ? (st.boType as StageConfig["boType"]) : "BO1";
        const teamCount = Math.min(128, Math.max(2, Number(st.teamCount) || 8));
        const groupCount = st.groupCount !== undefined && Number.isFinite(Number(st.groupCount)) ? Math.min(16, Math.max(1, Math.round(Number(st.groupCount)))) : undefined;
        return {
          name: text(st.name, 20) || "阶段",
          type,
          teamCount,
          boType,
          ...(groupCount !== undefined ? { groupCount } : {}),
        };
      })
      .slice(0, 10);

    // 策划案信息（三步向导第三步）
    const proposalRaw = (typeof input.proposal === "object" && input.proposal !== null ? input.proposal : {}) as Record<string, unknown>;
    const proposal = {
      background: text(proposalRaw.background, 800),
      purpose: text(proposalRaw.purpose, 800),
      budget: text(proposalRaw.budget, 800),
      prizes: text(proposalRaw.prizes, 800),
      leader: text(proposalRaw.leader, 40),
      contact: text(proposalRaw.contact, 80),
    };

    const config = await getSiteConfig();
    const eventId = `event-${Date.now().toString(36)}`;
    const newEvent = buildEventFromTemplate({
      id: eventId,
      name,
      game: typeof input.game === "string" ? input.game : "无畏契约",
      organizer,
      templateId: "val-16gsl-8de",
      stageConfigs,
      registrationStart: typeof input.registrationStart === "string" ? input.registrationStart : "",
      registrationEnd: typeof input.registrationEnd === "string" ? input.registrationEnd : "",
      eventDateLabel: typeof input.eventDateLabel === "string" ? input.eventDateLabel : undefined,
      coverColor: typeof input.coverColor === "string" ? input.coverColor : "#ff4655",
    });
    // 策划案信息写入赛事对象
    newEvent.proposal = proposal;

    const saved = await saveSiteConfig({
      ...config,
      events: [...config.events, newEvent],
      currentEventId: eventId,
    });

    return Response.json({ message: "赛事创建成功", event: saved.events.find((e) => e.id === eventId) });
  } catch {
    return Response.json({ message: "创建失败，请稍后重试" }, { status: 400 });
  }
}
