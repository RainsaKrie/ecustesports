"use client";

import { useEffect, useState } from "react";
import { useSchedule } from "@/hooks/useSchedule";
import type { ScheduleMatch } from "@/lib/domains/schedule/schedule-data";
import TournamentBracketCanvas, { advancementPath } from "@/components/events/TournamentBracketCanvas";

function winCount(m: ScheduleMatch, side: "A" | "B"): number {
  if (!m.gameResults) return 0;
  return m.gameResults.filter((g) => (side === "A" ? g.teamAScore > g.teamBScore : g.teamBScore > g.teamAScore)).length;
}

function StatusBadge({ status }: { status: string }) {
  const style =
    status === "已完成"
      ? "border border-[var(--pub-line-soft)] text-[var(--pub-txt-soft)]"
      : "bg-white/[0.06] text-[var(--pub-txt-soft)] border border-[var(--pub-line)]";
  return <span className={`inline-block px-1 py-0 text-[0.5rem] font-bold ${style}`}>{status === "已排期" ? "待开始" : status === "待排期" ? "待排期" : status}</span>;
}

function MatchCell({ m, onOpen }: { m: ScheduleMatch; onOpen: () => void }) {
  const completed = m.status === "已完成";
  const aWin = completed && m.winnerTeamId === m.teamAId;
  const bWin = completed && m.winnerTeamId === m.teamBId;
  const advancement = advancementPath(m);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${m.teamAName} 对 ${m.teamBName}：查看详情`}
      className="w-full min-w-0 border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-1.5 text-left transition-colors duration-150 hover:border-[var(--pub-line)] hover:bg-white/[0.07] focus-visible:border-[var(--pub-red)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pub-red)]"
    >
      <div className="mb-0.5 flex items-center justify-between gap-1">
        <span className="text-[0.5625rem] text-[var(--pub-txt-mute)]">{m.boType}</span>
        <StatusBadge status={m.status} />
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-1">
          <span className={`truncate text-[0.6875rem] ${aWin ? "font-bold text-[var(--pub-txt)]" : "text-[var(--pub-txt-soft)]"}`}>{m.teamAName}</span>
          {completed && <span className={`font-mono text-[0.6875rem] font-bold ${aWin ? "text-[var(--pub-red)]" : "text-[var(--pub-txt-mute)]"}`}>{winCount(m, "A")}</span>}
        </div>
        {!completed && <div className="text-center text-[0.5625rem] leading-3 text-[var(--pub-txt-mute)]">VS</div>}
        <div className="flex items-center justify-between gap-1">
          <span className={`truncate text-[0.6875rem] ${bWin ? "font-bold text-[var(--pub-txt)]" : "text-[var(--pub-txt-soft)]"}`}>{m.teamBName}</span>
          {completed && <span className={`font-mono text-[0.6875rem] font-bold ${bWin ? "text-[var(--pub-red)]" : "text-[var(--pub-txt-mute)]"}`}>{winCount(m, "B")}</span>}
        </div>
      </div>
      {advancement && <div className="mt-1 border-t border-[var(--pub-line-soft)] pt-1 font-mono text-[0.45rem] text-[var(--pub-txt-mute)]">{advancement}</div>}
    </button>
  );
}

/** 节点详情：对阵图只能看比分，看不到逐图结果与时间 —— 点开补给 */
function MatchDetailModal({ m, onClose }: { m: ScheduleMatch; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const games = m.gameResults ?? [];
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(0,0,0,0.6)] p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="比赛详情">
      <div className="ui-modal-panel w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[var(--pub-line)] px-4 py-3">
          <div className="min-w-0">
            <p className="font-mono text-[0.625rem] font-black tracking-[0.12em] text-[var(--pub-red)]">{m.id} · {m.phase}</p>
            <h3 className="mt-1 truncate text-base font-black text-[var(--pub-txt)]">{m.teamAName} VS {m.teamBName}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="grid h-8 w-8 flex-none place-items-center text-lg leading-none text-[var(--pub-txt-soft)] hover:text-[var(--pub-txt)]">×</button>
        </div>
        <div className="px-4 py-3">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.625rem] tracking-[0.06em] text-[var(--pub-txt-soft)]">
            <span>{m.boType}</span>
            <span>{m.status}</span>
            <span>{m.startTime ? m.startTime.slice(5, 16).replace("T", " ") : "待安排"}</span>
          </p>
          {games.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--pub-txt-mute)]">还没有逐图结果。</p>
          ) : (
            <div className="mt-3">
              {games.map((g, i) => (
                <div key={i} className="flex items-center justify-between border-b border-[var(--pub-line-soft)] py-1.5 last:border-b-0">
                  <span className="text-xs text-[var(--pub-txt-soft)]">{g.map ?? `第 ${i + 1} 图`}</span>
                  <span className="font-mono text-sm font-black text-[var(--pub-txt)]">{g.teamAScore} : {g.teamBScore}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ScheduleBracket({ eventId, preview = false }: { eventId: string; preview?: boolean }) {
  const { state } = useSchedule(eventId, preview ? "preview" : "public");
  const [picked, setPicked] = useState<ScheduleMatch | null>(null);
  const matches = state.matches;

  if (matches.length === 0) {
    return (
      <div className="ui-empty">
        对阵尚未生成，请等待抽签分组后发布赛程。
      </div>
    );
  }

  return (
    <>
      <TournamentBracketCanvas matches={matches} renderMatch={(match) => <MatchCell m={match} onOpen={() => setPicked(match)} />} />
      {picked && <MatchDetailModal m={picked} onClose={() => setPicked(null)} />}
    </>
  );
}
