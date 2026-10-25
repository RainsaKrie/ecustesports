// =====================
// 分组积分的纯逻辑（2026-10-21 从 GroupStandings.tsx 抽出）
//
// 为什么抽：这些是**纯函数**，却埋在客户端组件里（组件带 "use client" + JSX），
// Node 测试 import 不了，于是"分组对不对"只能靠人眼看页面。
// 抽成独立模块后可以用真实赛程数据回归验证（tools/ui/group-standings.test.ts）。
//
// 数据约束：**分组关系没有持久化** —— `ScheduleMatch` 里没有 group 字段。
// 这里优先从 `round` 解析组名（「A 组 半决赛」），解析不到才用并查集兜底。
// =====================

import type { ScheduleMatch } from "@/lib/domains/schedule/schedule-data";
import { GROUP_PHASE_KEYWORDS } from "@/lib/domains/schedule/stage-role";

type Row = {
  id: string;
  name: string;
  wins: number;
  losses: number;
  /** 局差：逐图比分之和，赢图记 +1、输图记 −1，按分差计 */
  diff: number;
  played: number;
};

// 阶段名在不同赛事里写法不同：「小组赛」「组内」「GSL 小组」「GSL」都见过。
// 少写一个词，整块积分表就静默消失 —— 2026-10-21 在 event-1 上踩过一次。
// 关键词统一从 `stage-role.ts` 取（唯一出处），这里不再自建一份。

/**
 * 占位队伍（2026-10-20 修）：抽签前/对手未定时，对阵里是 `TBD` / `待定` / `SLOT-01` 这类占位。
 * **它们不是队伍**，混进积分表会出现「C 组 1 队：待定」这种假数据。
 */
const PLACEHOLDER_IDS = new Set(["TBD", "BYE", "PENDING"]);
function isPlaceholder(match: ScheduleMatch): boolean {
  const id = (value: string | undefined) => {
    if (!value) return true;
    if (PLACEHOLDER_IDS.has(value)) return true;
    return value.startsWith("SLOT-");
  };
  return id(match.teamAId) || id(match.teamBId);
}

export function isGroupPhase(phase: string): boolean {
  return GROUP_PHASE_KEYWORDS.some((hint) => phase.includes(hint));
}

/**
 * 从比赛轮次里解析组名：GSL 的轮次形如「A 组 胜者组出线战」。
 * **这是权威来源**：从对阵反推只看谁跟谁打过，未开赛的轮次会让同组被拆成两人小组
 * （实测 4 人组显示成 2 人组）。
 */
function groupOfRound(round: string | undefined): string | null {
  const matched = (round ?? "").match(/^([A-Z一-龥]{1,2})\s*组/);
  return matched ? matched[1] + " 组" : null;
}

/** 并查集：把小组赛里互相交手的队伍并到一起（仅在没有轮次信息时兜底） */
export function buildGroups(matches: ScheduleMatch[]): Map<string, Set<string>> {
  // 先试权威来源：轮次里写了组名
  const byRound = new Map<string, Set<string>>();
  for (const m of matches) {
    if (!isGroupPhase(m.phase)) continue;
    if (isPlaceholder(m)) continue;
    const name = groupOfRound(m.round);
    if (!name) continue;
    if (!byRound.has(name)) byRound.set(name, new Set());
    if (m.teamAId) byRound.get(name)!.add(m.teamAId);
    if (m.teamBId) byRound.get(name)!.add(m.teamBId);
  }
  if (byRound.size > 0) return byRound;

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) && parent.get(cur) !== cur) cur = parent.get(cur)!;
    return cur;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const m of matches) {
    if (!isGroupPhase(m.phase)) continue;
    if (isPlaceholder(m)) continue;
    if (!parent.has(m.teamAId)) parent.set(m.teamAId, m.teamAId);
    if (!parent.has(m.teamBId)) parent.set(m.teamBId, m.teamBId);
    union(m.teamAId, m.teamBId);
  }

  const buckets = new Map<string, Set<string>>();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!buckets.has(root)) buckets.set(root, new Set());
    buckets.get(root)!.add(id);
  }
  return buckets;
}

export function buildRows(matches: ScheduleMatch[], teamIds: Set<string>): Row[] {
  const rows = new Map<string, Row>();
  for (const id of teamIds) rows.set(id, { id, name: id, wins: 0, losses: 0, diff: 0, played: 0 });

  for (const m of matches) {
    if (!isGroupPhase(m.phase)) continue;
    if (isPlaceholder(m)) continue;
    if (!teamIds.has(m.teamAId) || !teamIds.has(m.teamBId)) continue;
    const a = rows.get(m.teamAId)!;
    const b = rows.get(m.teamBId)!;
    a.name = m.teamAName;
    b.name = m.teamBName;
    if (m.status !== "已完成") continue;

    const aw = (m.gameResults ?? []).filter((g) => g.teamAScore > g.teamBScore).length;
    const bw = (m.gameResults ?? []).filter((g) => g.teamBScore > g.teamAScore).length;
    const diff = (m.gameResults ?? []).reduce((sum, g) => sum + (g.teamAScore - g.teamBScore), 0);

    a.played += 1;
    b.played += 1;
    a.diff += diff;
    b.diff -= diff;
    if (aw > bw) { a.wins += 1; b.losses += 1; } else if (bw > aw) { b.wins += 1; a.losses += 1; }
  }
  return [...rows.values()].sort((x, y) => y.wins - x.wins || y.diff - x.diff || x.name.localeCompare(y.name, "zh"));
}
