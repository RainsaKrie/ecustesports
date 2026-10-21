"use client";

import { useState } from "react";
import StatusChip from "@/components/events/StatusChip";
import GroupStandings from "@/components/events/GroupStandings";

import { useSchedule } from "@/hooks/useSchedule";
import type { GameResult } from "@/lib/domains/schedule/schedule-data";

function fmt(iso: string): string {
  if (!iso) return "待安排";
  return iso.slice(5, 16).replace("T", " ");
}

/** 相对时间：VLR 的做法是"绝对时刻 + 相对倒计时"双份，降低"什么时候打"的认知成本 */
function relTime(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = t - Date.now();
  const minutes = Math.round(Math.abs(diff) / 60000);
  const label = minutes < 60 ? `${minutes} 分钟` : minutes < 1440 ? `${Math.round(minutes / 60)} 小时` : `${Math.round(minutes / 1440)} 天`;
  return diff >= 0 ? `${label}后` : `${label}前`;
}

function winCount(games: GameResult[] | undefined, side: "A" | "B"): number {
  if (!games) return 0;
  return games.filter((g) => (side === "A" ? g.teamAScore > g.teamBScore : g.teamBScore > g.teamAScore)).length;
}



export default function PublicSchedule({ eventId, preview = false }: { eventId: string; preview?: boolean }) {
  const { state } = useSchedule(eventId, preview ? "preview" : "public");
  const [viewMode, setViewMode] = useState<"list" | "card">("list");
  const matches = state.matches;

  if (matches.length === 0) {
    return (
      <div className="border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-8 text-center text-sm font-bold text-[var(--pub-txt-soft)]">
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


  // 当前阶段与四个数字（标题区用）
  const allPhases = Array.from(new Set(matches.map((m) => m.phase)));
  const currentPhase = [...allPhases].reverse().find((phase) => matches.some((m) => m.phase === phase && m.status !== "已完成")) ?? allPhases[allPhases.length - 1] ?? "";
  const currentMatches = matches.filter((m) => m.phase === currentPhase);
  const currentDone = currentMatches.filter((m) => m.status === "已完成").length;
  const teamSet = (list: typeof matches) => new Set(list.flatMap((m) => [m.teamAId, m.teamBId]).filter(Boolean)).size;
  const nextPhase = allPhases[allPhases.indexOf(currentPhase) + 1];
  const nextTeams = nextPhase ? teamSet(matches.filter((m) => m.phase === nextPhase)) : 0;

  return (
    <div className="space-y-4">
      {/* 阶段标题（2026-10-20）：页面级已经有 Hero（赛事名 + 数字条），
          这一段只交代"你现在看的是哪一段"，所以压成一条带 2px 红底线的分区头，
          不再重复大标题和四个数字 —— 否则同一页会出现两级同样大的标题。 */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-[var(--pub-red)] pb-2.5">
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--pub-red)]">
              Stage {String(allPhases.indexOf(currentPhase) + 1).padStart(2, "0")} / {currentPhase || "赛程"}
            </p>
            <h2 className="mt-1.5 text-[clamp(22px,2.8vw,30px)] font-black leading-[1.1] tracking-[-0.02em] text-[var(--pub-txt)]">
              {currentPhase || "赛程"}
              <span className="text-[var(--pub-red)]">.</span>
            </h2>
          </div>
          <span className="font-mono text-[11.5px] tracking-[0.06em] text-[var(--pub-txt-mute)]">
            {currentDone} / {currentMatches.length} 场已完成
            {nextTeams ? ` · ${nextTeams} 队晋级` : ""}
          </span>
        </div>
      </section>

      {allCompleted && finalMatch && champion && runnerUp && (
        <section className="overflow-hidden border border-[var(--pub-line)] bg-[var(--pub-card)]">
          <header className="flex items-center justify-between gap-4 border-b border-[var(--pub-line-soft)] px-5 py-4 sm:px-7">
            <div>
              <p className="font-mono text-[length:var(--pub-fs-xs)] font-black tracking-[0.18em] text-[var(--pub-red)]">FINAL STANDINGS</p>
              <h3 className="mt-1 text-lg font-black text-[var(--pub-txt)]">最终排名</h3>
            </div>
            <span className="shrink-0 whitespace-nowrap border border-[#ff4655]/35 bg-[rgba(255,70,85,0.12)] px-2.5 py-1 text-[length:var(--pub-fs-xs)] font-black text-[var(--pub-red)]">赛事已结束</span>
          </header>

          <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)]">
            <div className="relative overflow-hidden border-b border-[var(--pub-line-soft)] bg-white/[0.06] px-5 py-6 sm:px-7 sm:py-7 lg:border-b-0 lg:border-r">
              <span aria-hidden className="absolute -bottom-8 right-3 font-mono text-[7rem] font-black leading-none text-[#ff4655]/[0.08] sm:right-8">01</span>
              <div className="relative">
                <p className="font-mono text-[length:var(--pub-fs-xs)] font-black tracking-[0.18em] text-[var(--pub-red)]">CHAMPION / 冠军</p>
                <h4 className="mt-3 text-3xl font-black tracking-[-0.04em] text-[var(--pub-txt)] sm:text-4xl">{champion}</h4>
                <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-black text-[var(--pub-txt-soft)]">
                  <span className="text-[var(--pub-txt-soft)]">总决赛</span>
                  <span>{champion}</span>
                  <strong className="font-mono text-lg text-[var(--pub-red)]">{championScore}:{runnerUpScore}</strong>
                  <span>{runnerUp}</span>
                </p>
              </div>
            </div>

            <dl className="grid sm:grid-cols-2 lg:grid-cols-1">
              <div className="flex min-h-24 items-center gap-4 border-b border-[var(--pub-line-soft)] p-5 sm:min-h-28 sm:border-b-0 sm:border-r sm:p-6 lg:border-b lg:border-r-0">
                <span className="font-mono text-2xl font-black text-[var(--pub-line)]">02</span>
                <div>
                  <dt className="text-[length:var(--pub-fs-xs)] font-black tracking-[0.12em] text-[var(--pub-txt-soft)]">亚军</dt>
                  <dd className="mt-1.5 text-base font-black text-[var(--pub-txt)] sm:text-lg">{runnerUp}</dd>
                </div>
              </div>
              <div className="flex min-h-28 items-center gap-4 p-5 sm:p-6">
                <span className="font-mono text-2xl font-black text-[var(--pub-line)]">03</span>
                <div>
                  <dt className="text-[length:var(--pub-fs-xs)] font-black tracking-[0.12em] text-[var(--pub-txt-soft)]">季军</dt>
                  <dd className="mt-1.5 text-base font-black text-[var(--pub-txt)] sm:text-lg">{thirdPlace ?? "—"}</dd>
                </div>
              </div>
            </dl>
          </div>
        </section>
      )}

      {/* 分组积分：**不再在外层判断"该不该出现"** —— 组件内部有完整的空态与识别逻辑。
          外层再判一次，等于两处各持一份阶段名清单，任一处漏词整块就静默消失（2026-10-21 踩过）。 */}
      {(
        <section>
          <div className="mb-2 flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[length:var(--pub-fs-xs)] font-black tracking-[0.16em] text-[var(--pub-red)]">GROUP STANDINGS</p>
              <h3 className="mt-1 text-lg font-black text-[var(--pub-txt)]">分组积分</h3>
            </div>
          </div>
          <GroupStandings matches={matches} />
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[length:var(--pub-fs-xs)] font-black tracking-[0.16em] text-[var(--pub-red)]">UPCOMING MATCHES</p>
              <h3 className="mt-1 text-lg font-black text-[var(--pub-txt)]">赛事赛程</h3>
            </div>
            {/* 同一批比赛，两种看法：列表适合扫时间，卡片适合看对阵 */}
            <div className="flex border border-[var(--pub-line)]">
              {([["list", "列表"], ["card", "卡片"]] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  aria-pressed={viewMode === mode}
                  className={`px-3 py-1 font-mono text-[length:var(--pub-fs-xs)] font-black tracking-[0.06em] transition ${
                    viewMode === mode ? "bg-white/[0.12] text-[var(--pub-txt)]" : "bg-[var(--pub-card)] text-[var(--pub-txt-soft)] hover:text-[var(--pub-txt)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {viewMode === "list" ? (
          <div className="space-y-1.5">
            {/* 表头只给列名，不做强调 */}
            <div className="hidden grid-cols-[84px_1fr_1fr_88px_1fr_92px] items-center px-1 pb-1 font-mono text-[length:var(--pub-fs-xs)] font-black uppercase tracking-[0.14em] text-[var(--pub-txt-mute)] sm:grid">
              <span>时间</span><span className="pl-3.5">阶段</span><span /><span className="text-center">比分</span><span /><span className="pr-4 text-right">距今</span>
            </div>
            {rest.map((m) => (
              <div
                key={m.id}
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-3 py-2.5 transition hover:border-[var(--pub-line)] hover:bg-white/[0.08] sm:grid-cols-[84px_1fr_1fr_88px_1fr_92px] sm:gap-0 sm:px-0 sm:py-0"
              >
                <span className="font-mono text-xs font-bold tabular-nums text-[var(--pub-txt-soft)] sm:px-3.5 sm:py-3">{fmt(m.startTime)}</span>
                <span className="col-span-2 order-3 truncate text-[length:var(--pub-fs-xs)] font-bold text-[var(--pub-txt-mute)] sm:order-none sm:col-span-1 sm:px-3.5 sm:py-3 sm:text-xs">
                  {m.phase}{m.round ? ` · ${m.round}` : ""}
                </span>
                <span className="order-1 text-[length:var(--pub-fs-md)] font-black text-[var(--pub-txt)] sm:order-none sm:border-l sm:border-[var(--pub-line-soft)] sm:px-3.5 sm:py-3 sm:text-right">{m.teamAName}</span>
                <span className="order-2 font-mono text-base font-black tabular-nums text-[var(--pub-txt-soft)] sm:order-none sm:border-l sm:border-[var(--pub-line-soft)] sm:px-2 sm:py-3 sm:text-center">— : —</span>
                <span className="order-4 text-[length:var(--pub-fs-md)] font-black text-[var(--pub-txt)] sm:order-none sm:border-l sm:border-[var(--pub-line-soft)] sm:px-3.5 sm:py-3">{m.teamBName}</span>
                <span className="order-5 justify-self-end font-mono text-[length:var(--pub-fs-xs)] font-bold text-[var(--pub-txt-mute)] sm:order-none sm:px-4 sm:py-3 sm:text-right">{relTime(m.startTime) || "待定"}</span>
              </div>
            ))}
          </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rest.map((m) => (
                <div key={m.id} className="border border-[var(--pub-line)] bg-[var(--pub-card)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-mono text-[length:var(--pub-fs-xs)] font-black text-[var(--pub-txt-mute)]">{m.id}</span>
                    <StatusChip tone={m.status === "待排期" ? "accent" : "neutral"}>
                      {m.status === "已排期" ? "待开始" : m.status}
                    </StatusChip>
                  </div>
                  <p className="mt-3 text-[length:var(--pub-fs-md)] font-black leading-snug text-[var(--pub-txt)]">
                    {m.teamAName}
                    <span className="mx-1.5 font-mono text-[length:var(--pub-fs-xs)] font-normal text-[var(--pub-txt-mute)]">VS</span>
                    {m.teamBName}
                  </p>
                  <p className="mt-2 flex items-center justify-between font-mono text-[length:var(--pub-fs-xs)] tracking-[0.06em] text-[var(--pub-txt-mute)]">
                    <span>{m.boType} · {m.phase}</span>
                    <span>{fmt(m.startTime)}</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}


      {completed.length > 0 && (
        <section>
          <div className="mb-2 flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[length:var(--pub-fs-xs)] font-black tracking-[0.16em] text-[var(--pub-red)]">MATCH RESULTS</p>
              <h3 className="mt-1 text-lg font-black text-[var(--pub-txt)]">比赛结果</h3>
            </div>
            <span className="font-mono text-[length:var(--pub-fs-xs)] font-black text-[var(--pub-txt-soft)]">{completed.length} MATCHES</span>
          </div>
          <div className="space-y-2">
            {completedPhases.map((phase) => {
              const phaseMatches = completed.filter((match) => match.phase === phase);
              return (
                <details key={phase} open={phase === latestCompletedPhase} className="group border border-[var(--pub-line-soft)] bg-[var(--pub-card)]">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-4 bg-white/[0.06] px-4 py-2.5 transition hover:bg-[var(--pub-line-soft)]">
                    <span className="text-sm font-black text-[var(--pub-txt)]">{phase}</span>
                    <span className="flex items-center gap-4">
                      <span className="font-mono text-[length:var(--pub-fs-xs)] font-black text-[var(--pub-txt-soft)]">{phaseMatches.length} 场</span>
                      <span aria-hidden className="text-lg font-black text-[var(--pub-red)] transition group-open:rotate-45">＋</span>
                    </span>
                  </summary>
                  <div className="divide-y divide-[var(--pub-line-soft)] border-t border-[var(--pub-line-soft)]">
                    {phaseMatches.map((m) => {
                      const a = winCount(m.gameResults, "A");
                      const b = winCount(m.gameResults, "B");
                      const aWon = a > b;
                      return (
                        <div key={m.id} className="px-3 py-2.5 transition hover:bg-white/[0.03]">
                          {/* 与未开赛列表同一套列顺序，赢家加亮、输家压暗 */}
                          <div className="grid items-center gap-x-3 gap-y-0.5 sm:grid-cols-[84px_1fr_1fr_88px_1fr_92px] sm:gap-0">
                            <span className="font-mono text-[length:var(--pub-fs-xs)] font-bold tabular-nums text-[var(--pub-txt-mute)] sm:px-1">{fmt(m.startTime) || "—"}</span>
                            <span className="truncate text-[length:var(--pub-fs-xs)] font-bold text-[var(--pub-txt-mute)] sm:px-1.5">{m.round || m.boType}</span>
                            <span className={`truncate text-[length:var(--pub-fs-md)] font-black sm:px-1.5 sm:text-right ${aWon ? "text-[var(--pub-txt)]" : "text-[var(--pub-txt-mute)]"}`}>{m.teamAName}</span>
                            <span className={`text-center font-mono text-base font-black tabular-nums ${aWon ? "text-[var(--pub-red)]" : "text-[var(--pub-txt-soft)]"}`}>{a} : {b}</span>
                            <span className={`truncate text-[length:var(--pub-fs-md)] font-black sm:px-1.5 ${aWon ? "text-[var(--pub-txt-mute)]" : "text-[var(--pub-txt)]"}`}>{m.teamBName}</span>
                            <span className="justify-self-end font-mono text-[length:var(--pub-fs-xs)] font-bold text-[var(--pub-txt-mute)] sm:px-1 sm:text-right">{relTime(m.startTime)}</span>
                          </div>
                          {m.gameResults && m.gameResults.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {m.gameResults.map((g, i) => (
                                <span key={i} className="border border-[var(--pub-line-soft)] px-1.5 py-0.5 font-mono text-[length:var(--pub-fs-xs)] font-bold text-[var(--pub-txt-mute)]">
                                  {g.map || `第${i + 1}局`} {g.teamAScore}:{g.teamBScore}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
