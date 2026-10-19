// =====================
// 赛事管理接口（管理员）
// POST /api/admin/events        新建比赛（按赛制模板实例化）
// PATCH /api/admin/events       更新单个赛事的后台可编辑配置
// DELETE /api/admin/events      永久删除已撤回的筹备/归档赛事及其独立数据
// POST /api/admin/events/switch 切换当前赛事
// =====================

import { getSiteConfig, updateSiteConfig } from "@/lib/site-config";
import { isAdminRequest } from "@/lib/domains/identity/admin-session";
import { buildEventFromTemplate, resolveTemplateIdFromStages, type StageConfig } from "@/lib/domains/schedule/format-templates";
import { resolveSupportedFormat } from "@/lib/domains/schedule/format-support";
import { deleteEventData, readEventData, writeEventData } from "@/lib/data-store";
import { initialRegistration } from "@/lib/domains/registration/data";
import { getGameConfig } from "@/lib/games";
import { emptySchedule, type ScheduleState } from "@/lib/domains/schedule/schedule-data";
import { eventDescriptionIssue } from "@/lib/domains/content/limits";
import { canPublish, publicationChecklist } from "@/lib/domains/content/publication-check";
import { getCommonRuleLibrary } from "@/lib/rule-library";
import { recordOperationAuditSafely } from "@/lib/operation-audit";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(v: unknown, max = 500): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
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

    // 赛制阶段配置（新建赛事第二步的产物）
    const rawStages = Array.isArray(input.stageConfigs) ? input.stageConfigs : [];
    // 白名单漏一种，存进去的类型会被改写成兜底值 —— 新增阶段类型时这里必须同步（共三处同源清单）。
    const validTypes = ["single-elim", "single-elim-groups", "gsl-groups", "double-elim", "round-robin", "swiss"];
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
    const formatSupport = resolveSupportedFormat(stageConfigs);
    if (formatSupport.kind === "unsupported") {
      return Response.json({ message: formatSupport.message }, { status: 400 });
    }

    const eventId = `event-${Date.now().toString(36)}`;
    const commonRules = await getCommonRuleLibrary();
    const newEvent = buildEventFromTemplate({
      id: eventId,
      name,
      game: typeof input.game === "string" ? input.game : getGameConfig().displayName,
      organizer,
      templateId: resolveTemplateIdFromStages(stageConfigs),
      stageConfigs,
      registrationStart: typeof input.registrationStart === "string" ? input.registrationStart : "",
      registrationEnd: typeof input.registrationEnd === "string" ? input.registrationEnd : "",
      teamRegistrationEnd: typeof input.teamRegistrationEnd === "string"
        ? input.teamRegistrationEnd
        : (typeof input.registrationEnd === "string" ? input.registrationEnd : ""),
      eventDateLabel: typeof input.eventDateLabel === "string" ? input.eventDateLabel : undefined,
      coverColor: typeof input.coverColor === "string" ? input.coverColor : "#ff4655",
      commonRules,
    });
    // 新赛事必须显式拥有空数据，不能从演示赛事或首页焦点赛事继承。
    await Promise.all([
      writeEventData(eventId, "registration", initialRegistration()),
      writeEventData(eventId, "schedule", emptySchedule()),
      writeEventData(eventId, "format", { seedPots: [], groups: [], matchups: [] }),
    ]);
    const saved = await updateSiteConfig((config) => ({
      ...config,
      events: [...config.events, newEvent],
    }));

    await recordOperationAuditSafely(request, {
      eventId,
      actorType: "admin",
      action: "event.created",
      target: newEvent.name,
      metadata: { teamCount: newEvent.teamCount, stageCount: newEvent.stageConfigs.length },
    });

    return Response.json({ message: "赛事创建成功", event: saved.events.find((e) => e.id === eventId) });
  } catch {
    return Response.json({ message: "创建失败，请稍后重试" }, { status: 400 });
  }
}

const EVENT_STATUSES = ["draft", "registration", "ongoing", "completed", "archived"] as const;

