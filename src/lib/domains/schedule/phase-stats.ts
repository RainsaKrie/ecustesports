// =====================
// 当前阶段与标题区数字（2026-10-21，审计 P3）
//
// 从 PublicSchedule.tsx 抽出来的纯计算。抽的原因和分组逻辑一样：
// 带 "use client" 的组件里，纯逻辑无法被 Node 测试覆盖，只能靠人眼看页面。
// =====================

import type { ScheduleMatch } from "@/lib/domains/schedule/schedule-data";

export type PhaseStats = {
  /** 所有出现过的阶段，按首次出现顺序 */
  allPhases: string[];
  /** 当前阶段：最后一个「还有未完赛场次」的阶段；全完成则取最后一个 */
  currentPhase: string;
  /** 当前阶段的场次 */
  currentMatches: ScheduleMatch[];
  /** 当前阶段已完成的场次 */
  currentDone: number;
  /** 下一个阶段（没有则 undefined） */
  nextPhase: string | undefined;
  /** 下一阶段的队伍数（没有下一阶段则 0） */
  nextTeams: number;
};

const distinctTeams = (list: ScheduleMatch[]): number =>
  new Set(list.flatMap((m) => [m.teamAId, m.teamBId]).filter(Boolean)).size;

export function currentPhaseStats(matches: ScheduleMatch[]): PhaseStats {
  const allPhases = Array.from(new Set(matches.map((m) => m.phase)));
  const currentPhase =
    [...allPhases]
      .reverse()
      .find((phase) => matches.some((m) => m.phase === phase && m.status !== "已完成")) ??
    allPhases[allPhases.length - 1] ??
    "";
  const currentMatches = matches.filter((m) => m.phase === currentPhase);
  const currentDone = currentMatches.filter((m) => m.status === "已完成").length;
  const nextPhase = allPhases[allPhases.indexOf(currentPhase) + 1];
  const nextTeams = nextPhase ? distinctTeams(matches.filter((m) => m.phase === nextPhase)) : 0;

  return { allPhases, currentPhase, currentMatches, currentDone, nextPhase, nextTeams };
}
