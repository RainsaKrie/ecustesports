"use client";

import { useSchedule } from "@/lib/scheduling/useSchedule";
import type { GameResult } from "@/lib/scheduling/schedule-data";
import StageCards, { stageCardsFromMatches } from "@/components/events/StageCards";

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
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-black/10 bg-[#f2eee6] text-[#60656d]";
  return <span className={`inline-block border px-2.5 py-1 text-[0.6875rem] font-black ${style}`}>{status}</span>;
}

export default function PublicSchedule({ eventId, preview = false }: { eventId: string; preview?: boolean }) {
  const { state } = useSchedule(eventId, preview ? "preview" : "public");
  const matches = state.matches;

  if (matches.length === 0) {
    return (
      <div className="border border-black/10 bg-[#fffdf8] p-8 text-center text-sm font-bold text-[#60656d]">
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
  const completedPhases = Array.from(new Set(completed.map((match) => match.phase)));
  const latestCompletedPhase = completedPhases[completedPhases.length - 1];
  const finalMatch = [...completed]
    .reverse()
    .find((match) => ["总决赛", "决赛"].includes(match.round ?? ""));
  const lowerFinal = [...completed]
    .reverse()
    .find((match) => match.round === "败者组决赛");
  const champion = finalMatch?.winnerTeamId === finalMatch?.teamAId
    ? finalMatch?.teamAName
    : finalMatch?.winnerTeamId === finalMatch?.teamBId
      ? finalMatch?.teamBName
      : undefined;
  const runnerUp = finalMatch?.winnerTeamId === finalMatch?.teamAId
    ? finalMatch?.teamBName
    : finalMatch?.winnerTeamId === finalMatch?.teamBId
      ? finalMatch?.teamAName
      : undefined;
  const thirdPlace = lowerFinal?.winnerTeamId === lowerFinal?.teamAId
    ? lowerFinal?.teamBName
    : lowerFinal?.winnerTeamId === lowerFinal?.teamBId
      ? lowerFinal?.teamAName
      : undefined;
  const allCompleted = rest.length === 0;
  const finalWinsA = winCount(finalMatch?.gameResults, "A");
  const finalWinsB = winCount(finalMatch?.gameResults, "B");
  const championScore = finalMatch?.winnerTeamId === finalMatch?.teamAId ? finalWinsA : finalWinsB;
  const runnerUpScore = finalMatch?.winnerTeamId === finalMatch?.teamAId ? finalWinsB : finalWinsA;

  const { items: stageItems, currentIndex: currentStageIndex } = stageCardsFromMatches(matches);

  return (
    <div className="space-y-4">
      <StageCards items={stageItems} currentIndex={currentStageIndex} />

      {allCompleted && finalMatch && champion && runnerUp && (
        <section className="overflow-hidden border border-black/15 bg-[#fffdf8]">
          <header className="flex items-center justify-between gap-4 border-b border-black/10 px-5 py-4 sm:px-7">
            <div>
              <p className="font-mono text-[0.625rem] font-black tracking-[0.18em] text-[#c83242]">FINAL STANDINGS</p>
              <h3 className="mt-1 text-lg font-black text-[#171a1f]">最终排名</h3>
            </div>
            <span className="shrink-0 whitespace-nowrap border border-[#ff4655]/35 bg-[#fff1f2] px-2.5 py-1 text-[0.6875rem] font-black text-[#c83242]">赛事已结束</span>
          </header>

          <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)]">
            <div className="relative overflow-hidden border-b border-black/10 bg-[#f2eee6] px-5 py-6 sm:px-7 sm:py-7 lg:border-b-0 lg:border-r">
              <span aria-hidden className="absolute -bottom-8 right-3 font-mono text-[7rem] font-black leading-none text-[#ff4655]/[0.08] sm:right-8">01</span>
              <div className="relative">
                <p className="font-mono text-[0.625rem] font-black tracking-[0.18em] text-[#c83242]">CHAMPION / 冠军</p>
                <h4 className="mt-3 text-3xl font-black tracking-[-0.04em] text-[#171a1f] sm:text-4xl">{champion}</h4>
                <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-black text-[#34383f]">
                  <span className="text-[#60656d]">总决赛</span>
                  <span>{champion}</span>
                  <strong className="font-mono text-lg text-[#c83242]">{championScore}:{runnerUpScore}</strong>
                  <span>{runnerUp}</span>
                </p>
              </div>
            </div>

            <dl className="grid sm:grid-cols-2 lg:grid-cols-1">
              <div className="flex min-h-24 items-center gap-4 border-b border-black/10 p-5 sm:min-h-28 sm:border-b-0 sm:border-r sm:p-6 lg:border-b lg:border-r-0">
                <span className="font-mono text-2xl font-black text-[#c8c2b9]">02</span>
                <div>
                  <dt className="text-[0.625rem] font-black tracking-[0.12em] text-[#7b766f]">亚军</dt>
                  <dd className="mt-1.5 text-base font-black text-[#171a1f] sm:text-lg">{runnerUp}</dd>
                </div>
              </div>
              <div className="flex min-h-28 items-center gap-4 p-5 sm:p-6">
                <span className="font-mono text-2xl font-black text-[#c8c2b9]">03</span>
                <div>
                  <dt className="text-[0.625rem] font-black tracking-[0.12em] text-[#7b766f]">季军</dt>
                  <dd className="mt-1.5 text-base font-black text-[#171a1f] sm:text-lg">{thirdPlace ?? "—"}</dd>
                </div>
              </div>
            </dl>
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <div className="mb-2 flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[0.625rem] font-black tracking-[0.16em] text-[#c83242]">MATCH RESULTS</p>
              <h3 className="mt-1 text-lg font-black text-[#171a1f]">比赛结果</h3>
            </div>
            <span className="font-mono text-[0.6875rem] font-black text-[#7b766f]">{completed.length} MATCHES</span>
          </div>
          <div className="space-y-2">
            {completedPhases.map((phase) => {
              const phaseMatches = completed.filter((match) => match.phase === phase);
              return (
                <details key={phase} open={phase === latestCompletedPhase} className="group border border-black/10 bg-[#fffdf8]">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-4 bg-[#f2eee6] px-4 py-2.5 transition hover:bg-[#ebe5dc]">
                    <span className="text-sm font-black text-[#171a1f]">{phase}</span>
                    <span className="flex items-center gap-4">
                      <span className="font-mono text-[0.625rem] font-black text-[#7b766f]">{phaseMatches.length} 场</span>
                      <span aria-hidden className="text-lg font-black text-[#c83242] transition group-open:rotate-45">＋</span>
                    </span>
                  </summary>
                  <div className="divide-y divide-black/10 border-t border-black/10">
                    {phaseMatches.map((m) => (
                      <div key={m.id} className="px-4 py-2 transition hover:bg-black/[0.025]">
                        <div className="grid gap-1.5 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(8rem,1.1fr)_auto] sm:items-center sm:gap-3">
                          <p className="font-mono text-[0.625rem] font-black text-[#96918a]">{m.id} · {m.round || m.boType}</p>
                          <p className="text-xs font-bold text-[#171a1f]">
                            {m.teamAName} <span className="mx-1.5 text-[#96918a]">VS</span> {m.teamBName}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {m.gameResults?.map((g, i) => (
                              <span key={i} className="border border-black/10 bg-[#f2eee6] px-1.5 py-0.5 text-[0.625rem] font-bold text-[#60656d]">
                                {g.map || `第${i + 1}局`} {g.teamAScore}:{g.teamBScore}
                              </span>
                            ))}
                          </div>
                          <span className="font-mono text-base font-black text-[#171a1f]">
                            {winCount(m.gameResults, "A")} : {winCount(m.gameResults, "B")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <div className="mb-3">
            <p className="font-mono text-[0.625rem] font-black tracking-[0.16em] text-[#c83242]">UPCOMING MATCHES</p>
            <h3 className="mt-1 text-lg font-black text-[#171a1f]">赛事赛程</h3>
          </div>
          <div className="overflow-hidden border border-black/10 bg-[#fffdf8]">
            <div className="divide-y divide-black/10">
              {rest.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <div>
                    <p className="text-sm font-bold text-[#171a1f]">
                      {m.teamAName} vs {m.teamBName}
                    </p>
                    <p className="mt-1 text-xs font-bold text-[#60656d]">
                      {m.boType} · {fmt(m.startTime)}
                    </p>
                  </div>
                  <StatusBadge status={m.status === "已排期" ? "待开始" : m.status === "待排期" ? "待排期" : m.status} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