function dateText(value: unknown): string | null {
  if (value === "") return "";
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function PATCH(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const eventId = text(input.eventId, 60);
    const raw = (typeof input.event === "object" && input.event !== null ? input.event : {}) as Record<string, unknown>;
    const config = await getSiteConfig();
    const existing = config.events.find((event) => event.id === eventId);
    if (!existing) {
      return Response.json({ message: "赛事不存在" }, { status: 404 });
    }

    const name = text(raw.name, 80);
    const game = text(raw.game, 40);
    const organizer = text(raw.organizer, 80);
    if (!name || !game || !organizer) {
      return Response.json({ message: "赛事名称、游戏和主办方不能为空" }, { status: 400 });
    }

    const registrationStart = dateText(raw.registrationStart);
    const registrationEnd = dateText(raw.registrationEnd);
    const teamRegistrationEnd = dateText(raw.teamRegistrationEnd);
    if (registrationStart === null || registrationEnd === null || teamRegistrationEnd === null) {
      return Response.json({ message: "报名日期格式不正确" }, { status: 400 });
    }
    if (registrationStart && registrationEnd && registrationStart > registrationEnd) {
      return Response.json({ message: "选手报名截止日期不能早于报名开始日期" }, { status: 400 });
    }
    if (registrationEnd && teamRegistrationEnd && registrationEnd > teamRegistrationEnd) {
      return Response.json({ message: "队伍申报截止日期不能早于选手报名截止日期" }, { status: 400 });
    }

    const status = EVENT_STATUSES.includes(raw.status as (typeof EVENT_STATUSES)[number])
      ? (raw.status as (typeof EVENT_STATUSES)[number])
      : existing.status;
    const rules = Array.isArray(raw.rules)
      ? raw.rules.slice(0, 30).map((item) => {
          const rule = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
          const categoryValues = ["format", "match-day", "conduct", "incident", "appeal"] as const;
          const emphasisValues = ["normal", "important", "warning"] as const;
          const sourceValues = ["common", "format", "event"] as const;
          return {
            title: text(rule.title, 60),
            detail: text(rule.detail, 500),
            category: categoryValues.includes(rule.category as (typeof categoryValues)[number])
              ? rule.category as (typeof categoryValues)[number]
              : "conduct" as const,
            emphasis: emphasisValues.includes(rule.emphasis as (typeof emphasisValues)[number])
              ? rule.emphasis as (typeof emphasisValues)[number]
              : "normal" as const,
            source: sourceValues.includes(rule.source as (typeof sourceValues)[number])
              ? rule.source as (typeof sourceValues)[number]
              : "event" as const,
            customized: rule.customized === true,
            confirmed: rule.confirmed !== false,
          };
        }).filter((rule) => rule.title && rule.detail)
      : existing.rules;
    const preparationSteps = Array.isArray(raw.preparationSteps)
      ? raw.preparationSteps.slice(0, 10).map((item, index) => {
          const step = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
          return {
            number: text(step.number, 8) || String(index + 1).padStart(2, "0"),
            title: text(step.title, 50),
            detail: text(step.detail, 240),
          };
        }).filter((step) => step.title && step.detail)
      : existing.preparationSteps;
    const mapPool = Array.isArray(raw.mapPool)
      ? raw.mapPool.slice(0, 20).map((item) => {
          const map = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
          return { id: text(map.id, 40), name: text(map.name, 40) };
        }).filter((map, index, maps) => map.id && map.name && maps.findIndex((candidate) => candidate.id === map.id) === index)
      : existing.mapPool;
    if (rules.length === 0 || mapPool.length === 0) {
      return Response.json({ message: "至少保留一条规则和一张地图" }, { status: 400 });
    }

    // 简介字数与「官网内容」共用同一套规则（site-content-limits）。
    // 此前这里只截断到 500、没有下限，于是能存下 5 个字，
    // 而「官网内容」保存时会连带提交简介、被它自己的 10–280 校验拦下，
    // 报错指向的还是另一个字段。
    const description = text(raw.description, 500);
    const descriptionIssue = eventDescriptionIssue(description);
    if (descriptionIssue) {
      return Response.json({ message: descriptionIssue.message }, { status: 400 });
    }

    const nextEvent = {
      ...existing,
      name,
      game,
      organizer,
      status,
      visibility: existing.visibility,
      publishedAt: existing.publishedAt,
      teamCount: Math.min(128, Math.max(2, Math.round(Number(raw.teamCount) || existing.teamCount))),
      teamSize: Math.min(20, Math.max(1, Math.round(Number(raw.teamSize) || existing.teamSize))),
      registrationStart,
      registrationEnd,
      teamRegistrationEnd,
      eventDateLabel: text(raw.eventDateLabel, 80),
      registrationLabel: text(raw.registrationLabel, 60),
      stageSummary: text(raw.stageSummary, 160),
      // 排期模式：只认这两个字面量；本次没提交这个字段时保留原值
      // （否则表单里没带的字段会被静默重置 —— 这正是「存了又变回去」那类坑）
      scheduleMode: (raw.scheduleMode === "fixed"
        ? "fixed"
        : raw.scheduleMode === "open" ? "open" : existing.scheduleMode) as "open" | "fixed",
      description,
      prizePool: text(raw.prizePool, 240),
      coverColor: typeof raw.coverColor === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.coverColor)
        ? raw.coverColor
        : existing.coverColor,
      posterImage: typeof raw.posterImage === "string" && (
        raw.posterImage === ""
        || raw.posterImage.startsWith("/")
        || /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/event-assets\//i.test(raw.posterImage)
      )
        ? raw.posterImage.slice(0, 500)
        : existing.posterImage,
      rules,
      mapPool,
      preparationSteps,
      eventQqGroup: (() => {
        const rawQq = typeof raw.eventQqGroup === "string" ? raw.eventQqGroup.trim() : "";
        // 只保留数字，5–20 位视为合法群号，否则落空（空表示未设置或清空）。
        const digits = rawQq.replace(/\D/g, "").slice(0, 20);
        return digits.length >= 5 ? digits : "";
      })(),
    };

    // 已公开赛事的普通设置保存也必须保持可发布状态，避免绕过发布检查。
    if (existing.visibility === "public") {
      const failedChecks = publicationChecklist(nextEvent).filter((item) => !item.ok);
      if (!canPublish(nextEvent)) {
        return Response.json({
          message: `保存后将不再满足公开条件：${failedChecks.map((item) => item.label).join("、")}`,
        }, { status: 400 });
      }
      if (nextEvent.status === "ongoing") {
        const schedule = await readEventData<ScheduleState>(eventId, "schedule", emptySchedule());
        if (schedule.matches.length === 0) {
          return Response.json({ message: "比赛中赛事必须先生成赛程，才能继续公开" }, { status: 400 });
        }
      }
    }

    const saved = await updateSiteConfig((latest) => ({
      ...latest,
      events: latest.events.map((event) => event.id === eventId ? nextEvent : event),
    }));
    await recordOperationAuditSafely(request, {
      eventId,
      actorType: "admin",
      action: "event.settings.updated",
      target: nextEvent.name,
    });
    return Response.json({
      message: "赛事设置已保存",
      event: saved.events.find((event) => event.id === eventId),
    });
  } catch {
    return Response.json({ message: "保存失败，请稍后重试" }, { status: 400 });
  }
}

