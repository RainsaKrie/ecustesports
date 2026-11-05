// =====================
// 撤销赛果（2026-11-05）
//
// 为什么需要：比赛还没打，却被误标成「已完成 2:0」，胜者还填进了下一场。
// 平台原先**只能覆盖重报，不能退回未打** —— 一旦报错，对阵图就被带偏，
// 而且没有任何入口能纠正。
//
// 与「删除这场」分开：删除会把整场从赛程里抹掉（对阵结构就少了这个签位），
// 撤销只清比分与胜者，签位、排期、BP 都保留。
//
// 独立成文件而不是加进 schedule-ops.ts：那个文件已被架构守卫锁行，只许变短。
// =====================

import type { ScheduleMatch, ScheduleState } from "./schedule-data.ts";

export type RevertResultOutcome =
  | { ok: true; state: ScheduleState }
  | { ok: false; message: string };

/** 「待定」在数据里的表示：队伍 id 置空、名字回到占位文案。 */
const EMPTY_TEAM = { id: "", name: "待定" };

/**
 * 把一场已完成的比赛退回「未打」。
 *
 * 护栏（宁可拒绝，也不悄悄改坏别人已经打过的比赛）：
 * - 没有赛果 → 拒绝（避免重复点击把状态改乱）；
 * - **下一场已经有赛果 → 拒绝**：先退下一场，否则会把已晋级并打完的比赛一侧清空；
 * - 级联只清「本场胜者/败者填进去的那一侧」，其余不动。
 */
export function revertResultOp(state: ScheduleState, matchId: string): RevertResultOutcome {
  const target = state.matches.find((match) => match.id === matchId);
  if (!target) return { ok: false, message: "这场比赛不存在（可能已被删除）" };
  if (target.status !== "已完成" || !target.winnerTeamId) {
    return { ok: false, message: "这场比赛没有赛果，不需要撤销" };
  }

  const winnerTarget = target.nextMatchId ? state.matches.find((m) => m.id === target.nextMatchId) : undefined;
  const loserTarget = target.nextLoserMatchId ? state.matches.find((m) => m.id === target.nextLoserMatchId) : undefined;

  // 下一场已经打完（或已有赛果），说明胜者已经被用掉。先退下一场，避免把已打的结果清空。
  for (const next of [winnerTarget, loserTarget]) {
    if (next && (next.status === "已完成" || (next.gameResults?.length ?? 0) > 0)) {
      return { ok: false, message: `下一场 ${next.id} 已有赛果，请先撤销那一场` };
    }
  }

  const clearSide = (match: ScheduleMatch, side: "A" | "B" | undefined): ScheduleMatch => {
    if (!side) return match;
    return side === "A"
      ? { ...match, teamAId: EMPTY_TEAM.id, teamAName: EMPTY_TEAM.name }
      : { ...match, teamBId: EMPTY_TEAM.id, teamBName: EMPTY_TEAM.name };
  };

  const matches = state.matches.map((match) => {
    if (match.id === matchId) {
      return {
        ...match,
        gameResults: undefined,
        winnerTeamId: undefined,
        // 有排期时间就退回「已排期」，否则回到「待排期」——不要假装它还排着
        status: match.startTime ? ("已排期" as const) : ("待排期" as const),
      };
    }
    if (winnerTarget && match.id === winnerTarget.id) return clearSide(match, target.nextSide);
    if (loserTarget && match.id === loserTarget.id) return clearSide(match, target.nextLoserSide);
    return match;
  });

  return { ok: true, state: { ...state, matches } };
}
