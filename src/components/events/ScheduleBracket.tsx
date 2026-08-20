"use client";

import { useSchedule } from "@/lib/scheduling/useSchedule";
import type { ScheduleMatch } from "@/lib/scheduling/schedule-data";

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
  return (
    <div className="w-28 shrink-0 border border-gray-200 bg-white p-1.5">
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
    </div>
  );
}

export default function ScheduleBracket() {
  const { state } = useSchedule();
  const matches = state.matches;

  if (matches.length === 0) {
    return (
      <div className="border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
        对阵尚未生成，请等待抽签分组后发布赛程。
      </div>
    );
  }

  // 按阶段 → 轮次 分组，保持 matches 数组的出现顺序
  const phases: string[] = [];
  for (const m of matches) {
    if (!phases.includes(m.phase)) phases.push(m.phase);
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex flex-col gap-2">
        {phases.map((phase) => {
          const phaseMatches = matches.filter((m) => m.phase === phase);
          const rounds: string[] = [];
          for (const m of phaseMatches) {
            const r = m.round ?? "未分组";
            if (!rounds.includes(r)) rounds.push(r);
          }
          return (
            <div key={phase}>
              <h3 className="mb-1 text-[0.6875rem] font-bold text-gray-700">{phase}</h3>
              <div className="flex gap-2 min-w-max">
                {rounds.map((round) => {
                  const roundMatches = phaseMatches.filter((m) => (m.round ?? "未分组") === round);
                  return (
                    <div key={round} className="flex flex-col">
                      <div className="mb-1">
                        <p className="text-[0.6875rem] font-semibold text-gray-700">{round}</p>
                        <p className="text-[0.5rem] text-gray-400">{roundMatches.length} 场</p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {roundMatches.map((m) => (
                          <MatchCell key={m.id} m={m} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
