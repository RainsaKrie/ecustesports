"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useSchedule } from "@/hooks/useSchedule";
import { getGameConfig } from "@/lib/games";

/** 赛事地图池（当前游戏的图池）。BP 未完成时用它兜底，保证地图始终是下拉而不是手填。 */
const MAP_POOL = getGameConfig().maps.map((map) => map.name);
import { formatSyncedAgo, formatSyncedClock } from "@/lib/domains/schedule/schedule-freshness";
import { validateGames, maxGames, winTarget } from "@/lib/domains/schedule/schedule-ops";
import type { ScheduleMatch, GameResult } from "@/lib/domains/schedule/schedule-data";
import type { ValidationResult } from "@/lib/domains/schedule/rule-engine";
import type { BPSession } from "@/lib/domains/schedule/bp-ops";
import TournamentBracketCanvas from "@/components/events/TournamentBracketCanvas";
import { Bracket, BracketCard, BlueprintCard, fmt, winCount } from "./SchedulePanels";
import { bracketDataIssue, buildBracketBlueprint } from "@/lib/domains/schedule/bracket-blueprint";
import { SCHEDULE_MODE_LABELS, scheduleModeOf, unscheduledAnomalyNotice } from "@/lib/domains/schedule/schedule-mode";
import { planBulkSchedule } from "@/lib/domains/schedule/bulk-schedule";
import type { TeamSlot } from "@/lib/domains/schedule/team-swap";
import { partitionSchedulable, schedulePlanInputFromEvent } from "@/lib/domains/schedule/schedule-policy";
import type { EditableEvent } from "@/lib/site-config-schema";
import { useAdminConfirm, useAdminToast, adminInputClass, adminSelectClass, AdminModal, EmptyState, ContextBar, type AdminBadgeTone } from "@/components/admin/ui";

interface SchedulePageProps {
  params: Promise<{ id: string }>;
}

type DialogMode = "overview" | "schedule" | "reschedule" | "report";

/**
 * 「N 分钟前」的自走频率。
 *
 * 取 15 秒：比后台轮询（30 秒）略快，让「刚刚」及时翻页，又不至于为了
 * 一个相对时间把整个对阵图频繁重渲染。
 */
const CLOCK_TICK_MS = 15_000;

