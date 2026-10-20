"use client";

// =====================
// 分组积分表（2026-10-20）
//
// 数据侧的约束：**分组关系没有持久化** —— `ScheduleMatch` 里没有 group 字段，
// 抽签时生成的 groups 只在生成对阵那一刻存在。所以这里**从小组赛的对阵反推组别**：
// 同组队伍必然互相打过（GSL / 组内循环都是组内闭环），用并查集取连通分量即可还原。
//
// 这是推断，不是事实 —— 如果以后出现了跨组交手（例如表演赛混编），分组会被并成一个大组。
// 真到那天，应该在赛程数据里补一个 group 字段，而不是继续加启发式规则。
// =====================

import type { ScheduleMatch } from "@/lib/domains/schedule/schedule-data";

type Row = {
  id: string;
  name: string;
  wins: number;
  losses: number;
  /** 局差：逐图比分之和，赢图记 +1、输图记 −1，按分差计 */
  diff: number;
  played: number;
};

const GROUP_PHASE_HINTS = ["小组赛", "组内"];

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

function isGroupPhase(phase: string): boolean {
  return GROUP_PHASE_HINTS.some((hint) => phase.includes(hint));
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
function buildGroups(matches: ScheduleMatch[]): Map<string, Set<string>> {
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

function buildRows(matches: ScheduleMatch[], teamIds: Set<string>): Row[] {
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

export default function GroupStandings({ matches, advancePerGroup = 2 }: { matches: ScheduleMatch[]; advancePerGroup?: number }) {
  const groups = buildGroups(matches);
  // 少于 2 支真实队伍的组没有意义（抽签还没落位），直接不显示
  const usable = [...groups.entries()].filter(([, ids]) => ids.size >= 2);
  if (usable.length === 0) {
    return (
      <div className="border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-5 py-8 text-center text-sm font-bold text-[var(--pub-txt-soft)]">
        分组尚未抽签，抽签完成后这里会显示各组积分。
      </div>
    );
  }

  const labels = "ABCDEFGH";
  return (
    <div className="space-y-6">
      {usable.map(([, teamIds], index) => {
        const rows = buildRows(matches, teamIds);
        return (
          <section key={index}>
            <div className="mb-2 flex items-end justify-between gap-4 border-b border-[var(--pub-line)] pb-2">
              <h3 className="text-base font-black text-[var(--pub-txt)]">{labels[index] ?? index + 1} 组</h3>
              <span className="font-mono text-[0.6875rem] font-bold tracking-[0.1em] text-[var(--pub-txt-soft)]">
                {rows.length} 队 · 前 {advancePerGroup} 出线
              </span>
            </div>
            <div className="space-y-1">
              <div className="hidden grid-cols-[2rem_1fr_5rem_4.5rem_5rem] items-center px-1 pb-1 font-mono text-[0.625rem] font-black uppercase tracking-[0.14em] text-[var(--pub-txt-mute)] sm:grid">
                <span /><span className="pl-2">队伍</span><span className="text-right">胜-负</span><span className="text-right">局差</span><span className="pr-2 text-right">状态</span>
              </div>
              {rows.map((row, rank) => {
                const out = rank < advancePerGroup && row.played > 0;
                return (
                  <div
                    key={row.id}
                    className="grid grid-cols-[2rem_1fr_auto] items-center gap-x-3 gap-y-0.5 border border-[var(--pub-line-soft)] bg-[var(--pub-card)] py-2.5 pl-0 pr-3 sm:grid-cols-[2rem_1fr_5rem_4.5rem_5rem] sm:gap-0 sm:pr-0"
                  >
                    <span
                      aria-hidden
                      className={`h-full min-h-8 w-0.5 justify-self-start sm:mx-auto sm:w-full sm:max-w-[2px] ${out ? "bg-[var(--pub-red)]" : "bg-transparent"}`}
                    />
                    <span className={`pl-2 text-sm font-black sm:text-[0.9375rem] ${out ? "text-[var(--pub-txt)]" : "text-[var(--pub-txt-soft)]"}`}>{row.name}</span>
                    <span className="justify-self-end font-mono text-xs font-bold tabular-nums text-[var(--pub-txt-soft)] sm:justify-self-end sm:pr-0 sm:text-right">{row.wins} - {row.losses}</span>
                    <span className="col-start-2 justify-self-start font-mono text-[0.625rem] font-bold tabular-nums text-[var(--pub-txt-mute)] sm:col-start-auto sm:justify-self-end sm:text-xs sm:text-right">
                      {row.diff > 0 ? `+${row.diff}` : row.diff}
                    </span>
                    <span className={`col-start-3 row-start-1 justify-self-end font-mono text-[0.625rem] font-bold tracking-[0.08em] sm:col-start-auto sm:row-start-auto sm:pr-2 sm:text-right ${out ? "text-[var(--pub-red)]" : "text-[var(--pub-txt-mute)]"}`}>
                      {out ? "出线" : row.played === 0 ? "未赛" : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
