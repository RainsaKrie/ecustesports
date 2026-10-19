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
import { resolveSupportedFormat } from "@/lib/domains/schedule/format-support";
import { validateStageChain, type BoFormat } from "@/lib/domains/schedule/stage-chain-rules";
import { formatChangeRefusal, unplayedStagesToClear } from "@/lib/domains/schedule/format-support";
import { stampScheduleVersion } from "@/lib/domains/schedule/schedule-ops";

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
      // 类型有两个命名体系：库里存的是 format-templates 的名字（如 single-elim-groups），
      // 规则层用的是 stage-chain-rules 的名字（如 group-single-elim）。这里做**别名归一**，
      // 而不是用白名单过滤 —— 过滤会"静默丢段"（选组内循环，返回成功但少一段），必须报错。
      // 只允许抽签端能画的类型。瑞士轮引擎（swiss.ts）已就绪，但抽签端还没接，
      // 存进去就变成"能存不能抽" —— 所以在这里明确拒绝并说明，而不是静默丢段。
      const PERSISTED: Record<string, "single-elim" | "double-elim" | "gsl-groups" | "single-elim-groups" | "round-robin" | "swiss"> = {
        "single-elim": "single-elim",
        "double-elim": "double-elim",
        "gsl-groups": "gsl-groups",
        "group-single-elim": "single-elim-groups",
        "single-elim-groups": "single-elim-groups",
        "round-robin": "round-robin",
        "swiss": "swiss",
      };
      const RULE_KIND: Record<string, string> = {
        "single-elim": "single-elim",
        "double-elim": "double-elim",
        "gsl-groups": "gsl-groups",
        "single-elim-groups": "group-single-elim",
        "round-robin": "round-robin",
        "swiss": "swiss",
      };

      const unknown = customStages.find((stage) => !PERSISTED[String(stage.type ?? "")]);
      if (unknown) return Response.json({ message: `不认识的赛段类型：${String(unknown.type ?? "")}` }, { status: 400 });

      const cleaned = customStages.map((stage) => ({
        name: (stage.name ?? "").trim().slice(0, 40) || "赛段",
        type: PERSISTED[String(stage.type ?? "")],
        teamCount: Number(stage.teamCount ?? 0),
        boType: String(stage.boType ?? "BO3") as "BO1" | "BO3" | "BO5",
        ...(stage.groupCount ? { groupCount: Number(stage.groupCount) } : {}),
      }));
      if (cleaned.length === 0 || cleaned.some((stage) => !(stage.teamCount > 0))) {
        return Response.json({ message: "赛段配置不完整" }, { status: 400 });
      }

      // ① 规则校验（与编辑器**同一份实现**）：不成立就拒绝，并说清哪一段
      const chainResult = validateStageChain({
        entrants: cleaned[0].teamCount,
        stages: cleaned.map((stage, index) => ({
          name: stage.name,
          type: RULE_KIND[stage.type] as never,
          entrants: stage.teamCount,
          advance: cleaned[index + 1]?.teamCount ?? 1,
          bo: Number(stage.boType.replace("BO", "")) as BoFormat,
          ...(stage.groupCount ? { groups: stage.groupCount } : {}),
        })),
      });
      if (chainResult.problems.length > 0) {
        return Response.json({ message: chainResult.problems[0].message }, { status: 400 });
      }

      // ② 抽签端能不能画出这套组合：不能就别存（"能存不能抽"比不让存更糟）
      if (resolveSupportedFormat(cleaned).kind === "unsupported") {
        return Response.json({
          message: "这套赛段组合目前还不能自动生成对阵，存了也抽不出赛程。请改用已有结构，或等对应引擎接入。",
        }, { status: 400 });
      }

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