class EventDeleteError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const eventId = text(input.eventId, 60);
    const confirmName = text(input.confirmName, 80);
    if (!eventId || !confirmName) {
      throw new EventDeleteError("请输入完整赛事名称确认删除", 400);
    }

    const saved = await updateSiteConfig((latest) => {
      const target = latest.events.find((event) => event.id === eventId);
      if (!target) throw new EventDeleteError("赛事不存在或已被删除", 404);
      if (target.visibility === "public") {
        throw new EventDeleteError("请先从玩家侧撤回赛事，再执行永久删除", 409);
      }
      if (target.status !== "draft" && target.status !== "archived") {
        throw new EventDeleteError("只有筹备中或已归档的赛事可以永久删除", 409);
      }
      if (confirmName !== target.name) {
        throw new EventDeleteError("输入的赛事名称不一致", 400);
      }
      if (latest.events.length <= 1) {
        throw new EventDeleteError("系统至少需要保留一场赛事，请先新建赛事再删除", 409);
      }

      const remaining = latest.events.filter((event) => event.id !== eventId);
      return {
        ...latest,
        events: remaining,
        archives: latest.archives.filter((archive) => archive.id !== eventId),
        currentEventId: latest.currentEventId === eventId ? remaining[0].id : latest.currentEventId,
      };
    });

    try {
      await deleteEventData(eventId);
    } catch (error) {
      console.error("赛事目录清理失败", error);
      await recordOperationAuditSafely(request, {
        eventId,
        actorType: "admin",
        action: "event.deleted.cleanup-pending",
        target: confirmName,
      });
      return Response.json({
        message: "赛事已从列表删除，但数据目录清理失败",
        deleted: true,
        currentEventId: saved.currentEventId,
        cleanupPending: true,
      });
    }

    await recordOperationAuditSafely(request, {
      eventId,
      actorType: "admin",
      action: "event.deleted",
      target: confirmName,
    });

    return Response.json({
      message: "赛事及其独立数据已永久删除",
      deleted: true,
      currentEventId: saved.currentEventId,
    });
  } catch (error) {
    if (error instanceof EventDeleteError) {
      return Response.json({ message: error.message }, { status: error.status });
    }
    return Response.json({ message: "删除失败，请稍后重试" }, { status: 400 });
  }
}
