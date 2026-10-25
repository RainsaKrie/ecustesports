import {
  buildDoubleEliminationMatches,
  buildQualificationMatches,
  buildSingleEliminationMatches,
  buildRoundRobinMatches,
  buildSwissMatches,
  buildTournamentMatches,
} from "./bracket-engine.ts";
import type { Group, Matchup } from "@/lib/domains/registration/format";
import { DOUBLE_ELIM_BO } from "./bracket-engine.ts";
import { resolveSupportedFormat } from "./format-support.ts";
import type { StageConfig } from "./format-templates.ts";
import type { ScheduleMatch } from "./schedule-data.ts";

function slotIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `SLOT-${String(index + 1).padStart(2, "0")}`);
}

function placeholderName(): string {
  return "待抽签";
}

function gslBlueprint(): { groups: Group[]; matchups: Matchup[] } {
  const ids = slotIds(16);
  const groups = ["A 组", "B 组", "C 组", "D 组"].map((name, groupIndex) => ({
    name,
    teamIds: [ids[groupIndex], ids[groupIndex + 4], ids[groupIndex + 8], ids[groupIndex + 12]],
  }));
  const matchups = groups.flatMap((group) => [
    { teamAId: group.teamIds[0], teamBId: group.teamIds[3], group: group.name },
    { teamAId: group.teamIds[1], teamBId: group.teamIds[2], group: group.name },
  ]);
  return { groups, matchups };
}

/** 根据已确认赛制生成只读空骨架；正式比赛仍只能由抽签发布写入赛程。 */
export function buildBracketBlueprint(stages: StageConfig[]): ScheduleMatch[] {
  const format = resolveSupportedFormat(stages);
  if (format.kind === "unsupported") return [];

  if (format.kind === "staged-playin") {
    // 空骨架展示第一阶段（资格赛）：8 队 → 4 场，胜者并入入围赛。
    return buildQualificationMatches(slotIds(format.playInStage.teamCount), placeholderName, {
      phase: format.playInStage.name,
      boType: format.playInStage.boType,
      advancingTeams: format.playInStage.teamCount / 2,
    }).matches;
  }

  if (format.kind === "staged-32-gsl-double-elim") {
    const [qualification, groups] = format.stages;
    return buildQualificationMatches(slotIds(qualification.teamCount), placeholderName, {
      phase: qualification.name,
      boType: qualification.boType,
      advancingTeams: groups.teamCount,
    }).matches;
  }

  if (format.kind === "slot-draw") {
    const ids = slotIds(format.requiredTeams);
    return format.bracket === "single-elim"
      ? buildSingleEliminationMatches(ids, placeholderName, {
          phase: format.stage.name,
          boType: format.stage.boType,
        })
      : buildDoubleEliminationMatches(ids, placeholderName, {
          phase: format.stage.name,
          boType: format.stage.boType,
        });
  }

  // 单段瑞士轮 / 循环赛（2026-10-19 接入）：不走分组抽签盘
  if (format.kind === "swiss") {
    return buildSwissMatches(slotIds(format.requiredTeams), placeholderName, {
      phase: format.stage.name,
      boType: format.stage.boType,
    });
  }
  if (format.kind === "round-robin") {
    return buildRoundRobinMatches(slotIds(format.requiredTeams), placeholderName, {
      phase: format.stage.name,
      boType: format.stage.boType,
    });
  }

  const { groups, matchups } = gslBlueprint();
  return buildTournamentMatches(groups, matchups, placeholderName, {
    groupBoType: format.groupStage.boType,
    knockoutBoType: format.knockoutStage.boType,
  });
}

const DEFAULT_GROUP_COUNT = 4;

export function expectedStageMatches(stages: StageConfig[], stageIndex: number): number | null {
  const stage = stages[stageIndex];
  if (!stage) return null;
  if (stage.type === "single-elim") {
    const nextStage = stages[stageIndex + 1];
    if (!nextStage) return stage.teamCount - 1;
    // 并入型阶段（资格赛）：下一阶段比本阶段大，说明本阶段的胜者是「并入」而非「成为」下一阶段。
    // 此时场次 = 本阶段队伍数的一半（如 8 队 → 4 场，4 支胜者并入 32 队入围赛）。
    if (nextStage.teamCount > stage.teamCount) return stage.teamCount / 2;
    return stage.teamCount - nextStage.teamCount;
  }
  // 缺省组数与 `staged-format.ts` 保持一致（原来这里 `?? 0` 会算成 0 场，
  // 而门控那边用 `?? 4` 算成 20 场 —— 同一阶段两处提示互相矛盾）。
  if (stage.type === "gsl-groups") return (stage.groupCount ?? DEFAULT_GROUP_COUNT) * 5;
  if (stage.type === "single-elim-groups") {
    const groups = stage.groupCount ?? DEFAULT_GROUP_COUNT;
    const perGroup = Math.max(2, Math.floor(stage.teamCount / groups));
    return groups * (perGroup - 1);
  }
  // 双败场次通用公式：胜者组 (n-1) + 败者组 (n-2) + 总决赛 1 = 2n-2。
  // 8 队 = 14（与现有对阵结构一致）；原来只写死 8 队，16 队会返回 null 等于不校验。
  if (stage.type === "double-elim") return Math.max(0, 2 * stage.teamCount - 2);
  return null;
}

/** 返回无法构成真实对阵图的原因；空赛程由骨架负责展示，不视为错误。 */
export function bracketDataIssue(matches: ScheduleMatch[], stages: StageConfig[]): string | null {
  if (matches.length === 0) return null;
  if (matches.some((match) => !match.round)) {
    return "现有赛程缺少轮次与晋级关系，属于旧版列表数据，无法构成对阵图。";
  }

  for (const [stageIndex, stage] of stages.entries()) {
    const phaseMatches = matches.filter((match) => match.phase === stage.name);
    if (phaseMatches.length === 0) continue;
    const expected = expectedStageMatches(stages, stageIndex);
    // `expected` 是"完整打完"的场次数。**实际少于它不算错误** ——
    // 赛事中途取消某轮（例如取消小组决赛、直接进淘汰赛）是合法运营动作；
    // 赛制模型（单败：每组 teamCount-1 场）表达不出"少打一场"，
    // 所以这里只在**多于**预期时才判错（多出来通常是换了赛制却没清旧数据）。
    if (expected !== null && phaseMatches.length > expected) {
      return `${stage.name}按当前赛制最多 ${expected} 场，现有数据为 ${phaseMatches.length} 场，请检查是否混入了旧赛制数据。`;
    }
    // 局制：配置 boByRound > 双败固定约定 > 阶段 boType（原来是"例外名单"，漏一项就吞掉整块图）
    const boByRound: Record<string, string> = stage.boByRound ?? (stage.type === "double-elim" ? DOUBLE_ELIM_BO : {});
    const boOf = (round: string | undefined) => boByRound[round ?? ""] ?? stage.boType;
    if (phaseMatches.some((match) => match.boType !== boOf(match.round))) {
      return `${stage.name}的比赛局制与当前赛事配置不一致。`;
    }
  }

  return null;
}
