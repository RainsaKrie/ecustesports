import type { NextRequest } from "next/server";

import { isAdminRequest } from "@/lib/domains/identity/admin-session";
import { getSiteConfig, updateSiteConfig } from "@/lib/site-config";
import { getCommonRuleLibrary } from "@/lib/rule-library";
import { readEventData, updateEventData } from "@/lib/data-store";
import { recordOperationAuditSafely } from "@/lib/operation-audit";
import {
  buildEventFromTemplate,
  getFormatTemplate,
  type StageConfig,
} from "@/lib/domains/schedule/format-templates";
import { emptySchedule, normalizeScheduleState, type ScheduleState } from "@/lib/domains/schedule/schedule-data";
import { formatChangeRefusal, unplayedStagesToClear } from "@/lib/domains/schedule/format-support";
import { stampScheduleVersion } from "@/lib/domains/schedule/schedule-ops";
import type { StageType } from "@/lib/domains/schedule/format-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (!isAdminRequest(request)) {
    return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => null) as {
      eventId?: string;
      templateId?: string;
      /** 自定义赛段链（自由编排）。给了它就不再走模板 */
      stages?: Array<{ name?: string; type?: string; teamCount?: number; boType?: string; groupCount?: number }>;
    } | null;
    const eventId = body?.eventId?.trim() ?? "";
    const templateId = body?.templateId?.trim() ?? "";
    const customStages = Array.isArray(body?.stages) ? body.stages : null;
    if (!eventId || (!templateId && !customStages)) {
      return Response.json({ message: "缺少赛事或赛制" }, { status: 400 });
    }

    const template = templateId ? getFormatTemplate(templateId) : null;
    if (templateId && !template) return Response.json({ message: "赛制模板不存在" }, { status: 400 });

    const config = await getSiteConfig();
    const existing = config.events.find((event) => event.id === eventId);
    if (!existing) return Response.json({ message: "赛事不存在" }, { status: 404 });

    // 2026-10-14 放宽：原来只要赛程里有比赛就一律不许改，**比必要的严** ——
    // 它把「已经打完的阶段」和「还没生成对阵的阶段」当成一回事，
    // 于是「入围赛打完了、想把还没抽签的小组赛换个打法」这种安全改动也被挡住。
    // 现在按真正要守的两条判：已生成阶段的配置不变、它的晋级人数不变（见 formatChangeRefusal）。
    const schedule = await readEventData<ScheduleState>(eventId, "schedule", emptySchedule());

    // —— 自定义赛段链：只改赛段配置，不动赛事的文案与规则（那些仍来自赛事当前模板）——
    if (customStages) {
      const STAGE_TYPES = ["single-elim", "double-elim", "gsl-groups", "single-elim-groups", "round-robin", "swiss"];
      const cleaned = customStages
        .map((stage) => ({
          name: (stage.name ?? "").trim().slice(0, 40) || "赛段",
          type: String(stage.type ?? "") as StageType,
          teamCount: Number(stage.teamCount ?? 0),
          boType: String(stage.boType ?? "BO3") as "BO1" | "BO3" | "BO5",
          ...(stage.groupCount ? { groupCount: Number(stage.groupCount) } : {}),
        }))
        .filter((stage) => STAGE_TYPES.includes(stage.type) && stage.teamCount > 0 && ["BO1", "BO3", "BO5"].includes(stage.boType));
      if (cleaned.length === 0) return Response.json({ message: "赛段配置不完整" }, { status: 400 });

      // 复用同一条护栏：已生成阶段的配置与晋级人数不许变
      const refusalCustom = formatChangeRefusal(existing.stageConfigs ?? [], cleaned, schedule.matches ?? []);
      if (refusalCustom) return Response.json({ message: refusalCustom }, { status: 400 });

      const clearedCustom = unplayedStagesToClear(existing.stageConfigs ?? [], cleaned, schedule.matches ?? []);
      await updateSiteConfig((config) => ({
        ...config,
        events: config.events.map((event) => (event.id === eventId ? { ...event, stageConfigs: cleaned } : event)),
      }));
      if (clearedCustom.length > 0) {
        // 清掉「抽完签但一场没打」的旧骨架，否则新赛制会被场次校验堵死
        await updateEventData<ScheduleState>(eventId, "schedule", emptySchedule(), (stored) => {
          const state = normalizeScheduleState(stored);
          // 写 schedule 必须递增版本 —— 否则版本护栏看不见这次改动（写入点清单也这么要求）
          return stampScheduleVersion(state, {
            ...state,
            matches: (state.matches ?? []).filter((match) => !clearedCustom.includes(match.phase)),
          });
        });
      }
      await recordOperationAuditSafely(request, {
        eventId,
        actorType: "admin",
        action: "event.format.custom",
        target: existing.name,
        metadata: { stages: cleaned.length },
      });
      return Response.json({ message: "赛制已保存", stageConfigs: cleaned });
    }

    const stageConfigs = toStageConfigs(template!.stages);
    const refusal = formatChangeRefusal(existing.stageConfigs ?? [], stageConfigs, schedule.matches ?? []);
    if (refusal) {
      return Response.json({ message: refusal }, { status: 400 });
    }

    /**
     * 换赛制之后要清掉的「未开打骨架」（2026-10-14 补）：
     * 已经抽完签、但一场没排期也没打的阶段，它的旧对阵是按旧赛制生成的 ——
     * 不清掉，抽签页会判「小组赛应有 12 场，当前赛程为 20 场」把新赛制堵死。
     * 只清「待排期且没有开赛时间」的，任何排过期的比赛都不会被碰。
     */
    const clearedPhases = unplayedStagesToClear(existing.stageConfigs ?? [], stageConfigs, schedule.matches ?? []);

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

    let clearedMatchCount = 0;
    if (clearedPhases.length > 0) {
      await updateEventData<ScheduleState>(eventId, "schedule", emptySchedule(), (raw) => {
        const before = normalizeScheduleState(raw);
        const kept = before.matches.filter((match) => !clearedPhases.includes(match.phase));
        clearedMatchCount = before.matches.length - kept.length;
        if (clearedMatchCount === 0) return before;
        // 赛程写入契约：改动赛程必须走统一递增入口，否则版本护栏看不见这次改动
        return stampScheduleVersion(before, { ...before, matches: kept });
      });
    }

    await recordOperationAuditSafely(request, {
      eventId,
      actorType: "admin",
      action: "event.format.updated",
      target: existing.name,
      metadata: {
        from: existing.teamCount,
        to: nextEvent.teamCount,
        // 留痕：这次换赛制顺手清掉了哪几个阶段、多少场（都是没排期没打的骨架）
        clearedPhases: clearedPhases.join("、") || "无",
        clearedMatchCount,
      },
    });

    return Response.json({
      message: clearedMatchCount > 0
        ? `赛制已调整为 ${template!.name}；同时清除了 ${clearedPhases.join("、")} 的 ${clearedMatchCount} 场未排期对阵，请到抽签页重新生成`
        : `赛制已调整为 ${template!.name}`,
      clearedPhases,
      clearedMatchCount,
      event: saved.events.find((event) => event.id === eventId),
    });
  } catch {
    return Response.json({ message: "赛制调整失败，请稍后重试" }, { status: 400 });
  }
}
