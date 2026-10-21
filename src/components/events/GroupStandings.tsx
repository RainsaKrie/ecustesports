"use client";

import { useState } from "react";

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
import { buildGroups, buildRows } from "@/lib/domains/schedule/group-standings";

export default function GroupStandings({ matches, advancePerGroup = 2 }: { matches: ScheduleMatch[]; advancePerGroup?: number }) {
  const groups = buildGroups(matches);
  // 少于 2 支真实队伍的组没有意义（抽签还没落位），直接不显示
  const usable = [...groups.entries()].filter(([, ids]) => ids.size >= 2);
  // 一次只看一个组（2026-10-21）：四个组竖排会把页面拉得很长。
  // Hooks 必须无条件调用，所以放在提前 return 之前。
  const [active, setActive] = useState(0);
  const safeActive = Math.min(active, Math.max(1, usable.length) - 1);

  if (usable.length === 0) {
    return (
      <div className="border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-5 py-8 text-center text-sm font-bold text-[var(--pub-txt-soft)]">
        分组尚未抽签，抽签完成后这里会显示各组积分。
      </div>
    );
  }

  const labels = "ABCDEFGH";
  return (
    <div>
      {usable.length > 1 && (
        <div className="ui-toggle mb-4" role="tablist" aria-label="分组">
          {usable.map(([name], index) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={index === safeActive}
              onClick={() => setActive(index)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {usable.map(([, teamIds], index) => {
        if (index !== safeActive) return null;
        const rows = buildRows(matches, teamIds);
        return (
          <section key={index}>
            <div className="mb-2 flex items-end justify-between gap-4 border-b border-[var(--pub-line)] pb-2">
              <h3 className="text-base font-black text-[var(--pub-txt)]">{labels[index] ?? index + 1} 组</h3>
              <span className="font-mono text-[length:var(--pub-fs-xs)] font-bold tracking-[0.1em] text-[var(--pub-txt-soft)]">
                {rows.length} 队 · 前 {advancePerGroup} 出线
              </span>
            </div>
            <div className="space-y-1">
              <div className="hidden grid-cols-[2rem_1fr_5rem_4.5rem_5rem] items-center px-1 pb-1 font-mono text-[length:var(--pub-fs-xs)] font-black uppercase tracking-[0.14em] text-[var(--pub-txt-mute)] sm:grid">
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
                    <span className={`pl-2 text-sm font-black sm:text-[length:var(--pub-fs-md)] ${out ? "text-[var(--pub-txt)]" : "text-[var(--pub-txt-soft)]"}`}>{row.name}</span>
                    <span className="justify-self-end font-mono text-xs font-bold tabular-nums text-[var(--pub-txt-soft)] sm:justify-self-end sm:pr-0 sm:text-right">{row.wins} - {row.losses}</span>
                    <span className="col-start-2 justify-self-start font-mono text-[length:var(--pub-fs-xs)] font-bold tabular-nums text-[var(--pub-txt-mute)] sm:col-start-auto sm:justify-self-end sm:text-xs sm:text-right">
                      {row.diff > 0 ? `+${row.diff}` : row.diff}
                    </span>
                    <span className={`col-start-3 row-start-1 justify-self-end font-mono text-[length:var(--pub-fs-xs)] font-bold tracking-[0.08em] sm:col-start-auto sm:row-start-auto sm:pr-2 sm:text-right ${out ? "text-[var(--pub-red)]" : "text-[var(--pub-txt-mute)]"}`}>
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
