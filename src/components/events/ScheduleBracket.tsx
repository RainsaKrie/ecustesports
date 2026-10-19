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
      ? "bg-[#ecfdf5] text-[#047857] border border-[#a7f3d0]"
      : "bg-[#f2eee6] text-[#5b626c] border border-[#d8d1c6]";
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
      className="w-full min-w-0 border border-[#d8d1c6] bg-white p-1.5 text-left transition-colors duration-150 hover:border-[#171a1f] focus-visible:border-[#171a1f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff4655]"
    >
      <div className="mb-0.5 flex items-center justify-between gap-1">
        <span className="text-[0.5625rem] text-[#8b929c]">{m.boType}</span>
        <StatusBadge status={m.status} />
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-1">
          <span className={`truncate text-[0.6875rem] ${aWin ? "font-bold text-[#171a1f]" : "text-[#5b626c]"}`}>{m.teamAName}</span>
          {completed && <span className={`font-mono text-[0.6875rem] font-bold ${aWin ? "text-[#ff4655]" : "text-[#8b929c]"}`}>{winCount(m, "A")}</span>}
        </div>
        {!completed && <div className="text-center text-[0.5625rem] leading-3 text-[#c3c9d2]">VS</div>}
        <div className="flex items-center justify-between gap-1">
          <span className={`truncate text-[0.6875rem] ${bWin ? "font-bold text-[#171a1f]" : "text-[#5b626c]"}`}>{m.teamBName}</span>
          {completed && <span className={`font-mono text-[0.6875rem] font-bold ${bWin ? "text-[#ff4655]" : "text-[#8b929c]"}`}>{winCount(m, "B")}</span>}
        </div>
      </div>
      {advancement && <div className="mt-1 border-t border-[#e7e1d7] pt-1 font-mono text-[0.45rem] text-[#8b929c]">{advancement}</div>}
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
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(15,25,35,0.55)] p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="比赛详情">
      <div className="w-full max-w-md bg-[#fffdf8] ring-1 ring-[#171a1f]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[#d8d1c6] px-4 py-3">
          <div className="min-w-0">
            <p className="font-mono text-[0.625rem] font-black tracking-[0.12em] text-[#c83242]">{m.id} · {m.phase}</p>
            <h3 className="mt-1 truncate text-base font-black text-[#171a1f]">{m.teamAName} VS {m.teamBName}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="grid h-8 w-8 flex-none place-items-center text-lg leading-none text-[#5b626c] hover:text-[#171a1f]">×</button>
        </div>
        <div className="px-4 py-3">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.625rem] tracking-[0.06em] text-[#5b626c]">
            <span>{m.boType}</span>
            <span>{m.status}</span>
            <span>{m.startTime ? m.startTime.slice(5, 16).replace("T", " ") : "待安排"}</span>
          </p>
          {games.length === 0 ? (
            <p className="mt-3 text-sm text-[#8b929c]">还没有逐图结果。</p>
          ) : (
            <div className="mt-3">
              {games.map((g, i) => (
                <div key={i} className="flex items-center justify-between border-b border-[#e7e1d7] py-1.5 last:border-b-0">
                  <span className="text-xs text-[#5b626c]">{g.map ?? `第 ${i + 1} 图`}</span>
                  <span className="font-mono text-sm font-black text-[#171a1f]">{g.teamAScore} : {g.teamBScore}</span>
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
      <div className="border border-[#d8d1c6] bg-white p-10 text-center text-sm text-[#8b929c]">
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
