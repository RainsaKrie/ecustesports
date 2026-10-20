"use client";

// =====================
// RPT-06 管理员异常赛果工作台
// 两个 tab：
//   1) 异常裁决：needs-review 提交（强制复核 / 结果冲突）→ 接受 / 驳回（原因必填）
//   2) 受控更正：已生效（accepted）赛果 → 更正比分与胜者（下游已进度则被纯函数阻止）
// 视觉对齐管理端规格：无圆角、白卡 + 1px 墨线、品牌红强调、无阴影无 tooltip、字号放大。
// =====================

import { useCallback, useEffect, useState } from "react";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { adminInputClass, EmptyState, type AdminBadgeTone } from "@/components/admin/ui";
import type { AcceptedResultItem, AdminReviewItem } from "@/lib/domains/result/reporting-data";

type GameRow = { map?: string; teamAScore: number; teamBScore: number };
type Tab = "review" | "correct";

function fmtTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

/** 异常标签 → 语义档：结果冲突是红点，其余是「待处理」的空心点。 */
function riskTone(tag: AdminReviewItem["riskTag"]): AdminBadgeTone {
  return tag === "结果冲突" ? "attention" : "active";
}

/** 异常标签 → 提示条语气，给右侧详情区的大块说明用。 */
function riskNote(tag: AdminReviewItem["riskTag"]) {
  return tag === "结果冲突" ? "adm-note--danger" : "adm-note--warn";
}

