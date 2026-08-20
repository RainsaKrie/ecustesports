// =====================
// 对阵与赛程构建（纯函数，可测试）
// 小组赛（4 组 × 首轮 + 次轮）→ 8 队双败淘汰（胜者/败者两条晋级路径）
// 对齐 docs 决策：小组第一对阵其他小组第二、同组出线分入不同半区、
// 败者组决赛与总决赛 BO5、总决赛不重置
// =====================

import type { Group, Matchup } from "./format-data";
import type { ScheduleMatch } from "./schedule-data";

/** 待定占位（晋级推进后由真实队伍填充） */
export const TBD = "TBD";

interface Slot {
  id: string;
  side: "A" | "B";
}

function slot(id: string, side: "A" | "B"): Slot {
  return { id, side };
}

/**
 * 生成完整比赛结构：小组赛首轮 8 场 + 次轮 4 场 + 8 队双败淘汰 14 场 = 26 场。
 * 返回的比赛均为「待排期」，队伍未知的场次以 TBD 占位，由晋级推进逐步填充。
 */
export function buildTournamentMatches(
  groups: Group[],
  matchups: Matchup[],
  teamName: (id: string) => string,
): ScheduleMatch[] {
  const matches: ScheduleMatch[] = [];
  const mk = (
    id: string,
    phase: string,
    round: string,
    boType: ScheduleMatch["boType"],
    extra: Partial<ScheduleMatch> = {},
  ): ScheduleMatch => ({
    id,
    phase,
    round,
    boType,
    teamAId: TBD,
    teamBId: TBD,
    teamAName: "待定",
    teamBName: "待定",
    startTime: "",
    endTime: "",
    status: "待排期",
    frozen: false,
    ...extra,
  });

  // ---- 小组赛首轮：每组 2 场（1 号池 vs 4 号池、2 号池 vs 3 号池） ----
  const firstRoundIds: string[] = [];
  matchups.forEach((m, i) => {
    const groupIndex = Math.floor(i / 2);
    const id = `M${String(i + 1).padStart(2, "0")}`;
    firstRoundIds.push(id);
    matches.push(
      mk(id, "小组赛", `${m.group} 首轮`, "BO3", {
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        teamAName: teamName(m.teamAId),
        teamBName: teamName(m.teamBId),
        nextMatchId: `M${String(9 + groupIndex).padStart(2, "0")}`,
        nextSide: i % 2 === 0 ? "A" : "B",
      }),
    );
  });

  // ---- 小组赛次轮：各组首轮胜者对阵（M09~M12），胜者为小组第一、败者为小组第二 ----
  const secondRoundIds = ["M09", "M10", "M11", "M12"];
  secondRoundIds.forEach((id, groupIndex) => {
    matches.push(mk(id, "小组赛", `${groups[groupIndex]?.name ?? `${groupIndex + 1} 组`} 次轮`, "BO3"));
  });

  // ---- 淘汰赛：8 队双败（M13~M26） ----
  // W1：小组第一对阵其他小组第二（胜者组首轮）
  const W1A = "M13", W1B = "M14", W1C = "M15", W1D = "M16"; // 胜者组首轮
  const W2A = "M17", W2B = "M18"; // 胜者组半决赛
  const L1A = "M19", L1B = "M20"; // 败者组第一轮
  const L2A = "M21", L2B = "M22"; // 败者组第二轮
  const WF = "M23"; // 胜者组决赛
  const L3 = "M24"; // 败者组第三轮
  const LF = "M25"; // 败者组决赛（BO5）
  const GF = "M26"; // 总决赛（BO5，不重置）

  const knockoutDefs: Array<[string, string, ScheduleMatch["boType"]]> = [
    [W1A, "八强赛", "BO3"],
    [W1B, "八强赛", "BO3"],
    [W1C, "八强赛", "BO3"],
    [W1D, "八强赛", "BO3"],
    [W2A, "胜者组半决赛", "BO3"],
    [W2B, "胜者组半决赛", "BO3"],
    [L1A, "败者组第一轮", "BO3"],
    [L1B, "败者组第一轮", "BO3"],
    [L2A, "败者组第二轮", "BO3"],
    [L2B, "败者组第二轮", "BO3"],
    [WF, "胜者组决赛", "BO3"],
    [L3, "败者组第三轮", "BO3"],
    [LF, "败者组决赛", "BO5"],
    [GF, "总决赛", "BO5"],
  ];
  const koMap = new Map<string, ScheduleMatch>();
  knockoutDefs.forEach(([id, round, boType]) => {
    const m = mk(id, "淘汰赛", round, boType);
    koMap.set(id, m);
    matches.push(m);
  });

  // 小组次轮 → 八强：小组第一进胜者组同侧，小组第二交叉进异组
  // M09(A组)：胜者 → M13.A（W_A）；败者(R_A) → M15.B
  // M10(B组)：胜者 → M14.A（W_B）；败者(R_B) → M16.B
  // M11(C组)：胜者 → M15.A（W_C）；败者(R_C) → M13.B
  // M12(D组)：胜者 → M16.A（W_D）；败者(R_D) → M14.B
  const groupExit: Array<{ matchId: string; winner: Slot; loser: Slot }> = [
    { matchId: "M09", winner: slot(W1A, "A"), loser: slot(W1C, "B") },
    { matchId: "M10", winner: slot(W1B, "A"), loser: slot(W1D, "B") },
    { matchId: "M11", winner: slot(W1C, "A"), loser: slot(W1A, "B") },
    { matchId: "M12", winner: slot(W1D, "A"), loser: slot(W1B, "B") },
  ];
  groupExit.forEach(({ matchId, winner, loser }) => {
    const m = matches.find((x) => x.id === matchId);
    if (m) {
      m.nextMatchId = winner.id;
      m.nextSide = winner.side;
      m.nextLoserMatchId = loser.id;
      m.nextLoserSide = loser.side;
    }
  });

  // 八强 → 胜者组半决赛 / 败者组第一轮
  const w1Exit: Array<{ matchId: string; winner: Slot; loser: Slot; prereq: string }> = [
    { matchId: W1A, winner: slot(W2A, "A"), loser: slot(L1A, "A"), prereq: "M09" },
    { matchId: W1B, winner: slot(W2A, "B"), loser: slot(L1A, "B"), prereq: "M10" },
    { matchId: W1C, winner: slot(W2B, "A"), loser: slot(L1B, "A"), prereq: "M11" },
    { matchId: W1D, winner: slot(W2B, "B"), loser: slot(L1B, "B"), prereq: "M12" },
  ];
  w1Exit.forEach(({ matchId, winner, loser, prereq }) => {
    const m = koMap.get(matchId);
    if (m) {
      m.nextMatchId = winner.id;
      m.nextSide = winner.side;
      m.nextLoserMatchId = loser.id;
      m.nextLoserSide = loser.side;
      m.prerequisiteId = prereq;
    }
  });

  // 胜者组半决赛 → 胜者组决赛 / 败者组第二轮
  koMap.get(W2A)!.nextMatchId = WF; koMap.get(W2A)!.nextSide = "A";
  koMap.get(W2A)!.nextLoserMatchId = L2A; koMap.get(W2A)!.nextLoserSide = "A";
  koMap.get(W2A)!.prerequisiteId = W1A;
  koMap.get(W2B)!.nextMatchId = WF; koMap.get(W2B)!.nextSide = "B";
  koMap.get(W2B)!.nextLoserMatchId = L2B; koMap.get(W2B)!.nextLoserSide = "A";
  koMap.get(W2B)!.prerequisiteId = W1C;

  // 败者组第一轮 → 败者组第二轮
  koMap.get(L1A)!.nextMatchId = L2A; koMap.get(L1A)!.nextSide = "B";
  koMap.get(L1A)!.prerequisiteId = W1A;
  koMap.get(L1B)!.nextMatchId = L2B; koMap.get(L1B)!.nextSide = "B";
  koMap.get(L1B)!.prerequisiteId = W1C;

  // 败者组第二轮 → 败者组第三轮
  koMap.get(L2A)!.nextMatchId = L3; koMap.get(L2A)!.nextSide = "A";
  koMap.get(L2A)!.prerequisiteId = W2A;
  koMap.get(L2B)!.nextMatchId = L3; koMap.get(L2B)!.nextSide = "B";
  koMap.get(L2B)!.prerequisiteId = W2B;

  // 胜者组决赛：胜者 → 总决赛 A；败者 → 败者组决赛 B
  koMap.get(WF)!.nextMatchId = GF; koMap.get(WF)!.nextSide = "A";
  koMap.get(WF)!.nextLoserMatchId = LF; koMap.get(WF)!.nextLoserSide = "B";
  koMap.get(WF)!.prerequisiteId = W2A;

  // 败者组第三轮 → 败者组决赛 A
  koMap.get(L3)!.nextMatchId = LF; koMap.get(L3)!.nextSide = "A";
  koMap.get(L3)!.prerequisiteId = L2A;

  // 败者组决赛 → 总决赛 B（总决赛不重置，无后续）
  koMap.get(LF)!.nextMatchId = GF; koMap.get(LF)!.nextSide = "B";
  koMap.get(LF)!.prerequisiteId = L3;
  koMap.get(GF)!.prerequisiteId = WF;

  // 小组赛次轮与首轮的前置关系（HC-05 校验用）
  secondRoundIds.forEach((id, groupIndex) => {
    const m = matches.find((x) => x.id === id);
    if (m) {
      m.prerequisiteId = firstRoundIds[groupIndex * 2];
    }
  });

  return matches;
}

/** 总决赛：无后续晋级，胜者即冠军 */
export function isChampionMatch(match: ScheduleMatch): boolean {
  return match.round === "总决赛";
}
