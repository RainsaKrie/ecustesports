"use client";

import { useSchedule } from "@/lib/scheduling/useSchedule";
import type { GameResult } from "@/lib/scheduling/schedule-data";

function fmt(iso: string): string {
  if (!iso) return "待安排";
  return iso.slice(5, 16).replace("T", " ");
}

function winCount(games: GameResult[] | undefined, side: "A" | "B"): number {
  if (!games) return 0;
  return games.filter((g) => (side === "A" ? g.teamAScore > g.teamBScore : g.teamBScore > g.teamAScore)).length;
}

function StatusBadge({ status }: { status: string }) {
  const style =
    status === "已完成"
      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
      : "bg-slate-50 text-slate-500 border border-slate-200";
  return <span className={`inline-block px-2 py-1 text-xs font-bold ${style}`}>{status}</span>;
}

export default function PublicSchedule({ eventId }: { eventId: string }) {
  const { state } = useSchedule(eventId);
  const matches = state.matches;

  if (matches.length === 0) {
    return (
      <div className="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
        赛程尚未公布，请关注赛事通知。
      </div>
    );
  }

  // 已完成在前（赛果），其余按开赛时间排序
  const completed = matches.filter((m) => m.status === "已完成");
  const rest = matches
    .filter((m) => m.status !== "已完成")
    .slice()
    .sort((a, b) => (a.startTime || "9999").localeCompare(b.startTime || "9999"));

  return (
    <div className="space-y-5">
      {completed.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-bold text-gray-900">赛果</h3>
          <div className="overflow-hidden border border-gray-200 bg-white">
            <div className="divide-y divide-gray-100">
              {completed.map((m) => (
                <div key={m.id} className="px-5 py-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-gray-900">
                      {m.teamAName} <span className="mx-2 text-gray-400">vs</span> {m.teamBName}
                    </p>
                    <span className="text-sm font-black text-gray-900">
                      {winCount(m.gameResults, "A")} : {winCount(m.gameResults, "B")}
                    </span>
                  </div>
                  {m.gameResults && m.gameResults.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {m.gameResults.map((g, i) => (
                        <span key={i} className="bg-slate-50 px-2 py-1 text-xs text-slate-600">
                          {g.map || `第${i + 1}局`} {g.teamAScore}:{g.teamBScore}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.winnerTeamId && (
                    <p className="mt-1 text-xs font-bold text-emerald-600">
                      胜者：{m.winnerTeamId === m.teamAId ? m.teamAName : m.teamBName}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-bold text-gray-900">赛程</h3>
        <div className="overflow-hidden border border-gray-200 bg-white">
          {rest.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">所有比赛已结束</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {rest.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div>
                    <p className="text-sm font-bold text-gray-900">
                      {m.teamAName} vs {m.teamBName}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {m.boType} · {fmt(m.startTime)}
                    </p>
                  </div>
                  <StatusBadge status={m.status === "已排期" ? "待开始" : m.status === "待排期" ? "待排期" : m.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
