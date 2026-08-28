"use client";

import { useSchedule } from "@/lib/scheduling/useSchedule";
import type { ScheduleMatch } from "@/lib/scheduling/schedule-data";
import TournamentBracketCanvas, { advancementPath } from "@/components/events/TournamentBracketCanvas";

function winCount(m: ScheduleMatch, side: "A" | "B"): number {
  if (!m.gameResults) return 0;
  return m.gameResults.filter((g) => (side === "A" ? g.teamAScore > g.teamBScore : g.teamBScore > g.teamAScore)).length;
}

function StatusBadge({ status }: { status: string }) {
  const style =
    status === "已完成"
      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
      : "bg-slate-50 text-slate-500 border border-slate-200";
  return <span className={`inline-block px-1 py-0 text-[0.5rem] font-bold ${style}`}>{status === "已排期" ? "待开始" : status === "待排期" ? "待排期" : status}</span>;
}

function MatchCell({ m }: { m: ScheduleMatch }) {
  const completed = m.status === "已完成";
  const aWin = completed && m.winnerTeamId === m.teamAId;
  const bWin = completed && m.winnerTeamId === m.teamBId;
  const advancement = advancementPath(m);
  return (
    <div className="w-full border border-gray-200 bg-white p-2">
      <div className="mb-0.5 flex items-center justify-between gap-1">
        <span className="text-[0.5625rem] text-gray-400">{m.boType}</span>
        <StatusBadge status={m.status} />
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-1">
          <span className={`truncate text-[0.6875rem] ${aWin ? "font-bold text-gray-900" : "text-gray-600"}`}>{m.teamAName}</span>
          {completed && <span className={`font-mono text-[0.6875rem] font-bold ${aWin ? "text-[#ff4655]" : "text-gray-400"}`}>{winCount(m, "A")}</span>}
        </div>
        {!completed && <div className="text-center text-[0.5625rem] leading-3 text-gray-300">VS</div>}
        <div className="flex items-center justify-between gap-1">
          <span className={`truncate text-[0.6875rem] ${bWin ? "font-bold text-gray-900" : "text-gray-600"}`}>{m.teamBName}</span>
          {completed && <span className={`font-mono text-[0.6875rem] font-bold ${bWin ? "text-[#ff4655]" : "text-gray-400"}`}>{winCount(m, "B")}</span>}
        </div>
      </div>
      {advancement && <div className="mt-1 border-t border-slate-100 pt-1 font-mono text-[0.45rem] text-slate-400">{advancement}</div>}
    </div>
  );
}

export default function ScheduleBracket({ eventId, preview = false }: { eventId: string; preview?: boolean }) {
  const { state } = useSchedule(eventId, preview ? "preview" : "public");
  const matches = state.matches;

  if (matches.length === 0) {
    return (
      <div className="border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
        对阵尚未生成，请等待抽签分组后发布赛程。
      </div>
    );
  }

  return <TournamentBracketCanvas matches={matches} renderMatch={(match) => <MatchCell m={match} />} />;
}
