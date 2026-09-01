import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getSiteConfig, updateSiteConfig } from "@/lib/site-config";
import { getCommonRuleLibrary } from "@/lib/rule-library";
import { readEventData } from "@/lib/data-store";
import { recordOperationAuditSafely } from "@/lib/operation-audit";
import {
  buildEventFromTemplate,
  getFormatTemplate,
  type StageConfig,
} from "@/lib/scheduling/format-templates";
import { emptySchedule, type ScheduleState } from "@/lib/scheduling/schedule-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdmin(request: NextRequest): boolean {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

function toStageConfigs(templateStages: Array<{
  name: string; type: StageConfig["type"]; teamCount: number; groupCount?: number; boType: StageConfig["boType"];
}>): StageConfig[] {
  return templateStages.map((stage) => ({
    name: stage.name,
    type: stage.type,
    teamCount: stage.teamCount,
    boType: stage.boType,
    ...(stage.groupCount !== undefined ? { groupCount: stage.groupCount } : {}),
  }));
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => null) as { eventId?: string; templateId?: string } | null;
    const eventId = body?.eventId?.trim() ?? "";
    const templateId = body?.templateId?.trim() ?? "";
    if (!eventId || !templateId) {
      return Response.json({ message: "缺少赛事或赛制" }, { status: 400 });
    }

    const template = getFormatTemplate(templateId);
    if (!template) return Response.json({ message: "赛制模板不存在" }, { status: 400 });

    const config = await getSiteConfig();
    const existing = config.events.find((event) => event.id === eventId);
    if (!existing) return Response.json({ message: "赛事不存在" }, { status: 404 });

    // 只允许在尚未生成赛程、尚未发布任何阶段时调整赛制。
    const schedule = await readEventData<ScheduleState>(eventId, "schedule", emptySchedule());
    if ((schedule.matches?.length ?? 0) > 0) {
      return Response.json({ message: "已生成赛程，不能再调整赛制。如需变更请先重置赛程。" }, { status: 400 });
    }

    const stageConfigs = toStageConfigs(template.stages);
    const commonRules = await getCommonRuleLibrary();
    const rebuilt = buildEventFromTemplate({
      id: existing.id,
      name: existing.name,
      game: existing.game,
      organizer: existing.organizer,
      templateId,
      stageConfigs,
      registrationStart: existing.registrationStart,
      registrationEnd: existing.registrationEnd,
      teamRegistrationEnd: existing.teamRegistrationEnd,
      commonRules,
    });

    const nextEvent = {
      ...existing,
      teamCount: rebuilt.teamCount,
      teamSize: rebuilt.teamSize,
      stageSummary: rebuilt.stageSummary,
      rules: rebuilt.rules,
      formatTemplateId: rebuilt.formatTemplateId,
      stageConfigs: rebuilt.stageConfigs,
    };

    const saved = await updateSiteConfig((latest) => ({
      ...latest,
      events: latest.events.map((event) => event.id === eventId ? nextEvent : event),
    }));

    await recordOperationAuditSafely(request, {
      eventId,
      actorType: "admin",
      action: "event.format.updated",
      target: existing.name,
      metadata: { from: existing.teamCount, to: nextEvent.teamCount },
    });

    return Response.json({
      message: `赛制已调整为 ${template.name}`,
      event: saved.events.find((event) => event.id === eventId),
    });
  } catch {
    return Response.json({ message: "赛制调整失败，请稍后重试" }, { status: 400 });
  }
}
