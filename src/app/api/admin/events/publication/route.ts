import type { NextRequest } from "next/server";

import { isAdminRequest } from "@/lib/domains/identity/admin-session";
import { readEventData } from "@/lib/data-store";
import { canPublish, publicationChecklist } from "@/lib/domains/content/publication-check";
import { getSiteConfig, updateSiteConfig } from "@/lib/site-config";
import { emptySchedule, type ScheduleState } from "@/lib/scheduling/schedule-data";
import { recordOperationAuditSafely } from "@/lib/operation-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const eventId = typeof body.eventId === "string" ? body.eventId.trim().slice(0, 60) : "";
    const action = body.action === "publish" || body.action === "unpublish" ? body.action : "";
    const config = await getSiteConfig();
    const event = config.events.find((candidate) => candidate.id === eventId);
    if (!event) return Response.json({ message: "赛事不存在" }, { status: 404 });
    if (!action) return Response.json({ message: "发布操作不合法" }, { status: 400 });

    const checklist = publicationChecklist(event);
    if (action === "publish" && !canPublish(event)) {
      return Response.json({ message: "公开前仍有必填内容未完成", checklist }, { status: 400 });
    }
    if (action === "publish" && event.status === "ongoing") {
      const schedule = await readEventData<ScheduleState>(event.id, "schedule", emptySchedule());
      if (schedule.matches.length === 0) {
        return Response.json({ message: "比赛中赛事必须先生成赛程，才能公开。", checklist }, { status: 400 });
      }
    }

    const visibility = action === "publish" ? "public" as const : "private" as const;
    const saved = await updateSiteConfig((latest) => ({
      ...latest,
      events: latest.events.map((candidate) => candidate.id === event.id ? {
        ...candidate,
        visibility,
        publishedAt: visibility === "public" ? (candidate.publishedAt ?? new Date().toISOString()) : candidate.publishedAt,
      } : candidate),
    }));
    await recordOperationAuditSafely(request, {
      eventId: event.id,
      actorType: "admin",
      action: visibility === "public" ? "event.published" : "event.unpublished",
      target: event.name,
    });
    return Response.json({
      message: visibility === "public" ? "赛事已发布到玩家侧" : "赛事已从玩家侧撤回",
      event: saved.events.find((candidate) => candidate.id === event.id),
      checklist,
    });
  } catch {
    return Response.json({ message: "发布状态更新失败，请稍后重试" }, { status: 400 });
  }
}
