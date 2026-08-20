"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useSchedule } from "@/lib/scheduling/useSchedule";
import { validateGames, maxGames, winTarget } from "@/lib/scheduling/schedule-ops";
import type { ScheduleMatch, GameResult } from "@/lib/scheduling/schedule-data";
import type { ValidationResult } from "@/lib/scheduling/rule-engine";
import type { BPSession } from "@/lib/scheduling/bp-ops";

interface SchedulePageProps {
  params: Promise<{ id: string }>;
}

function fmt(iso: string): string {
  if (!iso) return "";
  return iso.slice(5, 16).replace("T", " ");
}

function winCount(gameResults: GameResult[] | undefined, side: "A" | "B"): number {
  if (!gameResults) return 0;
  return gameResults.filter((g) => (side === "A" ? g.teamAScore > g.teamBScore : g.teamBScore > g.teamAScore)).length;
}

type DialogMode = "overview" | "schedule" | "reschedule" | "report";

/** 对阵图卡片：点击弹出比赛操作面板 */
function BracketCard({ m, bp, onClick }: { m: ScheduleMatch; bp?: BPSession; onClick: () => void }) {
  const completed = m.status === "已完成";
  const aWin = completed && m.winnerTeamId === m.teamAId;
  const bWin = completed && m.winnerTeamId === m.teamBId;
  const borderCls = m.frozen
    ? "border-slate-200"
    : completed
      ? "border-emerald-300"
      : m.status === "待排期"
        ? "border-amber-300"
        : "border-[#ff4655]/40";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-36 shrink-0 border bg-white p-2 text-left transition hover:border-slate-950 ${borderCls}`}
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <span className="font-mono text-[0.5625rem] font-bold text-slate-400">{m.id} · {m.boType}</span>
        {m.frozen ? (
          <span className="border border-slate-200 bg-slate-100 px-1 text-[0.5rem] font-bold text-slate-500">冻结</span>
        ) : completed ? (
          <span className="border border-emerald-200 bg-emerald-50 px-1 text-[0.5rem] font-bold text-emerald-700">已完成</span>
        ) : m.status === "待排期" ? (
          <span className="border border-amber-200 bg-amber-50 px-1 text-[0.5rem] font-bold text-amber-700">待排期</span>
        ) : (
          <span className="border border-[#ff4655]/25 bg-[#fff1f2] px-1 text-[0.5rem] font-bold text-[#c83242]">待开始</span>
        )}
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-1">
          <span className={`truncate text-[0.6875rem] ${aWin ? "font-bold text-slate-950" : "text-slate-600"}`}>{m.teamAName || "待定"}</span>
          {completed && <span className={`font-mono text-[0.6875rem] font-bold ${aWin ? "text-[#ff4655]" : "text-slate-400"}`}>{winCount(m.gameResults, "A")}</span>}
        </div>
        {!completed && m.teamAName && m.teamBName && <div className="text-center text-[0.5625rem] leading-3 text-slate-300">VS</div>}
        <div className="flex items-center justify-between gap-1">
          <span className={`truncate text-[0.6875rem] ${bWin ? "font-bold text-slate-950" : "text-slate-600"}`}>{m.teamBName || "待定"}</span>
          {completed && <span className={`font-mono text-[0.6875rem] font-bold ${bWin ? "text-[#ff4655]" : "text-slate-400"}`}>{winCount(m.gameResults, "B")}</span>}
        </div>
      </div>
      <div className="mt-1 border-t border-slate-100 pt-1 text-[0.5625rem] text-slate-400">
        {m.startTime ? fmt(m.startTime) : "未排期"}
        {m.status === "已排期" && bp ? (bp.status === "已完成" ? " · BP✓" : bp.status === "进行中" ? ` · BP ${bp.actions.length}/${bp.order.length}` : " · BP未开始") : ""}
      </div>
    </button>
  );
}

/** 对阵图：按阶段 → 轮次横向排布 */
function Bracket({ matches, bpSessions, onSelect }: { matches: ScheduleMatch[]; bpSessions: Record<string, BPSession>; onSelect: (m: ScheduleMatch) => void }) {
  const phases: string[] = [];
  for (const m of matches) {
    if (!phases.includes(m.phase)) phases.push(m.phase);
  }
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex flex-col gap-4">
        {phases.map((phase) => {
          const phaseMatches = matches.filter((m) => m.phase === phase);
          const rounds: string[] = [];
          for (const m of phaseMatches) {
            const r = m.round ?? "未分组";
            if (!rounds.includes(r)) rounds.push(r);
          }
          return (
            <div key={phase}>
              <h3 className="mb-2 font-mono text-[0.625rem] font-black tracking-[0.12em] text-slate-500">{phase}</h3>
              <div className="flex gap-2 min-w-max">
                {rounds.map((round) => {
                  const roundMatches = phaseMatches.filter((m) => (m.round ?? "未分组") === round);
                  return (
                    <div key={round} className="flex flex-col gap-2">
                      <div className="text-[0.5625rem] font-bold text-slate-400">{round}</div>
                      {roundMatches.map((m) => (
                        <BracketCard key={m.id} m={m} bp={bpSessions[m.id]} onClick={() => onSelect(m)} />
                      ))}
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

export default function SchedulePage({ params }: SchedulePageProps) {
  const { id } = use(params);
  const { state, submitRequest, approveRequest, toggleFrozen, setMatchTime, reportGameResults, reset } = useSchedule(id);

  const [selected, setSelected] = useState<ScheduleMatch | null>(null);
  const [mode, setMode] = useState<DialogMode>("overview");

  // 排期
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleResult, setScheduleResult] = useState<ValidationResult | null>(null);

  // 改期
  const [newTime, setNewTime] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // 报分
  const [games, setGames] = useState<GameResult[]>([]);
  const [reportMaps, setReportMaps] = useState<string[]>([]);
  const [scoreError, setScoreError] = useState("");

  // BP 会话（卡片徽标 + 报分选图）
  const [bpSessions, setBpSessions] = useState<Record<string, BPSession>>({});
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/data/bp", { cache: "no-store" })
        .then((r) => r.json())
        .then((json: { sessions?: Record<string, BPSession> }) => {
          if (!cancelled) setBpSessions(json.sessions ?? {});
        })
        .catch(() => {
          // 忽略
        });
    };
    load();
    const timer = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  function openMatch(m: ScheduleMatch) {
    setSelected(m);
    setMode("overview");
    setScheduleTime("");
    setScheduleResult(null);
    setNewTime(m.startTime ? m.startTime.slice(0, 16) : "");
    setReason("");
    setResult(null);
    setSubmitted(false);
    setScoreError("");
    setGames([{ map: "", teamAScore: 0, teamBScore: 0 }]);
    setReportMaps(m.bpMaps ?? []);
    fetch(`/api/data/bp?matchId=${encodeURIComponent(m.id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: { session?: { finalMaps?: string[] } | null }) => {
        const maps = json.session?.finalMaps ?? m.bpMaps ?? [];
        setReportMaps(maps);
        setGames((g) => g.map((game, i) => ({ ...game, map: maps[i] ?? game.map })));
      })
      .catch(() => {
        // 保持 bpMaps 兜底
      });
  }

  function handleScheduleSubmit() {
    if (!selected) return;
    const t = scheduleTime.length === 16 ? `${scheduleTime}:00` : scheduleTime;
    const r = setMatchTime(selected.id, t);
    setScheduleResult(r);
    if (r.approved) {
      const updated = state.matches.find((m) => m.id === selected.id);
      setSelected(null);
      if (updated) openMatch(updated);
    }
  }

  function handleRescheduleSubmit() {
    if (!selected) return;
    const t = newTime.length === 16 ? `${newTime}:00` : newTime;
    const r = submitRequest(selected.id, t, reason, true, true);
    setResult(r);
    setSubmitted(true);
    if (r.approved) {
      // 负责人代录：校验通过即进入审批队列；直接批准
      const match = state.matches.find((m) => m.id === selected.id);
      if (match) {
        const pending = state.requests.find((q) => q.matchId === selected.id && q.status === "待审批");
        if (pending) {
          const appr = approveRequest(pending.id);
          if (appr && appr.approved) {
            setSelected(null);
            return;
          }
        }
      }
      setMode("overview");
    }
  }

  function addGame() {
    if (!selected) return;
    setGames((g) => {
      if (g.length >= maxGames(selected.boType)) return g;
      return [...g, { map: "", teamAScore: 0, teamBScore: 0 }];
    });
  }

  function updateGame(index: number, patch: Partial<GameResult>) {
    setGames((g) => g.map((game, i) => (i === index ? { ...game, ...patch } : game)));
  }

  function handleReport() {
    if (!selected) return;
    const check = validateGames(games, selected.boType);
    if (!check.ok) {
      setScoreError(check.message ?? "比分不合法，请完整录入");
      return;
    }
    const out = reportGameResults(selected.id, games);
    if (!out.ok) {
      setScoreError(out.message ?? "报分失败");
      return;
    }
    setSelected(null);
  }

  const doneCount = state.matches.filter((m) => m.status === "已完成").length;

  return (
    <div>
      <AdminPageHeader
        eyebrow="MODULE 03 / SCHEDULE"
        title="赛程"
        description={state.matches.length === 0 ? "尚未抽签。点「开始抽签」进入抽签面板。" : `对阵图 · ${state.matches.length} 场 · 已完成 ${doneCount} 场`}
        status={`赛程 v${state.version}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/admin/events/${id}/schedule/draw`} className="bg-[#ff4655] px-4 py-2.5 text-xs font-black text-white transition hover:bg-[#d83b48]">开始抽签</Link>
            <button onClick={reset} className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 hover:border-slate-950">重置</button>
          </div>
        }
      />

      {state.matches.length === 0 ? (
        <section className="border border-slate-200 bg-white p-16 text-center">
          <p className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-[#c83242]">BRACKET EMPTY</p>
          <p className="mt-4 text-sm font-bold text-slate-700">对阵图还是空的</p>
          <p className="mt-2 text-xs text-slate-500">抽签会把报名队伍逐队填进对阵图，生成初始第一轮。</p>
        </section>
      ) : (
        <section className="border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-950">对阵图</h2>
            <span className="text-[0.625rem] text-slate-400">点比赛卡片操作</span>
          </div>
          <Bracket matches={state.matches} bpSessions={bpSessions} onSelect={openMatch} />
        </section>
      )}

      {/* 比赛操作面板 */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-black">{selected.id} · {selected.phase}</h2>
              <button onClick={() => setSelected(null)} className="text-slate-400">关闭</button>
            </div>

            {/* 概览模式 */}
            {mode === "overview" && (
              <div className="space-y-4 p-5">
                <p className="text-base font-black text-slate-950">{selected.teamAName} vs {selected.teamBName}</p>
                <p className="text-xs text-slate-500">{selected.boType} · {selected.round} · {selected.startTime ? fmt(selected.startTime) : "未排期"}</p>
                {selected.status === "已完成" && selected.winnerTeamId && (
                  <div className="border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">
                    胜者：{selected.winnerTeamId === selected.teamAId ? selected.teamAName : selected.teamBName}
                    {selected.gameResults && (
                      <span className="ml-2 font-mono">{winCount(selected.gameResults, "A")} : {winCount(selected.gameResults, "B")}</span>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {selected.status === "待排期" && (
                    <button onClick={() => setMode("schedule")} className="bg-[#ff4655] px-4 py-2.5 text-xs font-bold text-white">排期</button>
                  )}
                  {selected.status === "已排期" && (
                    <>
                      <Link href={`/bp/${selected.id}`} className="border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700">去 BP</Link>
                      <button onClick={() => setMode("report")} className="bg-[#ff4655] px-4 py-2.5 text-xs font-bold text-white">报分</button>
                      <button onClick={() => setMode("reschedule")} className="border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700">改期</button>
                    </>
                  )}
                  <button
                    onClick={() => toggleFrozen(selected.id)}
                    className={`border px-4 py-2.5 text-xs font-bold ${selected.frozen ? "border-emerald-200 text-emerald-700" : "border-slate-300 text-slate-500"}`}
                  >
                    {selected.frozen ? "解冻" : "冻结"}
                  </button>
                </div>
              </div>
            )}

            {/* 排期模式 */}
            {mode === "schedule" && (
              <div className="space-y-4 p-5">
                <p className="text-sm font-bold text-slate-900">{selected.teamAName} vs {selected.teamBName}（{selected.boType}）</p>
                <input type="datetime-local" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} className="w-full border border-slate-300 px-3 py-2 text-sm" />
                {scheduleResult && !scheduleResult.approved && (
                  <div className="border border-red-200 bg-red-50 p-4">
                    <p className="text-sm font-bold text-red-700">✗ 排期被拦截</p>
                    <ul className="mt-2 space-y-1">
                      {scheduleResult.conflicts.map((c) => (
                        <li key={c.code} className="text-xs text-red-600">[{c.code}] {c.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setMode("overview")} className="border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-600">取消</button>
                  <button onClick={handleScheduleSubmit} className="bg-[#ff4655] px-4 py-2.5 text-xs font-bold text-white">排期并校验</button>
                </div>
              </div>
            )}

            {/* 改期模式 */}
            {mode === "reschedule" && (
              <div className="space-y-4 p-5">
                <p className="text-sm font-bold text-slate-900">{selected.teamAName} vs {selected.teamBName}（{selected.boType}）</p>
                <input type="datetime-local" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="w-full border border-slate-300 px-3 py-2 text-sm" />
                <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="改期原因" className="w-full border border-slate-300 px-3 py-2 text-sm" />
                {submitted && result && (
                  <div className={`border p-4 ${result.approved ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                    {result.approved ? (
                      <p className="text-sm font-bold text-emerald-700">✓ 校验通过</p>
                    ) : (
                      <div>
                        <p className="text-sm font-bold text-red-700">✗ 存在冲突</p>
                        <ul className="mt-2 space-y-1">
                          {result.conflicts.map((c) => (
                            <li key={c.code} className="text-xs text-red-600">[{c.code}] {c.message}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setMode("overview")} className="border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-600">取消</button>
                  <button onClick={handleRescheduleSubmit} className="bg-[#ff4655] px-4 py-2.5 text-xs font-bold text-white">提交并校验</button>
                </div>
              </div>
            )}

            {/* 报分模式 */}
            {mode === "report" && (
              <div className="space-y-4 p-5">
                <p className="text-sm font-bold text-slate-900">{selected.teamAName} vs {selected.teamBName}（{selected.boType}）</p>
                {games.map((game, index) => (
                  <div key={index} className="border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[0.625rem] font-bold text-slate-500">第 {index + 1} 局</span>
                      <span className="text-[0.625rem] text-slate-400">
                        胜者：{game.teamAScore === game.teamBScore ? "—" : game.teamAScore > game.teamBScore ? selected.teamAName : selected.teamBName}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-[1fr_1fr_1fr] gap-2">
                      {reportMaps.length > 0 ? (
                        <select value={game.map ?? ""} onChange={(e) => updateGame(index, { map: e.target.value })} className="border border-slate-300 px-2 py-1.5 text-xs">
                          <option value="">选择地图</option>
                          {reportMaps.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      ) : (
                        <input type="text" value={game.map ?? ""} onChange={(e) => updateGame(index, { map: e.target.value })} placeholder="地图" className="border border-slate-300 px-2 py-1.5 text-xs" />
                      )}
                      <input type="number" min="0" value={game.teamAScore} onChange={(e) => updateGame(index, { teamAScore: Number(e.target.value) })} placeholder={selected.teamAName} className="border border-slate-300 px-2 py-1.5 text-xs" />
                      <input type="number" min="0" value={game.teamBScore} onChange={(e) => updateGame(index, { teamBScore: Number(e.target.value) })} placeholder={selected.teamBName} className="border border-slate-300 px-2 py-1.5 text-xs" />
                    </div>
                  </div>
                ))}
                <button onClick={addGame} disabled={games.length >= maxGames(selected.boType)} className={`text-xs font-bold ${games.length >= maxGames(selected.boType) ? "cursor-not-allowed text-slate-300" : "text-[#c83242]"}`}>
                  ＋ 加一局（最多 {maxGames(selected.boType)} 局）
                </button>
                <p className="text-[0.625rem] text-slate-400">
                  当前 {winCount(games, "A")} : {winCount(games, "B")}，需一方先达到 {winTarget(selected.boType)} 胜局
                </p>
                {scoreError && <p className="text-xs text-red-600">{scoreError}</p>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setMode("overview")} className="border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-600">取消</button>
                  <button onClick={handleReport} className="bg-[#ff4655] px-4 py-2.5 text-xs font-bold text-white">确认报分</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
