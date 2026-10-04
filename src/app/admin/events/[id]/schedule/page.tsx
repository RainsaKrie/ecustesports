"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useSchedule } from "@/lib/scheduling/useSchedule";
import { validateGames, maxGames, winTarget } from "@/lib/scheduling/schedule-ops";
import type { ScheduleMatch, GameResult } from "@/lib/scheduling/schedule-data";
import type { ValidationResult } from "@/lib/scheduling/rule-engine";
import type { BPSession } from "@/lib/scheduling/bp-ops";
import TournamentBracketCanvas, { advancementPath } from "@/components/events/TournamentBracketCanvas";
import { bracketDataIssue, buildBracketBlueprint } from "@/lib/scheduling/bracket-blueprint";
import type { EditableEvent } from "@/lib/site-config-schema";

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
  const advancement = advancementPath(m);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full border bg-white p-2 text-left transition hover:border-slate-950 ${borderCls}`}
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
      {advancement && <div className="mt-1 font-mono text-[0.45rem] text-slate-400">{advancement}</div>}
    </button>
  );
}

function BlueprintCard({ m }: { m: ScheduleMatch }) {
  const advancement = advancementPath(m);
  return (
    <div className="border border-dashed border-slate-300 bg-white p-2.5" aria-label={`${m.id} 待抽签签位`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[0.5625rem] font-bold text-slate-400">{m.id} · {m.boType}</span>
        <span className="border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[0.5rem] font-bold text-slate-500">待抽签</span>
      </div>
      <div className="space-y-1.5">
        <div className="border-b border-slate-100 pb-1.5 text-[0.6875rem] font-bold text-slate-400">签位 A</div>
        <div className="text-[0.6875rem] font-bold text-slate-400">签位 B</div>
      </div>
      <div className="mt-2 border-t border-slate-100 pt-1.5 font-mono text-[0.5rem] text-slate-400">
        {advancement ?? "抽签后生成正式对阵"}
      </div>
    </div>
  );
}

/** 对阵图：按阶段 → 轮次横向排布 */
function Bracket({ matches, bpSessions, onSelect }: { matches: ScheduleMatch[]; bpSessions: Record<string, BPSession>; onSelect: (m: ScheduleMatch) => void }) {
  return (
    <TournamentBracketCanvas
      matches={matches}
      renderMatch={(match) => <BracketCard m={match} bp={bpSessions[match.id]} onClick={() => onSelect(match)} />}
    />
  );
}

export default function SchedulePage({ params }: SchedulePageProps) {
  const { id } = use(params);
  const { state, approveRequest, rejectRequest, toggleFrozen, setMatchTime, reportGameResults, reset, updateConfig, confirmConfig, refresh, saveError } = useSchedule(id, "admin");
  const [eventConfig, setEventConfig] = useState<EditableEvent | null>(null);

  const [selected, setSelected] = useState<ScheduleMatch | null>(null);
  const [mode, setMode] = useState<DialogMode>("overview");
  const [pendingReviewCount, setPendingReviewCount] = useState(0);

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
      fetch(`/api/data/bp?eventId=${encodeURIComponent(id)}`, { cache: "no-store" })
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
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/site-config", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("赛事配置读取失败")))
      .then((config: { events?: EditableEvent[] }) => {
        if (!cancelled) setEventConfig(config.events?.find((event) => event.id === id) ?? null);
      })
      .catch(() => {
        if (!cancelled) setEventConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 异常赛果待裁决数（仅作入口徽标，0 则不显示）
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/review?eventId=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("异常队列读取失败")))
      .then((data: { queue?: unknown[] }) => {
        if (!cancelled) setPendingReviewCount(Array.isArray(data.queue) ? data.queue.length : 0);
      })
      .catch(() => {
        if (!cancelled) setPendingReviewCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  /**
   * 批准一条约赛申请。
   *
   * `ownerAttests` 为 true 时表示申请还停在「待对手确认」——
   * 也就是实际流程里最常见的情况：两个队长在群里商定好了，一方到平台填时间，
   * 对手不会再上来点确认。此时由负责人核对后直接落库，
   * 记录上会留下 ownerAttestedAt，不去伪造对手的确认。
   */
  function handleApproveRequest(requestId: string, ownerAttests: boolean) {
    if (ownerAttests) {
      const request = state.requests.find((item) => item.id === requestId);
      const when = request ? request.newStartTime.replace("T", " ") : "";
      if (!window.confirm(`确认双方已经在群内商定「${when}」？\n\n确认后赛程会直接更新，并在版本记录里标明由你核对。`)) return;
    }
    const outcome = approveRequest(requestId, { ownerAttestsBothTeams: ownerAttests });
    if (!outcome) {
      window.alert("申请已失效或已被处理，请刷新后重试。");
      return;
    }
    if (!outcome.approved) {
      window.alert(outcome.conflicts.map((item) => item.message).join("\n") || "该时间与现有排程冲突，请在下方调整。");
    }
  }

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
    fetch(`/api/data/bp?eventId=${encodeURIComponent(id)}&matchId=${encodeURIComponent(m.id)}`, { cache: "no-store" })
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
    const r = setMatchTime(selected.id, t, reason);
    setResult(r);
    setSubmitted(true);
    if (r.approved) {
      setSelected(null);
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
  const blueprintMatches = useMemo(
    () => buildBracketBlueprint(eventConfig?.stageConfigs ?? []),
    [eventConfig],
  );
  const dataIssue = useMemo(
    () => bracketDataIssue(state.matches, eventConfig?.stageConfigs ?? []),
    [eventConfig, state.matches],
  );
  const showingBlueprint = state.matches.length === 0 && blueprintMatches.length > 0;
  const activeRequests = state.requests.filter((request) => ["待对手确认", "待审批"].includes(request.status));
  const eventLocked = eventConfig?.status === "completed" || eventConfig?.status === "archived";

  return (
    <div>
      <AdminPageHeader
        eyebrow="MODULE 02 / SCHEDULE"
        title="赛程"
        description={dataIssue
          ? undefined
          : showingBlueprint
            ? `${blueprintMatches.length} 个比赛签位 · 待抽签`
            : state.matches.length === 0
              ? "暂无赛程"
              : `对阵图 · ${state.matches.length} 场 · 已完成 ${doneCount} 场`}
        status={`赛程 v${state.version}`}
        actions={eventLocked ? undefined :
          <div className="flex gap-2">
            <button type="button" onClick={() => void refresh()} className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-600">刷新数据</button>
            <Link href={`/admin/events/${id}/schedule/draw`} className="bg-[#ff4655] px-4 py-2.5 text-xs font-black text-white transition hover:bg-[#d83b48]">开始抽签</Link>
            <Link href={`/admin/events/${id}/referees`} className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 hover:border-slate-950">裁判管理</Link>
            <Link href={`/admin/events/${id}/review`} className="flex items-center gap-2 border border-[#ff4655]/40 bg-[#fff1f2] px-4 py-2.5 text-xs font-black text-[#c83242] transition hover:bg-[#ff4655] hover:text-white">
              异常赛果
              {pendingReviewCount > 0 && <span className="bg-[#ff4655] px-1.5 py-0.5 text-[0.625rem] font-bold text-white">{pendingReviewCount}</span>}
            </Link>
            {state.matches.length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm("当前赛程会保留在版本历史中，并返回抽签前状态。确认继续？")) reset();
                }}
                className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 hover:border-slate-950"
              >
                归档并重抽
              </button>
            )}
          </div>
        }
      />

      {saveError && (
        <div className="mb-5 border border-[#ff4655] bg-[#fff1f2] px-5 py-3 text-sm font-bold text-[#9f2431]">
          {saveError}
        </div>
      )}

      {eventLocked ? (
        <section className="mb-5 flex min-h-20 items-center justify-between gap-4 border border-black/10 bg-[#fffdf8] px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <span aria-hidden className="h-10 w-1 shrink-0 bg-[#ff4655]" />
            <div className="min-w-0">
              <p className="font-mono text-[0.5625rem] font-black tracking-[0.16em] text-[#c83242]">SCHEDULING LIMITS</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="text-base font-black text-[#171a1f]">排程约束</h2>
                <p className="text-[0.625rem] font-bold text-[#575c62]">{fmt(state.config.stageStart)}—{fmt(state.config.stageEnd)} · 同时最多 {state.config.maxConcurrentMatches} 场</p>
              </div>
            </div>
          </div>
          <span className="shrink-0 border border-slate-300 bg-slate-50 px-2 py-1 text-[0.5625rem] font-black text-slate-600">已锁定</span>
        </section>
      ) : (
      <details className="mb-5 border border-black/10 bg-[#fffdf8]">
        <summary className="flex min-h-20 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <span aria-hidden className="h-10 w-1 shrink-0 bg-[#ff4655]" />
            <div className="min-w-0">
              <p className="font-mono text-[0.5625rem] font-black tracking-[0.16em] text-[#c83242]">SCHEDULING LIMITS</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="text-base font-black text-[#171a1f]">排程约束</h2>
                <p className="text-[0.625rem] font-bold text-[#575c62]">{fmt(state.config.stageStart)}—{fmt(state.config.stageEnd)} · 同时最多 {state.config.maxConcurrentMatches} 场</p>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className={`border px-2 py-1 text-[0.5625rem] font-black ${state.configConfirmed ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-[#ff4655]/40 bg-[#fff1f2] text-[#c83242]"}`}>{state.configConfirmed ? "已确认" : "待确认"}</span>
            <span className="hidden text-xs font-black text-[#34383f] sm:inline">展开设置 ↓</span>
          </div>
        </summary>
        <div className="grid gap-4 border-t border-black/10 bg-[#f2eee6] p-5 sm:p-6 md:grid-cols-[1fr_1fr_10rem]">
          <label className="text-xs font-black text-[#34383f]">允许开始时间<input type="datetime-local" value={state.config.stageStart.slice(0, 16)} onChange={(event) => updateConfig({ stageStart: `${event.target.value}:00` })} className="mt-2 h-12 w-full border border-black/15 bg-[#fffdf8] px-3 text-sm font-bold text-[#171a1f] outline-none transition focus:border-[#ff4655] focus:ring-2 focus:ring-[#ff4655]/15" /></label>
          <label className="text-xs font-black text-[#34383f]">允许结束时间<input type="datetime-local" value={state.config.stageEnd.slice(0, 16)} onChange={(event) => updateConfig({ stageEnd: `${event.target.value}:00` })} className="mt-2 h-12 w-full border border-black/15 bg-[#fffdf8] px-3 text-sm font-bold text-[#171a1f] outline-none transition focus:border-[#ff4655] focus:ring-2 focus:ring-[#ff4655]/15" /></label>
          <label className="text-xs font-black text-[#34383f]">最大同时比赛数<input type="number" min="1" max="12" value={state.config.maxConcurrentMatches} onChange={(event) => updateConfig({ maxConcurrentMatches: Math.max(1, Number(event.target.value) || 1) })} className="mt-2 h-12 w-full border border-black/15 bg-[#fffdf8] px-3 text-sm font-bold text-[#171a1f] outline-none transition focus:border-[#ff4655] focus:ring-2 focus:ring-[#ff4655]/15" /></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-black/10 bg-[#fffdf8] px-5 py-4 sm:px-6">
          <p className="flex items-center gap-2 text-xs font-bold text-[#575c62]"><span aria-hidden className="h-1.5 w-1.5 bg-[#ff4655]" />修改约束后须重新确认，确认前暂停队长约赛。</p>
          <button type="button" onClick={confirmConfig} className="min-h-12 bg-[#ff4655] px-5 py-3 text-xs font-black text-white transition hover:bg-[#d83b48]">{state.configConfirmed ? "重新确认排程约束" : "确认排程约束"}</button>
        </div>
      </details>
      )}

      {!eventLocked && activeRequests.length > 0 && (
        <section className="mb-5 border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <p className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-[#c83242]">MATCH COORDINATION</p>
              <h2 className="mt-1 text-sm font-black text-slate-950">约赛审批</h2>
            </div>
            {/* 与顶部工具条的「刷新数据」是同一个操作，只是放在手边。
                刻意做成文字按钮而不是第二个按钮——避免看起来像两件事。 */}
            <button
              type="button"
              onClick={() => void refresh()}
              title="与页面顶部的「刷新数据」是同一个操作"
              className="inline-flex min-h-11 items-center px-2 text-xs font-bold text-slate-500 underline underline-offset-4 hover:text-[#c83242]"
            >
              刷新
            </button>
          </div>
          <div className="p-5">
            <div>
              <h3 className="text-xs font-black text-slate-700">进行中的约赛 · {activeRequests.length}</h3>
              {activeRequests.length === 0 ? <p className="mt-3 text-xs text-slate-400">暂无约赛申请</p> : (
                <div className="mt-3 space-y-3">
                  {activeRequests.map((request) => {
                    const match = state.matches.find((item) => item.id === request.matchId);
                    const awaitingOpponent = request.status === "待对手确认";
                    return <div key={request.id} className="border border-[#ff4655]/35 bg-[#fff7f7] p-4">
                      <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black text-slate-950">{match?.teamAName} vs {match?.teamBName}</p><p className="mt-1 text-xs text-slate-600">{fmt(request.newStartTime)} · {request.reason || "双方协商时间"}</p></div><span className="text-[0.625rem] font-bold text-[#c83242]">{request.status}</span></div>
                      {awaitingOpponent && (
                        <p className="mt-2 text-[0.6875rem] leading-5 text-slate-500">
                          对手还没在平台上点确认。若双方已在群里商定，可直接按此时间排期——记录会标明是负责人核对的。
                        </p>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button onClick={() => rejectRequest(request.id)} className="inline-flex min-h-11 items-center border border-slate-300 px-3 text-xs font-bold text-slate-600">驳回</button>
                        <button onClick={() => handleApproveRequest(request.id, awaitingOpponent)} className="inline-flex min-h-11 items-center bg-[#ff4655] px-3 text-xs font-black text-white">
                          {awaitingOpponent ? "按此时间排期" : "批准并更新赛程"}
                        </button>
                      </div>
                    </div>;
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {dataIssue ? (
        <section className="border border-amber-300 bg-amber-50 p-6">
          <p className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-amber-800">BRACKET DATA REVIEW</p>
          <h2 className="mt-3 text-base font-black text-slate-950">当前数据无法生成对阵图</h2>
          <p className="mt-2 text-xs font-medium leading-6 text-slate-700">{dataIssue}</p>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("旧赛程会保留在版本历史中，当前对阵将被清空。确认重新抽签？")) reset();
            }}
            className="mt-5 bg-[#ff4655] px-5 py-3 text-xs font-black text-white"
          >
            归档旧赛程并返回抽签
          </button>
        </section>
      ) : state.matches.length === 0 ? (
        <section className="border border-slate-200 bg-white p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <p className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-[#c83242]">BRACKET BLUEPRINT</p>
              <h2 className="mt-2 text-sm font-black text-slate-950">抽签前对阵骨架</h2>
            </div>
          </div>
          {blueprintMatches.length > 0 ? (
            <TournamentBracketCanvas
              matches={blueprintMatches}
              renderMatch={(match) => <BlueprintCard m={match} />}
            />
          ) : (
            <p className="py-10 text-center text-xs font-bold text-slate-500">请先在赛事设置中完成可执行赛制配置。</p>
          )}
        </section>
      ) : (
        <section className="border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-950">对阵图</h2>
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
                      <Link href={`/bp/${selected.id}?eventId=${encodeURIComponent(id)}`} className="border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700">去 BP</Link>
                      <button onClick={() => setMode("report")} className="bg-[#ff4655] px-4 py-2.5 text-xs font-bold text-white">报分</button>
                      <button onClick={() => setMode("reschedule")} className="border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700">负责人调整</button>
                    </>
                  )}
                  {!eventLocked && <button
                    onClick={() => toggleFrozen(selected.id)}
                    className={`border px-4 py-2.5 text-xs font-bold ${selected.frozen ? "border-emerald-200 text-emerald-700" : "border-slate-300 text-slate-500"}`}
                  >
                    {selected.frozen ? "解冻" : "冻结"}
                  </button>}
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
                  <button onClick={handleRescheduleSubmit} className="bg-[#ff4655] px-4 py-2.5 text-xs font-bold text-white">确认调整并校验</button>
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
                <p className="text-[0.625rem] text-slate-500">大比分 {winCount(games, "A")} : {winCount(games, "B")} · 先到 {winTarget(selected.boType)} 胜</p>
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
