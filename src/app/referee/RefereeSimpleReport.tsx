// =====================
// 报分模式面板（2026-10-29）
//
// 两个模式：
//   简单版 —— 只填两队各赢几局（2:0 / 2:1），不选地图、不传图、不记逐局回合分；
//   逐局版 —— 原来那套（BP 地图序列预生成上传位、逐局回合分、证据图）。
//
// 为什么单独一个文件：RefereeWorkbench.tsx 已在行数基线上，多一行都会让架构守卫变红。
// 这里自成一体：模式开关 + 简单版输入都在本文件内，主文件只负责把 games 接过去。
//
// 简单版复用同一条提交链路：按「各赢几局」生成占位逐局（胜方局 1:0、负方局 0:1），
// 写进同一个 games 数组 —— 胜者判定、确认页、校验、提交接口都不用改。
// =====================

import { useState } from "react";

export type GameDraft = { map: string; teamAScore: number; teamBScore: number };
export type ReportMode = "simple" | "detailed";

function toScore(value: string): number {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

export function ReportModePanel({
  mode,
  onModeChange,
  onGames,
  mapSequence,
  maxGames,
  teamAName,
  teamBName,
}: {
  mode: ReportMode;
  onModeChange: (next: ReportMode) => void;
  onGames: (games: GameDraft[]) => void;
  /** 该场 BP 已确定的地图序列；切回逐局模式时用它重建空白的逐局格子 */
  mapSequence: string[];
  maxGames: number;
  teamAName: string;
  teamBName: string;
}) {
  const [series, setSeries] = useState({ a: 0, b: 0 });

  function buildSeries(a: number, b: number) {
    const nextA = Math.max(0, Math.min(a, maxGames));
    const nextB = Math.max(0, Math.min(b, maxGames));
    setSeries({ a: nextA, b: nextB });
    const next: GameDraft[] = [];
    for (let i = 0; i < nextA; i += 1) next.push({ map: "", teamAScore: 1, teamBScore: 0 });
    for (let i = 0; i < nextB; i += 1) next.push({ map: "", teamAScore: 0, teamBScore: 1 });
    onGames(next);
  }

  function switchTo(next: ReportMode) {
    onModeChange(next);
    if (next === "detailed") {
      // 切回逐局时清掉占位数据，避免 1:0 被当成真实回合分提交
      setSeries({ a: 0, b: 0 });
      onGames(
        mapSequence.length > 0
          ? mapSequence.map((map) => ({ map, teamAScore: 0, teamBScore: 0 }))
          : [{ map: "", teamAScore: 0, teamBScore: 0 }],
      );
    }
  }

  const tabClass = (active: boolean) =>
    `h-11 border text-base font-bold ${active ? "border-[#ff4655] text-[#ff4655]" : "border-[var(--pub-line-soft)] text-[var(--pub-txt-soft)]"}`;

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => switchTo("simple")} className={tabClass(mode === "simple")}>简单报分</button>
        <button type="button" onClick={() => switchTo("detailed")} className={tabClass(mode === "detailed")}>逐局报分</button>
      </div>

      {mode === "simple" && (
        <div className="mt-4 border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-4">
          <p className="mono-label text-[var(--pub-txt-soft)]">各赢几局</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="mono-label text-[var(--pub-txt-soft)]">{teamAName}</span>
              <input
                type="text"
                inputMode="numeric"
                value={series.a}
                onChange={(event) => buildSeries(toScore(event.target.value), series.b)}
                className="h-[48px] border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-3 text-center text-xl font-bold text-[var(--pub-txt)] outline-none focus:border-[#ff4655]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="mono-label text-[var(--pub-txt-soft)]">{teamBName}</span>
              <input
                type="text"
                inputMode="numeric"
                value={series.b}
                onChange={(event) => buildSeries(series.a, toScore(event.target.value))}
                className="h-[48px] border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-3 text-center text-xl font-bold text-[var(--pub-txt)] outline-none focus:border-[#ff4655]"
              />
            </label>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--pub-txt-soft)]">简单版只记大比分，不记逐局回合分与地图。要记小分请切到逐局报分。</p>
        </div>
      )}
    </>
  );
}
