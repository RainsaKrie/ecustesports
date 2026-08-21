// =====================
// 赛事管理接口（管理员）
// POST /api/admin/events        新建比赛（按赛制模板实例化）
// PATCH /api/admin/events       更新单个赛事的后台可编辑配置
// POST /api/admin/events/switch 切换当前赛事
// =====================

import { getSiteConfig, updateSiteConfig } from "@/lib/site-config";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { buildEventFromTemplate, type StageConfig } from "@/lib/scheduling/format-templates";
import { writeEventData } from "@/lib/data-store";
import { initialRegistration } from "@/lib/scheduling/registration-data";
import { emptySchedule } from "@/lib/scheduling/schedule-data";
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
      teamRegistrationEnd: typeof input.teamRegistrationEnd === "string"
        ? input.teamRegistrationEnd
        : (typeof input.registrationEnd === "string" ? input.registrationEnd : ""),
      eventDateLabel: typeof input.eventDateLabel === "string" ? input.eventDateLabel : undefined,
      coverColor: typeof input.coverColor === "string" ? input.coverColor : "#ff4655",
    });
    // 策划案信息写入赛事对象
    newEvent.proposal = proposal;

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
  if (!isAdmin(request)) {
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
          return { title: text(rule.title, 60), detail: text(rule.detail, 500) };
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

    const nextEvent = {
      ...existing,
      name,
      game,
      organizer,
      status,
      teamCount: Math.min(128, Math.max(2, Math.round(Number(raw.teamCount) || existing.teamCount))),
      teamSize: Math.min(20, Math.max(1, Math.round(Number(raw.teamSize) || existing.teamSize))),
      registrationStart,
      registrationEnd,
      teamRegistrationEnd,
      eventDateLabel: text(raw.eventDateLabel, 80),
      registrationLabel: text(raw.registrationLabel, 60),
      stageSummary: text(raw.stageSummary, 160),
      description: text(raw.description, 500),
      prizePool: text(raw.prizePool, 240),
      coverColor: typeof raw.coverColor === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.coverColor)
        ? raw.coverColor
        : existing.coverColor,
      posterImage: typeof raw.posterImage === "string" && (raw.posterImage === "" || raw.posterImage.startsWith("/"))
        ? raw.posterImage.slice(0, 160)
        : existing.posterImage,
      rules,
      mapPool,
      preparationSteps,
    };

    const saved = await updateSiteConfig((latest) => ({
      ...latest,
      events: latest.events.map((event) => event.id === eventId ? nextEvent : event),
    }));
    return Response.json({
      message: "赛事设置已保存",
      event: saved.events.find((event) => event.id === eventId),
    });
  } catch {
    return Response.json({ message: "保存失败，请稍后重试" }, { status: 400 });
  }
}
