import {
  buildDoubleEliminationMatches,
  buildQualificationMatches,
  buildSingleEliminationMatches,
  buildTournamentMatches,
} from "./bracket-engine";
import type { Group, Matchup } from "./format-data";
import { resolveSupportedFormat } from "./format-support";
import type { StageConfig } from "./format-templates";
import type { ScheduleMatch } from "./schedule-data";

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

  if (format.kind === "staged-32-gsl-double-elim") {
    const [qualification, groups] = format.stages;
    return buildQualificationMatches(slotIds(qualification.teamCount), placeholderName, {
      phase: qualification.name,
      boType: qualification.boType,
      advancingTeams: groups.teamCount,
    });
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

  const { groups, matchups } = gslBlueprint();
  return buildTournamentMatches(groups, matchups, placeholderName, {
    groupBoType: format.groupStage.boType,
    knockoutBoType: format.knockoutStage.boType,
  });
}

function expectedStageMatches(stages: StageConfig[], stageIndex: number): number | null {
  const stage = stages[stageIndex];
  if (!stage) return null;
  if (stage.type === "single-elim") {
    const nextStage = stages[stageIndex + 1];
    return nextStage ? stage.teamCount - nextStage.teamCount : stage.teamCount - 1;
  }
  if (stage.type === "gsl-groups") return (stage.groupCount ?? 0) * 5;
  if (stage.type === "double-elim" && stage.teamCount === 8) return 14;
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
    if (expected !== null && phaseMatches.length !== expected) {
      return `${stage.name}按当前赛制应有 ${expected} 场，现有数据为 ${phaseMatches.length} 场。`;
    }
    if (phaseMatches.some((match) => match.boType !== stage.boType && !["败者组决赛", "总决赛"].includes(match.round ?? ""))) {
      return `${stage.name}的比赛局制与当前赛事配置不一致。`;
    }
  }

  return null;
}