export default function SchedulePage({ params }: SchedulePageProps) {
  const { id } = use(params);
  const confirm = useAdminConfirm();
  const toast = useAdminToast();
  const { state, applySchedulePlan, applyTeamSwap, approveRequest, rejectRequest, toggleFrozen, removeMatch, setMatchTime, reportGameResults, reset, updateConfig, confirmConfig, refresh, saveError, syncedAt, autoSynced } = useSchedule(id, "admin");
  const [eventConfig, setEventConfig] = useState<EditableEvent | null>(null);

  /**
   * 「N 分钟前」要自己会走，否则页面上那句相对时间会停在打开时的那一刻。
   * 首屏两端口径一致：服务端渲染时 `syncedAt` 还是 0，相对时间不渲染，不会水合不匹配。
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const [selected, setSelected] = useState<ScheduleMatch | null>(null);


  // 调整对阵的弹窗状态（选两个签位 + 理由）

  const [swapOpen, setSwapOpen] = useState(false);

  const [swapFrom, setSwapFrom] = useState("");

  const [swapTo, setSwapTo] = useState("");

  const [swapReason, setSwapReason] = useState("");
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
  /** 大比分快捷录入（2026-10-29）：与裁判台一致，只填各赢几局就能提交 */
  const [series, setSeries] = useState({ a: 0, b: 0 });
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
  async function handleApproveRequest(requestId: string, ownerAttests: boolean) {
    if (ownerAttests) {
      const request = state.requests.find((item) => item.id === requestId);
      const when = request ? request.newStartTime.replace("T", " ") : "";
      const confirmed = await confirm({
        title: "确认双方已经在群内商定这个时间？",
        body: `「${when}」\n\n确认后赛程会直接更新，并在版本记录里标明由你核对。`,
        confirmLabel: "按此时间排期",
      });
      if (!confirmed) return;
    }
    const outcome = approveRequest(requestId, { ownerAttestsBothTeams: ownerAttests });
    if (!outcome) {
      toast.error("申请已失效或已被处理，请刷新后重试。");
      return;
    }
    if (!outcome.approved) {
      toast.error(outcome.conflicts.map((item) => item.message).join("；") || "该时间与现有排程冲突，请在下方调整。");
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
    setSeries({ a: 0, b: 0 });
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

  /**
   * 大比分 → 占位逐局（2026-10-29）：胜方局 1:0、负方局 0:1，地图留空。
   * 复用同一条提交链路，校验与晋级逻辑都不用改；逐局可在下面继续逐格修正。
   */
  function applySeries(a: number, b: number) {
    if (!selected) return;
    const cap = maxGames(selected.boType);
    const nextA = Math.max(0, Math.min(a, cap));
    const nextB = Math.max(0, Math.min(b, cap));
    setSeries({ a: nextA, b: nextB });
    const next: GameResult[] = [];
    for (let i = 0; i < nextA; i += 1) next.push({ map: "", teamAScore: 1, teamBScore: 0 });
    for (let i = 0; i < nextB; i += 1) next.push({ map: "", teamAScore: 0, teamBScore: 1 });
    setGames(next);
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
  // 上下文条用的两个数字（设计文档 4.2：赛程页显示「未排期 / 待报分」）。
  // MatchStatus 只有三态，所以「已排期」就是「定了时间还没结果」= 待报分。
  const pendingScheduleCount = state.matches.filter((m) => m.status === "待排期").length;
  const pendingReportCount = state.matches.filter((m) => m.status === "已排期").length;
  /**
   * 排期模式决定「待排期」这件事是正常还是异常：
   * 自由约赛下它正常（就等协商），固定比赛时间下它应当长期为 0，不为 0 说明排期漏了。
   * 所以这里不是加一句说明，而是让同一个数字在两种模式下说不同的话。
   */
  const scheduleMode = scheduleModeOf(eventConfig);
  const unscheduledNotice = unscheduledAnomalyNotice(scheduleMode, pendingScheduleCount);

  /**
   * 批量排期（固定比赛时间模式用）：按规则算出草案 → 让负责人过一眼 → 确认后才写入。
   * 只排**参赛队已确定**的场次；参赛队未定的（组内决赛、淘汰赛后续轮次）单独报出来。
   * 写入沿用 hook 的既有链路（版本条件写入 + 冲突自动重载），没有引入新的赛程写入点。
   */
  /** 可调整的签位：未开打、状态待排期、且队伍已确定的那些 */
  const swappableSlots = state.matches
    .filter((m) => !m.startTime && m.status === "待排期" && !m.winnerTeamId && (m.gameResults?.length ?? 0) === 0)
    .flatMap((m) => (["A", "B"] as const)
      .map((side) => ({
        value: `${m.id}|${side}`,
        label: `${m.id} · ${side} 位 · ${side === "A" ? m.teamAName : m.teamBName}`,
        teamId: side === "A" ? m.teamAId : m.teamBId,
      }))
      .filter((item) => item.teamId !== "TBD" && item.teamId !== ""));

  const parseSlot = (value: string): TeamSlot => {
    const [matchId, side] = value.split("|");
    return { matchId, side: side === "B" ? "B" : "A" };
  };

  function submitTeamSwap() {
    if (!swapFrom || !swapTo) { toast.error("请选择要调整的两个签位"); return; }
    if (!swapReason.trim()) { toast.error("请填写调整理由（事后要能说明依据）"); return; }
    const refusal = applyTeamSwap(parseSlot(swapFrom), parseSlot(swapTo), swapReason);
    if (refusal) { toast.error(refusal); return; }
    toast.success("已调整对阵，稍后自动保存");
    setSwapOpen(false); setSwapFrom(""); setSwapTo(""); setSwapReason("");
  }

  function runBulkSchedule() {
    const { schedulable, awaitingTeams } = partitionSchedulable(state.matches);
    if (schedulable.length === 0) {
      toast.error("没有可排期的场次（参赛队已确定的那些都已排好）");
      return;
    }
    const { config, windows } = schedulePlanInputFromEvent(eventConfig ?? {});
    const plan = planBulkSchedule(schedulable, state.matches, config, windows);
    if (plan.assignments.length === 0) {
      toast.error("按当前规则排不下任何一场，请检查比赛日与时段设置");
      return;
    }
    const lines = plan.assignments
      .map((item) => {
        const target = schedulable.find((m) => m.id === item.matchId);
        return `${item.startTime.slice(5, 16).replace("T", " ")}–${item.endTime.slice(11, 16)}  ${item.matchId}  ${target?.teamAName ?? "?"} vs ${target?.teamBName ?? "?"}`;
      })
      .join("\n");
    void confirm({
      title: `按规则排期：${plan.assignments.length} 场`,
      body: `${lines}${plan.skipped.length > 0 ? `\n\n排不下 ${plan.skipped.length} 场：${plan.skipped.map((item) => item.matchId).join("、")}` : ""}${awaitingTeams.length > 0 ? `\n\n另有 ${awaitingTeams.length} 场参赛队未定，本次不排：${awaitingTeams.map((m) => m.id).join("、")}` : ""}`,
      confirmLabel: `写入 ${plan.assignments.length} 场时间`,
    }).then((ok) => {
      if (!ok) return;
      applySchedulePlan(plan.assignments);
      toast.success(`已写入 ${plan.assignments.length} 场时间，稍后自动保存`);
    });
  }
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
  // 「数据时间」的相对部分（「刚刚 / N 分钟前」）。还没与服务端对齐过时为空串。
  const syncedAgo = formatSyncedAgo(syncedAt, now);

  return (
    <div>
      <AdminPageHeader
        eyebrow="模块 02"
        title="赛程"
        description={dataIssue
          ? undefined
          : showingBlueprint
            ? `${blueprintMatches.length} 个比赛签位 · 待抽签`
            : state.matches.length === 0
              ? "暂无赛程"
              : "点击场次可排期、报分或改期"}
        status={`赛程 v${state.version}`}
        actions={eventLocked ? undefined : (
          <>
            {/* 手动刷新：拿到最新赛程。失败必须说出来 —— 原先 `void refresh()` 会让
                拒绝悄悄进控制台，负责人看到的只是「点了没反应」。 */}
            <button
              type="button"
              onClick={() => { void refresh().catch(() => toast.error("刷新失败，请检查网络后重试。")); }}
              className="adm-btn adm-btn--secondary adm-btn--md"
            >
              刷新数据
            </button>
            {swappableSlots.length >= 2 && (
              <button type="button" onClick={() => setSwapOpen(true)} className="adm-btn adm-btn--secondary adm-btn--md">
                调整对阵
              </button>
            )}
            {scheduleMode === "fixed" && (
              <button type="button" onClick={runBulkSchedule} className="adm-btn adm-btn--secondary adm-btn--md">
                按规则批量排期
              </button>
            )}
            <Link href={`/admin/events/${id}/schedule/draw`} className="adm-btn adm-btn--primary adm-btn--md">开始抽签</Link>
            <Link href={`/admin/events/${id}/referees`} className="adm-btn adm-btn--secondary adm-btn--md">裁判管理</Link>
            <Link href={`/admin/events/${id}/review`} className="adm-btn adm-btn--danger adm-btn--md">
              异常赛果
              {pendingReviewCount > 0 && <span className="bg-[var(--adm-red)] px-1.5 py-0.5 text-[length:var(--adm-fs-sm)] font-bold text-white">{pendingReviewCount}</span>}
            </Link>
          </>
        )}
        overflow={eventLocked || state.matches.length === 0 ? undefined : [
          {
            // 破坏性动作不和日常按钮并排：文案写明「清空对阵、保留历史」，
            // 与赛事级的「永久删除」区分开（设计文档 5.2 最后一行）。
            text: "归档并重抽 · 清空对阵，保留历史版本",
            tone: "var(--adm-red-text)",
            onSelect: () => {
              void confirm({
                title: "归档当前赛程并返回抽签前状态？",
                body: "当前赛程会保留在版本历史中，对阵将被清空。",
                confirmLabel: "归档并重抽",
                tone: "danger",
              }).then((ok) => { if (ok) reset(); });
            },
          },
        ]}
      />

      {/* 上下文条：一行数字，不做卡片（设计文档 4.2）。这组数字原来挤在页头 description 里
          （「对阵图 · N 场 · 已完成 M 场」），现在单独成行，页头只留一句话说明。

          末尾常驻一项「数据时间」（代码审计 A6）：赛事进行期里，「手里这份是不是最新的」
          这件事必须一直看得见 —— 否则负责人会对着过期赛程反复提交，或者更糟：
          把裁判刚报的赛果覆盖回去。所以它不跟着对阵图的有无走，抽签前骨架状态也在。
          移动端只隐藏前四个计数（设计文档 4.4：不减字号，改为减少一屏信息），
          「数据时间」保留 —— 它是信任信号，不是数字堆。 */}
      <ContextBar
        items={[
          ...(state.matches.length > 0
            ? [
                { label: "总场次", value: `${state.matches.length} 场` },
                {
                  // 同一个数字在两种模式下含义不同：固定模式 = 主办方的待办；
                  // 自由约赛 = 队伍在协商，中性说法
                  label: scheduleMode === "fixed" ? "待排期" : "待协商",
                  value: `${pendingScheduleCount} 场`,
                  note: unscheduledNotice ?? undefined,
                  tone: (unscheduledNotice ? "alert" : "default") as "alert" | "default",
                },
                { label: "排期模式", value: SCHEDULE_MODE_LABELS[scheduleMode] },
                { label: "待报分", value: `${pendingReportCount} 场` },
                { label: "已完成", value: `${doneCount} 场` },
              ]
            : []),
          {
            // 数据时间不跟着对阵图的有无走：赛事进行期里「手里这份新不新」必须一直看得见，
            // 否则会对着过期赛程反复提交，甚至把裁判刚报的赛果覆盖回去。
            label: "数据时间",
            value: formatSyncedClock(syncedAt),
            note:
              [syncedAgo, autoSynced ? `已同步到 v${autoSynced.version}` : ""]
                .filter(Boolean)
                .join(" · ") || undefined,
          },
        ]}
      />

      {saveError && (
        <div className="adm-note adm-note--danger mb-5 text-[length:var(--adm-fs-lg)] font-semibold">
          {saveError}
        </div>
      )}

      {eventLocked ? (
        <section className="mb-5 flex min-h-20 items-center justify-between gap-4 adm-panel px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <span aria-hidden className="h-10 w-1 shrink-0 bg-[var(--adm-red)]" />
            <div className="min-w-0">
              <p className="text-[length:var(--adm-fs-xs)] font-semibold tracking-[0.16em] text-[var(--adm-text-mute)]">排期限制</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">排程约束</h2>
                <p className="text-[length:var(--adm-fs-sm)] font-bold text-[var(--adm-text-soft)]">{fmt(state.config.stageStart)}—{fmt(state.config.stageEnd)} · 同时最多 {state.config.maxConcurrentMatches} 场</p>
              </div>
            </div>
          </div>
          <span className="shrink-0 border border-[var(--adm-line)] bg-[var(--adm-surface-2)] px-2 py-1 text-[length:var(--adm-fs-xs)] font-semibold text-[var(--adm-text-soft)]">已锁定</span>
        </section>
      ) : (
      <details className="mb-5 adm-panel">
        <summary className="flex min-h-20 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <span aria-hidden className="h-10 w-1 shrink-0 bg-[var(--adm-red)]" />
            <div className="min-w-0">
              <p className="text-[length:var(--adm-fs-xs)] font-semibold tracking-[0.16em] text-[var(--adm-text-mute)]">排期限制</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">排程约束</h2>
                <p className="text-[length:var(--adm-fs-sm)] font-bold text-[var(--adm-text-soft)]">{fmt(state.config.stageStart)}—{fmt(state.config.stageEnd)} · 同时最多 {state.config.maxConcurrentMatches} 场</p>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="adm-chip" data-tone={state.configConfirmed ? "done" : "attention"}>{state.configConfirmed ? "已确认" : "待确认"}</span>
            <span className="hidden text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text-soft)] sm:inline">展开设置 ↓</span>
          </div>
        </summary>
        <div className="grid gap-4 border-t border-[var(--adm-line-soft)] bg-[var(--adm-surface-3)] p-5 sm:p-6 md:grid-cols-[1fr_1fr_10rem]">
          <label className="text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text-soft)]">允许开始时间<input type="datetime-local" value={state.config.stageStart.slice(0, 16)} onChange={(event) => updateConfig({ stageStart: `${event.target.value}:00` })} className="mt-2 h-[44px] w-full adm-panel px-3 text-[length:var(--adm-fs-lg)] font-bold text-[var(--adm-text)] outline-none transition focus:border-[var(--adm-red)] focus:ring-2 focus:ring-[rgba(255,70,85,0.15)]" /></label>
          <label className="text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text-soft)]">允许结束时间<input type="datetime-local" value={state.config.stageEnd.slice(0, 16)} onChange={(event) => updateConfig({ stageEnd: `${event.target.value}:00` })} className="mt-2 h-[44px] w-full adm-panel px-3 text-[length:var(--adm-fs-lg)] font-bold text-[var(--adm-text)] outline-none transition focus:border-[var(--adm-red)] focus:ring-2 focus:ring-[rgba(255,70,85,0.15)]" /></label>
          <label className="text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text-soft)]">最大同时比赛数<input type="number" min="1" max="12" value={state.config.maxConcurrentMatches} onChange={(event) => updateConfig({ maxConcurrentMatches: Math.max(1, Number(event.target.value) || 1) })} className="mt-2 h-[44px] w-full adm-panel px-3 text-[length:var(--adm-fs-lg)] font-bold text-[var(--adm-text)] outline-none transition focus:border-[var(--adm-red)] focus:ring-2 focus:ring-[rgba(255,70,85,0.15)]" /></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--adm-line-soft)] bg-[var(--adm-surface)] px-5 py-4 sm:px-6">
          <p className="flex items-center gap-2 text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]"><span aria-hidden className="h-1.5 w-1.5 bg-[var(--adm-red)]" />修改约束后须重新确认，确认前暂停队长约赛。</p>
          <button type="button" onClick={confirmConfig} className="adm-btn adm-btn--primary adm-btn--md hover:bg-[var(--adm-red-hover)]">{state.configConfirmed ? "重新确认排程约束" : "确认排程约束"}</button>
        </div>
      </details>
      )}

      {!eventLocked && activeRequests.length > 0 && (
        <section className="mb-5 adm-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--adm-line-soft)] px-5 py-4">
            <div>
              <p className="text-[length:var(--adm-fs-sm)] font-semibold tracking-[0.14em] text-[var(--adm-text-mute)]">约赛协调</p>
              <h2 className="mt-1 text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">约赛审批</h2>
            </div>
            {/* 这里原来还有一个「刷新」文字按钮（和顶部工具条的「刷新数据」是同一个动作）。
                按设计文档 5.2 删掉：**状态可以多处显示，动作只留一处**。
                驳回 / 批准之后本面板自己会重新取数，不需要一个独立的手动刷新。 */}
          </div>
          <div className="p-5">
            <div>
              <h3 className="text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text-soft)]">进行中的约赛 · {activeRequests.length}</h3>
              {activeRequests.length === 0 ? (
                <div className="mt-3">
                  <EmptyState
                    title="没有待处理的约赛申请"
                    description="队伍在玩家页面提交改期后会出现在这里等你确认；确认之前原定时间不变。"
                  />
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {activeRequests.map((request) => {
                    const match = state.matches.find((item) => item.id === request.matchId);
                    const awaitingOpponent = request.status === "待对手确认";
                    return <div key={request.id} className="adm-note adm-note--warn">
                      <div className="flex items-start justify-between gap-3"><div><p className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{match?.teamAName} vs {match?.teamBName}</p><p className="mt-1 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">{fmt(request.newStartTime)} · {request.reason || "双方协商时间"}</p></div><span className="adm-chip" data-tone="active">{request.status}</span></div>
                      {awaitingOpponent && (
                        <p className="mt-2 text-[length:var(--adm-fs-sm)] leading-[1.65] text-[var(--adm-text-soft)]">
                          对手还没在平台上点确认。若双方已在群里商定，可直接按此时间排期——记录会标明是负责人核对的。
                        </p>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button onClick={() => rejectRequest(request.id)} className="adm-btn adm-btn--secondary adm-btn--md">驳回</button>
                        <button onClick={() => handleApproveRequest(request.id, awaitingOpponent)} className="adm-btn adm-btn--primary adm-btn--md">
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
        <section className="adm-note adm-note--warn p-6">
          <p className="text-[length:var(--adm-fs-sm)] font-semibold tracking-[0.14em] text-[var(--adm-warn-text)]">对阵数据核对</p>
          <h2 className="mt-3 text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">当前数据无法生成对阵图</h2>
          <p className="mt-2 text-[length:var(--adm-fs-md)] font-medium leading-[1.75] text-[var(--adm-text-soft)]">{dataIssue}</p>
          <button
            type="button"
            onClick={() => {
              void confirm({
                title: "归档旧赛程并重新抽签？",
                body: "旧赛程会保留在版本历史中，当前对阵将被清空。",
                confirmLabel: "归档并重新抽签",
                tone: "danger",
              }).then((ok) => { if (ok) reset(); });
            }}
            className="adm-btn adm-btn--primary adm-btn--md mt-5"
          >
            归档旧赛程并返回抽签
          </button>
        </section>
      ) : state.matches.length === 0 ? (
        <section className="adm-panel p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--adm-line-soft)] pb-4">
            <div>
              <p className="text-[length:var(--adm-fs-sm)] font-semibold tracking-[0.14em] text-[var(--adm-text-mute)]">对阵骨架</p>
              <h2 className="mt-2 text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">抽签前对阵骨架</h2>
            </div>
          </div>
          {blueprintMatches.length > 0 ? (
            <TournamentBracketCanvas
              matches={blueprintMatches}
              renderMatch={(match) => <BlueprintCard m={match} />}
            />
          ) : (
            <EmptyState
              title="还没有可执行的赛制"
              description="对阵骨架由赛制决定。先在赛事设置里把阶段和席位配好，这里就会出现抽签前的对阵骨架。"
              action={<Link href={`/admin/events/${id}/settings`} className="adm-btn adm-btn--primary adm-btn--md">去设置赛制</Link>}
            />
          )}
        </section>
      ) : (
        <section className="adm-panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">对阵图</h2>
          </div>
          <Bracket matches={state.matches} bpSessions={bpSessions} onSelect={openMatch} />
        </section>
      )}

        {swapOpen && (
        <AdminModal
          title="调整对阵：交换两个签位的队伍"
          onClose={() => setSwapOpen(false)}
          width="sm"
        >
          <div className="space-y-4">
            <p className="text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">
              只能在同一阶段内、且两场都还没开打时调整。改完会把理由写进赛程的版本记录里。
            </p>
            <label className="block">
              <span className="mb-1 block text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text)]">签位一</span>
              <select value={swapFrom} onChange={(e) => setSwapFrom(e.target.value)} className={adminSelectClass}>
                <option value="">请选择…</option>
                {swappableSlots.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text)]">签位二</span>
              <select value={swapTo} onChange={(e) => setSwapTo(e.target.value)} className={adminSelectClass}>
                <option value="">请选择…</option>
                {swappableSlots.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text)]">理由（必填）</span>
              <input value={swapReason} onChange={(e) => setSwapReason(e.target.value)} className={adminInputClass} placeholder="例：两队协商一致 / 同院系避开" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSwapOpen(false)} className="adm-btn adm-btn--secondary adm-btn--md">取消</button>
              <button type="button" onClick={submitTeamSwap} className="adm-btn adm-btn--primary adm-btn--md">确认调整</button>
            </div>
          </div>
        </AdminModal>
        )}

      {/* 比赛操作面板。原来是自己写的遮罩层（z-50、没有 Esc 关闭、没有点遮罩关闭），
          这里换成统一的 AdminModal —— 它自带 Esc、点遮罩关闭和滚动锁定。
          下面每个模式原来自带 `p-5`，去掉是因为 AdminModal 的内容容器已经给了。 */}
      {selected && (

        <AdminModal
          title={`${selected.id} · ${selected.phase}`}
          onClose={() => setSelected(null)}
          width={mode === "report" ? "lg" : "sm"}
        >

            {/* 概览模式 */}
            {mode === "overview" && (
              <div className="space-y-4">
                <p className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{selected.teamAName} <span className="font-normal text-[var(--adm-text-mute)]">vs</span> {selected.teamBName}</p>
                <div className="flex items-center gap-2 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">
                  <span className="adm-chip" data-dot="off">{selected.boType}</span>
                  <span>{selected.round}</span>
                  <span className="text-[var(--adm-text-mute)]">·</span>
                  <span className="tabular-nums">{selected.startTime ? fmt(selected.startTime) : "未排期"}</span>
                </div>
                {selected.status === "已完成" && selected.winnerTeamId && (
                  <div className="adm-note adm-note--ok flex items-center justify-between gap-4">
                    <span className="text-[length:var(--adm-fs-lg)] font-semibold">
                      胜者：{selected.winnerTeamId === selected.teamAId ? selected.teamAName : selected.teamBName}
                    </span>
                    {selected.gameResults && (
                      <span className="shrink-0 text-[length:var(--adm-fs-xl)] font-semibold tabular-nums tracking-[-0.02em] text-[var(--adm-text)]">
                        {winCount(selected.gameResults, "A")}
                        <span className="mx-1.5 font-normal text-[var(--adm-text-mute)]">:</span>
                        {winCount(selected.gameResults, "B")}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {selected.status === "待排期" && (
                    <button onClick={() => setMode("schedule")} className="adm-btn adm-btn--primary adm-btn--md">排期</button>
                  )}
                  {selected.status === "已排期" && (
                    <>
                      <Link href={`/bp/${selected.id}?eventId=${encodeURIComponent(id)}`} className="adm-btn adm-btn--secondary adm-btn--md">去 BP</Link>
                      <button onClick={() => setMode("report")} className="adm-btn adm-btn--primary adm-btn--md">报分</button>
                      <button onClick={() => setMode("reschedule")} className="adm-btn adm-btn--secondary adm-btn--md">负责人调整</button>
                    </>
                  )}
                  {!eventLocked && <button onClick={() => toggleFrozen(selected.id)} className={`border px-4 py-2.5 text-[length:var(--adm-fs-md)] font-semibold ${selected.frozen ? "border-[var(--adm-text)] text-[var(--adm-text)]" : "border-[var(--adm-line)] text-[var(--adm-text-soft)] hover:border-[var(--adm-text)]"}`}>{selected.frozen ? "解冻" : "冻结"}</button>}
                  {!eventLocked && selected.status !== "已完成" && (
                    <button onClick={() => { const why = removeMatch(selected.id); if (why) window.alert(why); else setSelected(null); }} className="adm-btn adm-btn--secondary adm-btn--md">删除这场</button>
                  )}
                </div>
              </div>
            )}

            {/* 排期模式 */}
            {mode === "schedule" && (
              <div className="space-y-4">
                <p className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{selected.teamAName} <span className="font-normal text-[var(--adm-text-mute)]">vs</span> {selected.teamBName}（{selected.boType}）</p>
                <input type="datetime-local" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} className={adminInputClass} />
                {scheduleResult && !scheduleResult.approved && (
                  <div className="adm-note adm-note--danger">
                    <p className="text-[length:var(--adm-fs-lg)] font-semibold">排期被拦截</p>
                    <ul className="mt-2 space-y-1">
                      {scheduleResult.conflicts.map((c) => (
                        <li key={c.code} className="text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]"><span className="tabular-nums text-[var(--adm-text-mute)]">[{c.code}]</span> {c.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setMode("overview")} className="adm-btn adm-btn--secondary adm-btn--md">取消</button>
                  <button onClick={handleScheduleSubmit} className="adm-btn adm-btn--primary adm-btn--md hover:bg-[var(--adm-red-hover)]">排期并校验</button>
                </div>
              </div>
            )}

            {/* 改期模式 */}
            {mode === "reschedule" && (
              <div className="space-y-4">
                <p className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{selected.teamAName} <span className="font-normal text-[var(--adm-text-mute)]">vs</span> {selected.teamBName}（{selected.boType}）</p>
                <input type="datetime-local" value={newTime} onChange={(e) => setNewTime(e.target.value)} className={adminInputClass} />
                <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="改期原因" className={adminInputClass} />
                {submitted && result && (
                  <div className={`adm-note ${result.approved ? "adm-note--ok" : "adm-note--danger"}`}>
                    {result.approved ? (
                      <p className="text-[length:var(--adm-fs-lg)] font-semibold">校验通过</p>
                    ) : (
                      <div>
                        <p className="text-[length:var(--adm-fs-lg)] font-semibold">存在冲突</p>
                        <ul className="mt-2 space-y-1">
                          {result.conflicts.map((c) => (
                            <li key={c.code} className="text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]"><span className="tabular-nums text-[var(--adm-text-mute)]">[{c.code}]</span> {c.message}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setMode("overview")} className="adm-btn adm-btn--secondary adm-btn--md">取消</button>
                  <button onClick={handleRescheduleSubmit} className="adm-btn adm-btn--primary adm-btn--md hover:bg-[var(--adm-red-hover)]">确认调整并校验</button>
                </div>
              </div>
            )}

            {/* 报分模式 */}
            {mode === "report" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--adm-line-soft)] pb-3">
                  <p className="min-w-0 truncate text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">
                    {selected.teamAName} <span className="font-normal text-[var(--adm-text-mute)]">vs</span> {selected.teamBName}
                  </p>
                  <span className="adm-chip shrink-0" data-dot="off">{selected.boType}</span>
                </div>

                {/* 大比分快捷录入（2026-10-29）：只填各赢几局即可提交，
                    逐局格子自动生成占位（1:0 / 0:1），下面可以逐格改成真实比分。 */}
                <div className="border border-[var(--adm-line-soft)] bg-[var(--adm-surface-2)] p-3">
                  <p className="text-[length:var(--adm-fs-xs)] text-[var(--adm-text-mute)]">大比分（各赢几局）</p>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <label className="block min-w-0">
                      <span className="mb-1 block truncate text-[length:var(--adm-fs-xs)] text-[var(--adm-text-mute)]">{selected.teamAName}</span>
                      <input type="number" min={0} max={maxGames(selected.boType)} value={series.a} onChange={(e) => applySeries(Number(e.target.value), series.b)} className={adminInputClass} />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1 block truncate text-[length:var(--adm-fs-xs)] text-[var(--adm-text-mute)]">{selected.teamBName}</span>
                      <input type="number" min={0} max={maxGames(selected.boType)} value={series.b} onChange={(e) => applySeries(series.a, Number(e.target.value))} className={adminInputClass} />
                    </label>
                  </div>
                </div>

                {games.map((game, index) => {
                  const winner = game.teamAScore === game.teamBScore
                    ? ""
                    : game.teamAScore > game.teamBScore ? selected.teamAName : selected.teamBName;
                  return (
                    <div key={index} className="border border-[var(--adm-line-soft)]">
                      <div className="flex items-center justify-between gap-3 border-b border-[var(--adm-line-soft)] bg-[var(--adm-surface-2)] px-3 py-1.5">
                        <span className="text-[length:var(--adm-fs-xs)] font-semibold tracking-[0.08em] text-[var(--adm-text-soft)]">第 {index + 1} 局</span>
                        <span className={`text-[length:var(--adm-fs-xs)] ${winner ? "text-[var(--adm-text-soft)]" : "text-[var(--adm-text-mute)]"}`}>
                          {winner ? `胜者 ${winner}` : "平局 / 待填"}
                        </span>
                      </div>
                      <div className="grid gap-3 p-3 sm:grid-cols-[1fr_5.5rem_5.5rem]">
                        <label className="block min-w-0 sm:col-span-1">
                          <span className="mb-1 block text-[length:var(--adm-fs-xs)] text-[var(--adm-text-mute)]">地图</span>
                          {/* 地图一律下拉（2026-10-28）：原来 BP 未完成时退化成手填输入框，
                              负责人要求"不要手填"。BP 有序列就按序列，没有就用赛事图池兜底。 */}
                          <select value={game.map ?? ""} onChange={(e) => updateGame(index, { map: e.target.value })} className={adminSelectClass}>
                            <option value="">选择地图</option>
                            {(reportMaps.length > 0 ? reportMaps : MAP_POOL).map((m) => <option key={m} value={m}>{m}</option>)}
                            {game.map && !(reportMaps.length > 0 ? reportMaps : MAP_POOL).includes(game.map) && <option value={game.map}>{game.map}</option>}
                          </select>
                        </label>
                        <label className="block min-w-0">
                          <span className="mb-1 block truncate text-[length:var(--adm-fs-xs)] text-[var(--adm-text-mute)]" title={selected.teamAName}>{selected.teamAName}</span>
                          <input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            value={game.teamAScore}
                            onChange={(e) => updateGame(index, { teamAScore: Number(e.target.value) })}
                            aria-label={`第 ${index + 1} 局 ${selected.teamAName} 比分`}
                            className={`${adminInputClass} h-[52px] px-0 text-center text-[length:var(--adm-fs-xl)] font-semibold tabular-nums`}
                          />
                        </label>
                        <label className="block min-w-0">
                          <span className="mb-1 block truncate text-[length:var(--adm-fs-xs)] text-[var(--adm-text-mute)]" title={selected.teamBName}>{selected.teamBName}</span>
                          <input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            value={game.teamBScore}
                            onChange={(e) => updateGame(index, { teamBScore: Number(e.target.value) })}
                            aria-label={`第 ${index + 1} 局 ${selected.teamBName} 比分`}
                            className={`${adminInputClass} h-[52px] px-0 text-center text-[length:var(--adm-fs-xl)] font-semibold tabular-nums`}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}

                <button
                  onClick={addGame}
                  disabled={games.length >= maxGames(selected.boType)}
                  className={`text-[length:var(--adm-fs-md)] font-semibold ${games.length >= maxGames(selected.boType) ? "cursor-not-allowed text-[var(--adm-text-mute)]" : "text-[var(--adm-red-text)] hover:text-[var(--adm-red)]"}`}
                >
                  ＋ 加一局（最多 {maxGames(selected.boType)} 局）
                </button>

                <div className="flex items-end justify-between gap-3 border-t border-[var(--adm-line-soft)] pt-4">
                  <span className="text-[length:var(--adm-fs-sm)] text-[var(--adm-text-soft)]">大比分 · 先到 {winTarget(selected.boType)} 胜</span>
                  <span className="text-[length:var(--adm-fs-xl)] font-semibold tabular-nums tracking-[-0.02em] text-[var(--adm-text)]">
                    {winCount(games, "A")}
                    <span className="mx-2 font-normal text-[var(--adm-text-mute)]">:</span>
                    {winCount(games, "B")}
                  </span>
                </div>
                {scoreError && <p className="adm-note adm-note--danger font-semibold">{scoreError}</p>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setMode("overview")} className="adm-btn adm-btn--secondary adm-btn--md">取消</button>
                  <button onClick={handleReport} className="adm-btn adm-btn--primary adm-btn--md hover:bg-[var(--adm-red-hover)]">确认报分</button>
                </div>
              </div>
            )}
        </AdminModal>
      )}
    </div>
  );
}
