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
import type { AcceptedResultItem, AdminReviewItem } from "@/lib/referee/reporting-data";

type GameRow = { map?: string; teamAScore: number; teamBScore: number };
type Tab = "review" | "correct";

function fmtTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function riskTone(tag: AdminReviewItem["riskTag"]) {
  return tag === "结果冲突"
    ? "border-[#ff4655]/40 bg-[#fff1f2] text-[#c83242]"
    : "border-amber-300 bg-amber-50 text-amber-700";
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
  const [correctWinner, setCorrectWinner] = useState<"A" | "B" | "">("");
  const [correctReason, setCorrectReason] = useState("");

  const selected = queue.find((item) => item.submissionId === selectedId) ?? null;
  const correctTarget = accepted.find((item) => item.matchId === correctMatchId) ?? null;

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
    setCorrectWinner(item.winnerTeamId === item.teamAId ? "A" : "B");
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
    if (correctWinner !== "A" && correctWinner !== "B") { setActionError("请选择更正后的胜者"); return; }
    if (!correctReason.trim()) { setActionError("更正原因必填"); return; }
    if (correctGames.some((g) => g.teamAScore === g.teamBScore)) { setActionError("每局比分不能平局"); return; }
    const winnerTeamId = correctWinner === "A" ? correctTarget.teamAId : correctTarget.teamBId;
    setBusy(true);
    setActionError("");
    setActionResult(null);
    try {
      const res = await fetch("/api/admin/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, action: "correct", payload: { matchId: correctTarget.matchId, reason: correctReason.trim(), newGames: correctGames, newWinnerTeamId: winnerTeamId } }),
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
        eyebrow="MODULE 02 / REVIEW"
        title="异常赛果"
        description="裁判报分产生的异常需要你裁决；已生效赛果可通过受控更正修正。"
        status={pendingCount > 0 ? `${pendingCount} 条待裁决` : "无待裁决"}
        actions={
          <button type="button" onClick={() => void load()} className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-600">
            刷新
          </button>
        }
      />

      {error && <div className="mb-5 border border-[#ff4655] bg-[#fff1f2] px-5 py-3 text-sm font-bold text-[#9f2431]">{error}</div>}

      {/* Tab 切换 */}
      <div className="mb-5 flex gap-2 border-b border-slate-300">
        <button
          onClick={() => setTab("review")}
          className={`border-b-2 px-4 py-3 text-sm font-black transition ${tab === "review" ? "border-[#ff4655] text-[#c83242]" : "border-transparent text-slate-500 hover:text-slate-900"}`}
        >
          异常裁决 {pendingCount > 0 && <span className="ml-1 bg-[#ff4655] px-1.5 py-0.5 text-[0.625rem] text-white">{pendingCount}</span>}
        </button>
        <button
          onClick={() => setTab("correct")}
          className={`border-b-2 px-4 py-3 text-sm font-black transition ${tab === "correct" ? "border-[#ff4655] text-[#c83242]" : "border-transparent text-slate-500 hover:text-slate-900"}`}
        >
          受控更正
        </button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-xs font-bold text-slate-500">加载中…</p>
      ) : tab === "review" ? (
        pendingCount === 0 ? (
          <section className="border border-slate-200 bg-white p-10 text-center">
            <p className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-[#c83242]">NO PENDING REVIEW</p>
            <h2 className="mt-3 text-base font-black text-slate-950">异常队列已清空</h2>
            <p className="mt-2 text-xs font-medium leading-6 text-slate-500">
              裁判报分中，半决赛/决赛的强制复核场次与结果冲突的比赛会自动进入此队列。
            </p>
          </section>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            {/* 左：异常列表 */}
            <section className="border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-sm font-black text-slate-950">待裁决 · {pendingCount}</h2>
              </div>
              <ul>
                {queue.map((item) => (
                  <li key={item.submissionId}>
                    <button
                      onClick={() => openItem(item)}
                      className={`w-full border-l-4 px-5 py-4 text-left transition-colors ${
                        selectedId === item.submissionId ? "border-[#ff4655] bg-[#fff7f7]" : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`border px-1.5 py-0.5 text-[0.5625rem] font-bold ${riskTone(item.riskTag)}`}>{item.riskTag}</span>
                        <span className="font-mono text-[0.5625rem] text-slate-400">{item.boType}</span>
                      </div>
                      <p className="mt-2 text-sm font-black text-slate-950">{item.teamAName} <span className="font-normal text-slate-400">vs</span> {item.teamBName}</p>
                      <p className="mt-1 text-xs text-slate-500">裁判 {item.refereeName} · {fmtTime(item.submittedAt)}</p>
                    </button>
                    <div className="ml-5 border-b border-slate-100" />
                  </li>
                ))}
              </ul>
            </section>

            {/* 右：详情 + 裁决 */}
            {selected ? (
              <section className="border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h2 className="text-sm font-black text-slate-950">{selected.teamAName} vs {selected.teamBName}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {selected.boType} · {selected.round || "未标轮次"} · 赛程 v{selected.basedOnScheduleVersion} · 裁判 {selected.refereeName}
                  </p>
                </div>

                <div className="space-y-4 p-5">
                  <div className={`border px-4 py-3 ${riskTone(selected.riskTag)}`}>
                    <p className="text-xs font-bold">{selected.riskReason}</p>
                  </div>

                  <div className="border border-slate-200 p-4">
                    <p className="font-mono text-[0.5625rem] font-black tracking-[0.14em] text-[#c83242]">拟生效结果</p>
                    <p className="mt-2 text-base font-black text-slate-950">胜者：{selected.declaredWinnerTeamName}</p>
                    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                      {selected.games.map((g, i) => (
                        <div key={i} className="flex items-center justify-between text-xs text-slate-600">
                          <span className="font-mono text-slate-400">{g.map || `局 ${i + 1}`}</span>
                          <span className="font-bold text-slate-900">{g.teamAScore} : {g.teamBScore}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {selected.existingAcceptedWinnerTeamName && (
                    <div className="border-l-4 border-[#ff4655] bg-[#fff7f7] p-4">
                      <p className="font-mono text-[0.5625rem] font-black tracking-[0.14em] text-[#c83242]">与已生效赛果冲突</p>
                      <p className="mt-2 text-sm font-bold text-slate-800">
                        当前生效胜者：{selected.existingAcceptedWinnerTeamName}，裁判提交胜者：{selected.declaredWinnerTeamName}
                      </p>
                    </div>
                  )}

                  <div className="border border-slate-200 p-4">
                    <p className="font-mono text-[0.5625rem] font-black tracking-[0.14em] text-slate-400">比赛凭证</p>
                    {selected.evidenceIds.length > 0 ? (
                      <p className="mt-2 text-xs text-slate-500">已附 {selected.evidenceIds.length} 张凭证（本地阶段仅登记编号，接入私有存储后展示签名预览）</p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">未附凭证</p>
                    )}
                  </div>

                  {(selected.downstreamImpact.hasScheduledDownstream || selected.downstreamImpact.hasProgressedDownstream) && (
                    <div className={`border px-4 py-3 ${selected.downstreamImpact.hasProgressedDownstream ? "border-[#ff4655]/40 bg-[#fff1f2]" : "border-amber-300 bg-amber-50"}`}>
                      <p className="text-xs font-bold">
                        {selected.downstreamImpact.hasProgressedDownstream
                          ? "下游比赛已 BP 或已完赛"
                          : "存在已排期但尚未推进的下游比赛"}
                      </p>
                      {selected.downstreamImpact.affectedMatchIds.length > 0 && (
                        <p className="mt-1 text-xs text-slate-600">受影响：{selected.downstreamImpact.affectedMatchIds.join("、")}</p>
                      )}
                    </div>
                  )}

                  {actionResult && (
                    <div className={`border px-4 py-3 text-sm font-bold ${actionResult.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-[#ff4655]/40 bg-[#fff1f2] text-[#9f2431]"}`}>
                      {actionResult.message}
                    </div>
                  )}

                  <div className="space-y-3 border-t border-slate-100 pt-4">
                    <label className="block">
                      <span className="font-mono text-[0.5625rem] font-black tracking-[0.14em] text-slate-500">裁决原因（必填）</span>
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="说明接受或驳回的依据"
                        rows={2}
                        className="mt-2 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#ff4655] focus:ring-2 focus:ring-[#ff4655]/15"
                        style={{ borderRadius: 0 }}
                      />
                    </label>
                    {actionError && <p className="text-xs font-bold text-[#c83242]">{actionError}</p>}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => doResolve(false)}
                        disabled={busy}
                        className="min-h-11 border border-slate-300 px-5 text-xs font-bold text-slate-600 disabled:opacity-50"
                        style={{ borderRadius: 0 }}
                      >
                        驳回
                      </button>
                      <button
                        onClick={() => doResolve(true)}
                        disabled={busy}
                        className="min-h-11 bg-[#ff4655] px-5 text-xs font-black text-white transition hover:bg-[#d83b48] disabled:opacity-50"
                        style={{ borderRadius: 0 }}
                      >
                        {busy ? "处理中…" : "接受并生效"}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            ) : (
              <section className="border border-dashed border-slate-200 bg-white p-10 text-center">
                <p className="text-xs font-bold text-slate-400">选择左侧一条异常查看详情并裁决</p>
              </section>
            )}
          </div>
        )
      ) : accepted.length === 0 ? (
        <section className="border border-slate-200 bg-white p-10 text-center">
          <p className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-[#c83242]">NO ACCEPTED RESULTS</p>
          <h2 className="mt-3 text-base font-black text-slate-950">暂无已生效赛果</h2>
          <p className="mt-2 text-xs font-medium leading-6 text-slate-500">已生效的正式赛果会出现在这里，可进行受控更正。</p>
        </section>
      ) : (
        /* 受控更正：已生效赛果列表 */
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-black text-slate-950">已生效赛果 · {accepted.length}</h2>
            </div>
            <ul>
              {accepted.map((item) => (
                <li key={item.matchId}>
                  <button
                    onClick={() => openCorrect(item)}
                    className={`w-full border-l-4 px-5 py-4 text-left transition-colors ${
                      correctMatchId === item.matchId ? "border-[#ff4655] bg-[#fff7f7]" : "border-transparent hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[0.5625rem] text-slate-400">{item.boType} · {item.round}</span>
                    </div>
                    <p className="mt-2 text-sm font-black text-slate-950">{item.teamAName} <span className="font-normal text-slate-400">vs</span> {item.teamBName}</p>
                    <p className="mt-1 text-xs text-slate-500">胜者：{item.winnerTeamName}</p>
                  </button>
                  <div className="ml-5 border-b border-slate-100" />
                </li>
              ))}
            </ul>
          </section>

          {correctTarget ? (
            <section className="border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-sm font-black text-slate-950">{correctTarget.teamAName} vs {correctTarget.teamBName}</h2>
                <p className="mt-1 text-xs text-slate-500">当前生效胜者：{correctTarget.winnerTeamName}</p>
              </div>
              <div className="space-y-4 p-5">
                {correctTarget.downstreamImpact.hasProgressedDownstream && (
                  <div className="border border-[#ff4655]/40 bg-[#fff1f2] p-3 text-xs font-bold text-[#9f2431]">
                    下游已 BP 或已完赛，系统会阻止这次更正。请走人工恢复流程。
                  </div>
                )}

                <div className="gap-2">
                  <label className="text-xs font-bold text-slate-700">
                    更正后胜者
                    <select value={correctWinner} onChange={(e) => setCorrectWinner(e.target.value as "A" | "B" | "")} className="mt-1 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm" style={{ borderRadius: 0 }}>
                      <option value="">选择胜者</option>
                      <option value="A">{correctTarget.teamAName}</option>
                      <option value="B">{correctTarget.teamBName}</option>
                    </select>
                  </label>
                </div>

                <div className="space-y-2">
                  {correctGames.map((g, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr] gap-2">
                      <input type="text" value={g.map ?? ""} onChange={(e) => setCorrectGames((prev) => prev.map((x, xi) => xi === i ? { ...x, map: e.target.value } : x))} placeholder="地图" className="border border-slate-300 px-2 py-1.5 text-xs" style={{ borderRadius: 0 }} />
                      <input type="number" min={0} value={g.teamAScore} onChange={(e) => setCorrectGames((prev) => prev.map((x, xi) => xi === i ? { ...x, teamAScore: Number(e.target.value) || 0 } : x))} className="border border-slate-300 px-2 py-1.5 text-xs" style={{ borderRadius: 0 }} />
                      <input type="number" min={0} value={g.teamBScore} onChange={(e) => setCorrectGames((prev) => prev.map((x, xi) => xi === i ? { ...x, teamBScore: Number(e.target.value) || 0 } : x))} className="border border-slate-300 px-2 py-1.5 text-xs" style={{ borderRadius: 0 }} />
                    </div>
                  ))}
                </div>

                <label className="block">
                  <span className="font-mono text-[0.5625rem] font-black tracking-[0.14em] text-slate-500">更正原因（必填）</span>
                  <textarea value={correctReason} onChange={(e) => setCorrectReason(e.target.value)} rows={2} placeholder="说明更正依据" className="mt-2 w-full border border-slate-300 bg-white px-3 py-2.5 text-sm" style={{ borderRadius: 0 }} />
                </label>
                {actionError && <p className="text-xs font-bold text-[#c83242]">{actionError}</p>}
                {actionResult && (
                  <div className={`border px-4 py-3 text-sm font-bold ${actionResult.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-[#ff4655]/40 bg-[#fff1f2] text-[#9f2431]"}`}>
                    {actionResult.message}
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => { setCorrectMatchId(null); setActionError(""); setActionResult(null); }} disabled={busy} className="min-h-11 border border-slate-300 px-5 text-xs font-bold text-slate-600" style={{ borderRadius: 0 }}>取消</button>
                  <button onClick={() => doCorrect()} disabled={busy} className="min-h-11 bg-[#ff4655] px-5 text-xs font-black text-white" style={{ borderRadius: 0 }}>{busy ? "处理中…" : "确认更正"}</button>
                </div>
              </div>
            </section>
          ) : (
            <section className="border border-dashed border-slate-200 bg-white p-10 text-center">
              <p className="text-xs font-bold text-slate-400">选择左侧一条已生效赛果进行受控更正</p>
            </section>
          )}
        </div>
      )}

      <p className="mt-6 text-xs text-slate-400">
        异常裁决只针对裁判报分；管理员在赛程页的手工报分直接生效，不进异常队列。
      </p>
    </div>
  );
}