export default function ReviewWorkspace({ eventId }: { eventId: string }) {
  const [tab, setTab] = useState<Tab>("review");
  const [queue, setQueue] = useState<AdminReviewItem[]>([]);
  const [accepted, setAccepted] = useState<AcceptedResultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 裁决状态
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionResult, setActionResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 受控更正状态
  const [correctMatchId, setCorrectMatchId] = useState<string | null>(null);
  const [correctGames, setCorrectGames] = useState<GameRow[]>([]);
  const [correctReason, setCorrectReason] = useState("");

  const selected = queue.find((item) => item.submissionId === selectedId) ?? null;
  const correctTarget = accepted.find((item) => item.matchId === correctMatchId) ?? null;
  const correctedWinnerName = (() => {
    if (!correctTarget || correctGames.length === 0) return "等待录入合法比分";
    const winsA = correctGames.filter((game) => game.teamAScore > game.teamBScore).length;
    const winsB = correctGames.filter((game) => game.teamBScore > game.teamAScore).length;
    const target = ({ BO1: 1, BO3: 2, BO5: 3 } as Record<string, number>)[correctTarget.boType] ?? 1;
    if (winsA === target && winsB < target) return correctTarget.teamAName;
    if (winsB === target && winsA < target) return correctTarget.teamBName;
    return "等待录入合法比分";
  })();

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/admin/review?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" });
      if (!res.ok) { setError("加载异常工作台失败"); return; }
      const data = (await res.json()) as { queue: AdminReviewItem[]; accepted: AcceptedResultItem[] };
      setQueue(data.queue);
      setAccepted(data.accepted);
      if (selectedId && !data.queue.some((q) => q.submissionId === selectedId)) setSelectedId(null);
      if (correctMatchId && !data.accepted.some((a) => a.matchId === correctMatchId)) setCorrectMatchId(null);
    } catch {
      setError("网络连接失败");
    } finally {
      setLoading(false);
    }
  }, [eventId, selectedId, correctMatchId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/review?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("加载异常工作台失败")))
      .then((data: { queue: AdminReviewItem[]; accepted: AcceptedResultItem[] }) => {
        if (cancelled) return;
        setQueue(data.queue);
        setAccepted(data.accepted);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) { setError("网络连接失败"); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [eventId]);

  function openItem(item: AdminReviewItem) {
    setSelectedId(item.submissionId);
    setReason("");
    setActionResult(null);
    setActionError("");
  }

  function openCorrect(item: AcceptedResultItem) {
    setCorrectMatchId(item.matchId);
    setCorrectGames(item.games.map((g) => ({ map: g.map, teamAScore: g.teamAScore, teamBScore: g.teamBScore })));
    setCorrectReason("");
    setActionError("");
    setActionResult(null);
  }

  async function doResolve(accept: boolean) {
    if (!selected) return;
    if (!reason.trim()) { setActionError("裁决原因必填"); return; }
    setBusy(true);
    setActionError("");
    setActionResult(null);
    try {
      const res = await fetch("/api/admin/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, action: "resolve", payload: { submissionId: selected.submissionId, accept, reason: reason.trim() } }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) { setActionResult({ ok: false, message: data.message ?? "裁决失败" }); setBusy(false); return; }
      setActionResult({ ok: true, message: accept ? "已接受，正式赛果已更新" : "已驳回，正式赛果未改动" });
      setReason("");
      setSelectedId(null);
      await load();
    } catch {
      setActionResult({ ok: false, message: "网络连接失败" });
    } finally {
      setBusy(false);
    }
  }

  async function doCorrect() {
    if (!correctTarget) return;
    if (!correctReason.trim()) { setActionError("更正原因必填"); return; }
    if (correctGames.some((g) => g.teamAScore === g.teamBScore)) { setActionError("每局比分不能平局"); return; }
    setBusy(true);
    setActionError("");
    setActionResult(null);
    try {
      const res = await fetch("/api/admin/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, action: "correct", payload: { matchId: correctTarget.matchId, reason: correctReason.trim(), newGames: correctGames } }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) { setActionResult({ ok: false, message: data.message ?? "更正失败" }); setBusy(false); return; }
      setActionResult({ ok: true, message: "更正已生效" });
      setCorrectMatchId(null);
      await load();
    } catch {
      setActionResult({ ok: false, message: "网络连接失败" });
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = queue.length;

  return (
    <div>
      <AdminPageHeader
        eyebrow="模块 02"
        title="异常赛果"
        description="裁判报分产生的异常需要你裁决；已生效赛果可通过受控更正修正。"
        status={pendingCount > 0 ? `${pendingCount} 条待裁决` : "无待裁决"}
        actions={
          <button type="button" onClick={() => void load()} className="adm-btn adm-btn--secondary adm-btn--md">
            刷新
          </button>
        }
      />

      {error && <div className="adm-note adm-note--danger mb-5 text-[length:var(--adm-fs-lg)] font-semibold">{error}</div>}

      {/* Tab 切换 */}
      <div className="mb-5 flex gap-2 border-b border-[var(--adm-line)]">
        <button
          onClick={() => setTab("review")}
          className={`border-b-2 px-4 py-3 text-[length:var(--adm-fs-lg)] font-semibold transition ${tab === "review" ? "border-[var(--adm-red)] text-[var(--adm-red-text)]" : "border-transparent text-[var(--adm-text-soft)] hover:text-[var(--adm-text)]"}`}
        >
          异常裁决 {pendingCount > 0 && <span className="ml-1 bg-[var(--adm-red)] px-1.5 py-0.5 text-[length:var(--adm-fs-sm)] text-white">{pendingCount}</span>}
        </button>
        <button
          onClick={() => setTab("correct")}
          className={`border-b-2 px-4 py-3 text-[length:var(--adm-fs-lg)] font-semibold transition ${tab === "correct" ? "border-[var(--adm-red)] text-[var(--adm-red-text)]" : "border-transparent text-[var(--adm-text-soft)] hover:text-[var(--adm-text)]"}`}
        >
          受控更正
        </button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">加载中…</p>
      ) : tab === "review" ? (
        pendingCount === 0 ? (
          <EmptyState
            title="异常队列已清空"
            description="裁判报分时，半决赛/决赛的强制复核场次、以及结果有冲突的比赛会自动进入这里等你裁决。"
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            {/* 左：异常列表 */}
            <section className="adm-panel">
              <div className="border-b border-[var(--adm-line-soft)] px-5 py-4">
                {/* 数字不在这里说第三遍：页头状态已经是「N 条待裁决」，
                    标签页徽标也有。这一栏只说它是什么。 */}
                <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">待裁决</h2>
              </div>
              <ul>
                {queue.map((item) => (
                  <li key={item.submissionId}>
                    <button
                      onClick={() => openItem(item)}
                      className={`w-full border-l-4 px-5 py-4 text-left transition-colors ${
                        selectedId === item.submissionId ? "border-[var(--adm-red)] bg-[var(--adm-red-soft)]" : "border-transparent hover:bg-[var(--adm-surface-2)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="adm-chip" data-tone={riskTone(item.riskTag)}>{item.riskTag}</span>
                        <span className="text-[length:var(--adm-fs-xs)] tabular-nums text-[var(--adm-text-mute)]">{item.boType}</span>
                      </div>
                      <p className="mt-2 text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{item.teamAName} <span className="font-normal text-[var(--adm-text-mute)]">vs</span> {item.teamBName}</p>
                      <p className="mt-1 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">裁判 {item.refereeName} · {fmtTime(item.submittedAt)}</p>
                    </button>
                    <div className="ml-5 border-b border-[var(--adm-line-soft)]" />
                  </li>
                ))}
              </ul>
            </section>

            {/* 右：详情 + 裁决 */}
            {selected ? (
              <section className="adm-panel">
                <div className="border-b border-[var(--adm-line-soft)] px-5 py-4">
                  <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{selected.teamAName} vs {selected.teamBName}</h2>
                  <p className="mt-1 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">
                    {selected.boType} · {selected.round || "未标轮次"} · 赛程 v{selected.basedOnScheduleVersion} · 裁判 {selected.refereeName}
                  </p>
                </div>

                <div className="space-y-4 p-5">
                  <div className={`adm-note ${riskNote(selected.riskTag)}`}>
                    <p className="text-[length:var(--adm-fs-md)] font-semibold">{selected.riskReason}</p>
                  </div>

                  <div className="border border-[var(--adm-line-soft)] p-4">
                    <p className="text-[length:var(--adm-fs-xs)] font-semibold tracking-[0.14em] text-[var(--adm-text-mute)]">拟生效结果</p>
                    <p className="mt-2 text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">胜者：{selected.declaredWinnerTeamName}</p>
                    <div className="mt-3 space-y-2 border-t border-[var(--adm-line-soft)] pt-3">
                      {selected.games.map((g, i) => (
                        <div key={i} className="flex items-center justify-between text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">
                          <span className="truncate text-[var(--adm-text-mute)]">{g.map || `局 ${i + 1}`}</span>
                          <span className="shrink-0 pl-3 text-[length:var(--adm-fs-lg)] font-semibold tabular-nums tracking-[0.02em] text-[var(--adm-text)]">
                            {g.teamAScore}
                            <span className="mx-1.5 font-normal text-[var(--adm-text-mute)]">:</span>
                            {g.teamBScore}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {selected.existingAcceptedWinnerTeamName && (
                    <div className="adm-note adm-note--danger">
                      <p className="text-[length:var(--adm-fs-xs)] font-semibold tracking-[0.14em] text-[var(--adm-red-text)]">与已生效赛果冲突</p>
                      <p className="mt-2 text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">
                        当前生效胜者：{selected.existingAcceptedWinnerTeamName}，裁判提交胜者：{selected.declaredWinnerTeamName}
                      </p>
                    </div>
                  )}

                  <div className="border border-[var(--adm-line-soft)] p-4">
                    <p className="text-[length:var(--adm-fs-xs)] font-semibold tracking-[0.14em] text-[var(--adm-text-mute)]">比赛凭证</p>
                    {selected.evidenceIds.length > 0 ? (
                      <p className="mt-2 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">已附 {selected.evidenceIds.length} 张凭证（本地阶段仅登记编号，接入私有存储后展示签名预览）</p>
                    ) : (
                      <p className="mt-2 text-[length:var(--adm-fs-md)] text-[var(--adm-text-mute)]">未附凭证</p>
                    )}
                  </div>

                  {(selected.downstreamImpact.hasScheduledDownstream || selected.downstreamImpact.hasProgressedDownstream) && (
                    <div className={`adm-note ${selected.downstreamImpact.hasProgressedDownstream ? "adm-note--danger" : "adm-note--warn"}`}>
                      <p className="text-[length:var(--adm-fs-md)] font-semibold">
                        {selected.downstreamImpact.hasProgressedDownstream
                          ? "下游比赛已 BP 或已完赛"
                          : "存在已排期但尚未推进的下游比赛"}
                      </p>
                      {selected.downstreamImpact.affectedMatchIds.length > 0 && (
                        <p className="mt-1 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">受影响：{selected.downstreamImpact.affectedMatchIds.join("、")}</p>
                      )}
                    </div>
                  )}

                  {actionResult && (
                    <div className={`adm-note ${actionResult.ok ? "adm-note--ok" : "adm-note--danger"} text-[length:var(--adm-fs-lg)] font-semibold`}>
                      {actionResult.message}
                    </div>
                  )}

                  <div className="space-y-3 border-t border-[var(--adm-line-soft)] pt-4">
                    <label className="block">
                      <span className="text-[length:var(--adm-fs-xs)] font-semibold tracking-[0.14em] text-[var(--adm-text-soft)]">裁决原因（必填）</span>
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="说明接受或驳回的依据"
                        rows={2}
                        className="mt-2 w-full adm-panel px-3 py-2.5 text-[length:var(--adm-fs-lg)] text-[var(--adm-text)] outline-none focus:border-[var(--adm-red)] focus:ring-2 focus:ring-[rgba(255,70,85,0.15)]"
                      />
                    </label>
                    {actionError && <p className="text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-red-text)]">{actionError}</p>}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => doResolve(false)}
                        disabled={busy}
                        className="adm-btn adm-btn--secondary adm-btn--md"
                      >
                        驳回
                      </button>
                      <button
                        onClick={() => doResolve(true)}
                        disabled={busy}
                        className="adm-btn adm-btn--primary adm-btn--md hover:bg-[var(--adm-red-hover)]"
                      >
                        {busy ? "处理中…" : "接受并生效"}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            ) : (
              <EmptyState
                title="选择左侧一条异常"
                description="这里会显示它的逐局比分对比，以及裁决理由的输入框。"
              />
            )}
          </div>
        )
      ) : accepted.length === 0 ? (
        <EmptyState
          title="暂无已生效赛果"
          description="裁判提交并生效的正式赛果会出现在这里，需要修改时走受控更正。"
        />
      ) : (
        /* 受控更正：已生效赛果列表 */
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="adm-panel">
            <div className="border-b border-[var(--adm-line-soft)] px-5 py-4">
              <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">已生效赛果 · {accepted.length}</h2>
            </div>
            <ul>
              {accepted.map((item) => (
                <li key={item.matchId}>
                  <button
                    onClick={() => openCorrect(item)}
                    className={`w-full border-l-4 px-5 py-4 text-left transition-colors ${
                      correctMatchId === item.matchId ? "border-[var(--adm-red)] bg-[var(--adm-red-soft)]" : "border-transparent hover:bg-[var(--adm-surface-2)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[length:var(--adm-fs-xs)] tabular-nums text-[var(--adm-text-mute)]">{item.boType} · {item.round}</span>
                    </div>
                    <p className="mt-2 text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{item.teamAName} <span className="font-normal text-[var(--adm-text-mute)]">vs</span> {item.teamBName}</p>
                    <p className="mt-1 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">胜者：{item.winnerTeamName}</p>
                  </button>
                  <div className="ml-5 border-b border-[var(--adm-line-soft)]" />
                </li>
              ))}
            </ul>
          </section>

          {correctTarget ? (
            <section className="adm-panel">
              <div className="border-b border-[var(--adm-line-soft)] px-5 py-4">
                <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{correctTarget.teamAName} vs {correctTarget.teamBName}</h2>
                <p className="mt-1 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">当前生效胜者：{correctTarget.winnerTeamName}</p>
              </div>
              <div className="space-y-4 p-5">
                {correctTarget.downstreamImpact.hasProgressedDownstream && (
                  <div className="adm-note adm-note--danger font-semibold">
                    下游已 BP 或已完赛，系统会阻止这次更正。请走人工恢复流程。
                  </div>
                )}

                <div className="adm-note adm-note--danger">
                  <p className="text-[length:var(--adm-fs-xs)] font-semibold tracking-[0.14em] text-[var(--adm-text-mute)]">系统按比分判定胜者</p>
                  <p className="mt-1 text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{correctedWinnerName}</p>
                </div>

                <div className="space-y-2">
                  {correctGames.map((g, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr] gap-2">
                      <input type="text" value={g.map ?? ""} onChange={(e) => setCorrectGames((prev) => prev.map((x, xi) => xi === i ? { ...x, map: e.target.value } : x))} placeholder="地图" className={adminInputClass} />
                      <input type="number" min={0} value={g.teamAScore} onChange={(e) => setCorrectGames((prev) => prev.map((x, xi) => xi === i ? { ...x, teamAScore: Number(e.target.value) || 0 } : x))} aria-label={`第 ${i + 1} 局 ${correctTarget.teamAName} 比分`} className={`${adminInputClass} text-center text-[length:var(--adm-fs-lg)] font-semibold tabular-nums`} />
                      <input type="number" min={0} value={g.teamBScore} onChange={(e) => setCorrectGames((prev) => prev.map((x, xi) => xi === i ? { ...x, teamBScore: Number(e.target.value) || 0 } : x))} aria-label={`第 ${i + 1} 局 ${correctTarget.teamBName} 比分`} className={`${adminInputClass} text-center text-[length:var(--adm-fs-lg)] font-semibold tabular-nums`} />
                    </div>
                  ))}
                </div>

                <label className="block">
                  <span className="text-[length:var(--adm-fs-xs)] font-semibold tracking-[0.14em] text-[var(--adm-text-soft)]">更正原因（必填）</span>
                  <textarea value={correctReason} onChange={(e) => setCorrectReason(e.target.value)} rows={2} placeholder="说明更正依据" className={`mt-2 ${adminInputClass} resize-y`} />
                </label>
                {actionError && <p className="text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-red-text)]">{actionError}</p>}
                {actionResult && (
                  <div className={`adm-note ${actionResult.ok ? "adm-note--ok" : "adm-note--danger"} text-[length:var(--adm-fs-lg)] font-semibold`}>
                    {actionResult.message}
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => { setCorrectMatchId(null); setActionError(""); setActionResult(null); }} disabled={busy} className="adm-btn adm-btn--secondary adm-btn--md">取消</button>
                  <button onClick={() => doCorrect()} disabled={busy} className="adm-btn adm-btn--primary adm-btn--md">{busy ? "处理中…" : "确认更正"}</button>
                </div>
              </div>
            </section>
          ) : (
            <section className="border border-dashed border-[var(--adm-line-soft)] bg-[var(--adm-surface)] p-10 text-center">
              <p className="text-[length:var(--adm-fs-md)] text-[var(--adm-text-mute)]">选择左侧一条已生效赛果进行受控更正</p>
            </section>
          )}
        </div>
      )}

      <p className="mt-6 text-[length:var(--adm-fs-md)] text-[var(--adm-text-mute)]">
        异常裁决只针对裁判报分；管理员在赛程页的手工报分直接生效，不进异常队列。
      </p>
    </div>
  );
}
