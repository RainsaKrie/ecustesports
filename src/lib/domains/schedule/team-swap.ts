// =====================
// 对阵调整：交换两个签位的队伍（2026-10-16）
//
// 起因：2026-10-14 负责人要求「把 Paper Rex 和我不是炮神安排到一起打」，
// 当时是**直接改赛程数据**完成的 —— 没有界面、没有理由、没有留痕。
// 这件事涉及比赛公平性（其他队伍会问依据），所以要做成正式动作：
// 界面里点得出来、必须填理由、写进审计。
//
// 本模块只管「能不能换 / 怎么换」这两件纯事；理由与审计在调用侧。
// =====================

import type { ScheduleMatch } from "./schedule-data.ts";

export interface TeamSlot {
  matchId: string;
  side: "A" | "B";
}

/** 该场次是否「已经动过了」：排过期、有赛果、有胜者，都算 */
function isInUse(match: ScheduleMatch): boolean {
  return Boolean(match.startTime)
    || match.status !== "待排期"
    || Boolean(match.winnerTeamId)
    || (match.gameResults?.length ?? 0) > 0;
}

const sideOf = (match: ScheduleMatch, side: "A" | "B") =>
  side === "A" ? { id: match.teamAId, name: match.teamAName } : { id: match.teamBId, name: match.teamBName };

/**
 * 能不能换？返回拒绝理由；`null` 表示可以。
 *
 * 四条判据，每条都对应一种"换了会出事"：
 *   ① 同阶段 —— 跨阶段换会把队伍挪到它在晋级关系上到不了的位置；
 *   ② 两场都未开打 —— 排过期或有赛果的场次，队伍已经按那个对阵准备了；
 *   ③ 两边队伍都已确定 —— 待定签位（组内决赛、淘汰赛后续轮次）换不了；
 *   ④ 不是同一场 —— 同一场内部换 A/B 是"换边"，不是这个功能要干的事。
 */
export function teamSwapRefusal(matches: ScheduleMatch[], from: TeamSlot, to: TeamSlot): string | null {
  if (from.matchId === to.matchId) return "不能和同一场对调（那只是换边）。";
  const a = matches.find((m) => m.id === from.matchId);
  const b = matches.find((m) => m.id === to.matchId);
  if (!a || !b) return "找不到要调整的场次，请刷新后重试。";
  if (a.phase !== b.phase) return `只能在同一个阶段内调整对阵（当前分别是「${a.phase}」与「${b.phase}」）。`;
  if (isInUse(a) || isInUse(b)) return "这两场里已经有排期或赛果，不能再调整对阵。";
  if (sideOf(a, from.side).id === "TBD" || sideOf(b, to.side).id === "TBD") {
    return "要调整的队伍还没确定（前序比赛还没出结果）。";
  }
  return null;
}

/**
 * 交换两个签位的队伍（纯函数，返回新数组）。
 *
 * **只动这四样**（每边两个签位各动 id 与名字），其余一律不碰 ——
 * 尤其是 `nextMatchId` / `nextSide` / `prerequisiteId` 这类晋级连线：
 * 换位不改变"谁赢谁去下一场"的结构。
 *
 * 不能换的情况直接抛错（而不是悄悄返回原样）—— 调用方应当先用 `teamSwapRefusal` 拿到可读理由。
 */
export function swapTeamSlots(matches: ScheduleMatch[], from: TeamSlot, to: TeamSlot): ScheduleMatch[] {
  const refusal = teamSwapRefusal(matches, from, to);
  if (refusal) throw new Error(refusal);

  const a = matches.find((m) => m.id === from.matchId)!;
  const b = matches.find((m) => m.id === to.matchId)!;
  const teamOfA = sideOf(a, from.side);
  const teamOfB = sideOf(b, to.side);

  const patch = (match: ScheduleMatch, side: "A" | "B", team: { id: string; name: string }): ScheduleMatch =>
    side === "A"
      ? { ...match, teamAId: team.id, teamAName: team.name }
      : { ...match, teamBId: team.id, teamBName: team.name };

  return matches.map((match) => {
    if (match.id === from.matchId) return patch(match, from.side, teamOfB);
    if (match.id === to.matchId) return patch(match, to.side, teamOfA);
    return match;
  });
}
