// =====================
// 报分表单（2026-10-29）
//
// 单一表单，不让人先选「模式」：
//   1. 先填大比分（两队各赢几局）—— 收起状态就够用，对阵图能往前走；
//   2. 想记细节时展开「逐局记录」，逐局填地图与回合分。
//
// 与「两种模式切换」的关键区别：**展开不会重置已填内容**。
// 原来切到逐局模式会把占位清空，等于「先粗后细」这条路走不通；
// 现在可以先报 2:1 推进赛程，随后再展开补地图与小分。
//
// 为什么单独一个文件：RefereeWorkbench.tsx 在架构守卫的行数基线里，塞进去就会变长。
//
// 已知取舍：大比分模式下逐局是占位（胜方 1:0 / 负方 0:1）、地图为空。
// 真正的「只记大比分」需要给 ScheduleMatch 加 seriesScore 字段，
// 那要动校验与 7 处展示，安排在赛后做。
// =====================

import { useState } from "react";

export type GameDraft = { map: string; teamAScore: number; teamBScore: number };

function toScore(value: string): number {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

export function ReportForm({
  onGames,
  games,
  mapSequence,
  maxGames,
  teamAName,
  teamBName,
  showDetails,
  onShowDetailsChange,
}: {
  onGames: (games: GameDraft[]) => void;
  /** 当前逐局数据。收起时用它反推大比分，避免覆盖用户填好的逐局结果。 */
  games: GameDraft[];
  /** 该场 BP 已确定的地图序列；展开逐局时用它预填地图 */
  mapSequence: string[];
  maxGames: number;
  teamAName: string;
  teamBName: string;
  showDetails: boolean;
  onShowDetailsChange: (next: boolean) => void;
}) {
  const [series, setSeries] = useState({ a: 0, b: 0 });

  /** 大比分 → 占位逐局。收起状态下它就是最终数据。 */
  function buildSeries(a: number, b: number) {
    const nextA = Math.max(0, Math.min(a, maxGames));
    const nextB = Math.max(0, Math.min(b, maxGames));
    setSeries({ a: nextA, b: nextB });
    const next: GameDraft[] = [];
    for (let i = 0; i < nextA; i += 1) next.push({ map: "", teamAScore: 1, teamBScore: 0 });
    for (let i = 0; i < nextB; i += 1) next.push({ map: "", teamAScore: 0, teamBScore: 1 });
    onGames(next);
  }

  /** 展开逐局：按「大比分的局数」铺空格子，地图用 BP 序列预填。 */
  function openDetails() {
    const total = Math.max(1, series.a + series.b);
    const skeletons: GameDraft[] = [];
    for (let i = 0; i < total; i += 1) skeletons.push({ map: mapSequence[i] ?? "", teamAScore: 0, teamBScore: 0 });
    onGames(skeletons);
    onShowDetailsChange(true);
  }

  /**
   * 收起逐局：**从当前逐局反推大比分，不动 games**。
   * 早先版本用「展开前的大比分」重建占位，会把手填的 2:1 冲回 2:0 —— 数据被悄悄改掉。
   */
  function closeDetails() {
    const a = games.filter((g) => g.teamAScore > g.teamBScore).length;
    const b = games.filter((g) => g.teamBScore > g.teamAScore).length;
    setSeries({ a, b });
    onShowDetailsChange(false);
  }

  return (
    <div className="mt-4">
      {showDetails ? (
        <div className="flex items-center justify-between gap-3 border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-4 py-3">
          <p className="text-sm leading-relaxed text-[var(--pub-txt-soft)]">逐局记录中，大比分按逐局自动计算</p>
          <button type="button" onClick={closeDetails} className="shrink-0 text-sm font-bold text-[#ff4655]">收起</button>
        </div>
      ) : (
        <div className="border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="mono-label text-[var(--pub-txt-soft)]">大比分（各赢几局）</p>
            <button type="button" onClick={openDetails} className="shrink-0 text-sm font-bold text-[#ff4655]">展开逐局记录 ›</button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="mono-label min-w-0 truncate text-[var(--pub-txt-soft)]">{teamAName}</span>
              <input
                type="text"
                inputMode="numeric"
                value={series.a}
                onChange={(event) => buildSeries(toScore(event.target.value), series.b)}
                className="h-[48px] border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-3 text-center text-xl font-bold text-[var(--pub-txt)] outline-none focus:border-[#ff4655]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="mono-label min-w-0 truncate text-[var(--pub-txt-soft)]">{teamBName}</span>
              <input
                type="text"
                inputMode="numeric"
                value={series.b}
                onChange={(event) => buildSeries(series.a, toScore(event.target.value))}
                className="h-[48px] border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-3 text-center text-xl font-bold text-[var(--pub-txt)] outline-none focus:border-[#ff4655]"
              />
            </label>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--pub-txt-soft)]">只填大比分就能推进赛程；要记地图与小分再展开。</p>
        </div>
      )}
    </div>
  );
}
