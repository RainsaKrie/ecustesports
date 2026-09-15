"use client";

// =====================
// RPT-07a 管理员裁判管理工作台
// 能力：创建裁判（一次性展示凭证）、停用、重置凭证、分配 / 撤销比赛。
// 视觉对齐管理端规格：无圆角、白卡 + 1px 墨线、品牌红强调、无阴影、字号放大。
// =====================

import { useCallback, useEffect, useState } from "react";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

type RefereeRow = {
  id: string;
  displayName: string;
  status: "active" | "disabled";
  credentialExpiresAt: string;
  createdAt: string;
  disabledAt?: string;
  assignmentCount: number;
};

type MatchRow = {
  matchId: string;
  teamAName: string;
  teamBName: string;
  boType: string;
  round: string;
  status: string;
  assignedRefereeIds: string[];
};

type AssignmentRow = { assignmentId: string; matchId: string; refereeId: string; selfClaimed?: boolean };

function fmtTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export default function RefereeWorkspace({ eventId }: { eventId: string }) {
  const [referees, setReferees] = useState<RefereeRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 创建
  const [createName, setCreateName] = useState("");
  const [createExpiry, setCreateExpiry] = useState("");
  // 一次性凭证明文（创建/重置后展示一次）
  const [revealed, setRevealed] = useState<{ label: string; credential: string } | null>(null);

  // 分配
  const [assignRefereeId, setAssignRefereeId] = useState("");
  const [assignMatchId, setAssignMatchId] = useState("");

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionResult, setActionResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/admin/referees?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" });
      if (!res.ok) { setError("加载裁判列表失败"); return; }
      const data = (await res.json()) as { referees: RefereeRow[]; matches: MatchRow[]; assignments: AssignmentRow[] };
      setReferees(data.referees);
      setMatches(data.matches);
      setAssignments(Array.isArray(data.assignments) ? data.assignments : []);
    } catch {
      setError("网络连接失败");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/referees?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("加载裁判列表失败")))
      .then((data: { referees: RefereeRow[]; matches: MatchRow[]; assignments: AssignmentRow[] }) => {
        if (cancelled) return;
        setReferees(data.referees);
        setMatches(data.matches);
        setAssignments(Array.isArray(data.assignments) ? data.assignments : []);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) { setError("网络连接失败"); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [eventId]);

  function nameOf(refereeId: string): string {
    return referees.find((r) => r.id === refereeId)?.displayName ?? refereeId;
  }
  function matchLabel(matchId: string): string {
    const m = matches.find((x) => x.matchId === matchId);
    return m ? `${m.teamAName} vs ${m.teamBName} · ${m.boType}` : matchId;
  }

  async function post(action: string, payload: Record<string, unknown>) {
    setBusy(true);
    setActionError("");
    setActionResult(null);
    setRevealed(null);
    try {
      const res = await fetch("/api/admin/referees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, action, payload }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; credential?: string; refereeId?: string };
      if (!res.ok) { setActionResult({ ok: false, message: data.message ?? "操作失败" }); setBusy(false); return; }
      setActionResult({ ok: true, message: "操作完成" });
      if (data.credential) {
        setRevealed({ label: action === "create" ? "新裁判访问凭证（只展示一次，请立即抄录）" : "重置后的访问凭证（旧凭证已失效）", credential: data.credential });
      }
      await load();
    } catch {
      setActionResult({ ok: false, message: "网络连接失败" });
    } finally {
      setBusy(false);
    }
  }

  function doCreate() {
    if (!createName.trim()) { setActionError("请输入裁判姓名"); return; }
    const payload: Record<string, unknown> = { displayName: createName.trim() };
    if (createExpiry) payload.credentialExpiresAt = `${createExpiry}:00`;
    void post("create", payload);
    setCreateName("");
  }

  function doDisable(refereeId: string, displayName: string) {
    if (!window.confirm(`停用《${displayName}》后，其凭证将立即无法用于报分，且不可恢复。确认停用？`)) return;
    void post("disable", { refereeId });
  }

  function doReset(refereeId: string, displayName: string) {
    if (!window.confirm(`重置《${displayName}》的凭证后，旧凭证立即失效。确认重置？`)) return;
    void post("reset", { refereeId });
  }

  function doAssign() {
    if (!assignRefereeId || !assignMatchId) { setActionError("请选择裁判与比赛"); return; }
    void post("assign", { refereeId: assignRefereeId, matchId: assignMatchId });
    setAssignMatchId("");
  }

  function doRevoke(assignmentId: string) {
    const asg = assignments.find((a) => a.assignmentId === assignmentId);
    if (!asg) return;
    if (!window.confirm(`撤销《${nameOf(asg.refereeId)}》对「${matchLabel(asg.matchId)}」的分配？`)) return;
    void post("revoke", { assignmentId });
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow="MODULE 02 / REFEREES"
        title="裁判管理"
        description="创建裁判、分配比赛、停用与重置凭证。创建与重置时凭证只展示一次，请立即抄录并分发给对应裁判。"
        status={referees.length > 0 ? `${referees.length} 名裁判` : "暂无裁判"}
        actions={
          <button type="button" onClick={() => void load()} className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-600">
            刷新
          </button>
        }
      />

      {error && <div className="mb-5 border border-[#ff4655] bg-[#fff1f2] px-5 py-3 text-sm font-bold text-[#9f2431]">{error}</div>}

      {revealed && (
        <div className="mb-5 border-l-4 border-[#ff4655] bg-[#fff7f7] p-4">
          <p className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-[#c83242]">{revealed.label}</p>
          <p className="mt-2 break-all font-mono text-sm font-black text-[#171a1f]">{revealed.credential}</p>
          <button onClick={() => setRevealed(null)} className="mt-3 border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-600" style={{ borderRadius: 0 }}>我已抄录，关闭</button>
        </div>
      )}

      {actionResult && (
        <div className={`mb-5 border px-5 py-3 text-sm font-bold ${actionResult.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-[#ff4655]/40 bg-[#fff1f2] text-[#9f2431]"}`}>
          {actionResult.message}
        </div>
      )}

      {loading ? (
        <p className="py-10 text-center text-xs font-bold text-slate-500">加载中…</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* 左：创建 + 裁判列表 */}
          <section className="border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-black text-slate-950">创建裁判</h2>
            </div>
            <div className="space-y-3 p-5">
              <label className="block">
                <span className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-slate-500">裁判姓名</span>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="例如：张三"
                  className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#ff4655]"
                  style={{ borderRadius: 0 }}
                />
              </label>
              <label className="block">
                <span className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-slate-500">凭证有效期（可选，默认 90 天）</span>
                <input
                  type="datetime-local"
                  value={createExpiry}
                  onChange={(e) => setCreateExpiry(e.target.value)}
                  className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#ff4655]"
                  style={{ borderRadius: 0 }}
                />
              </label>
              {actionError && <p className="text-xs font-bold text-[#c83242]">{actionError}</p>}
              <button onClick={doCreate} disabled={busy} className="min-h-12 w-full bg-[#ff4655] px-4 py-3 text-sm font-black text-white transition hover:bg-[#d83b48] disabled:opacity-50" style={{ borderRadius: 0 }}>
                {busy ? "处理中…" : "创建裁判"}
              </button>
            </div>

            <div className="border-t border-slate-200 px-5 py-4">
              <h2 className="text-sm font-black text-slate-950">裁判列表 · {referees.length}</h2>
            </div>
            {referees.length === 0 ? (
              <div className="border-t border-slate-100 p-6 text-center text-xs font-bold text-slate-400">暂无裁判，先创建一名。</div>
            ) : (
              <ul>
                {referees.map((r) => (
                  <li key={r.id} className="border-t border-slate-100">
                    <div className="flex items-center justify-between gap-3 px-5 py-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-slate-950">{r.displayName}</span>
                          <span className={`border px-1.5 py-0.5 text-[0.5625rem] font-bold ${r.status === "active" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-slate-50 text-slate-500"}`}>
                            {r.status === "active" ? "可用" : "已停用"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">已分配 {r.assignmentCount} 场 · 有效期至 {fmtTime(r.credentialExpiresAt)}</p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {r.status === "active" && (
                          <button onClick={() => doReset(r.id, r.displayName)} disabled={busy} className="border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-950 disabled:opacity-50" style={{ borderRadius: 0 }}>
                            重置凭证
                          </button>
                        )}
                        {r.status === "active" && (
                          <button onClick={() => doDisable(r.id, r.displayName)} disabled={busy} className="border border-[#ff4655]/40 bg-[#fff1f2] px-3 py-1.5 text-xs font-bold text-[#c83242] hover:bg-[#ff4655] hover:text-white disabled:opacity-50" style={{ borderRadius: 0 }}>
                            停用
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 右：分配比赛 */}
          <section className="border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-black text-slate-950">分配比赛</h2>
            </div>
            <div className="space-y-3 p-5">
              <label className="block">
                <span className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-slate-500">裁判</span>
                <select value={assignRefereeId} onChange={(e) => setAssignRefereeId(e.target.value)} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#ff4655]" style={{ borderRadius: 0 }}>
                  <option value="">选择裁判</option>
                  {referees.filter((r) => r.status === "active").map((r) => <option key={r.id} value={r.id}>{r.displayName}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-slate-500">比赛</span>
                <select value={assignMatchId} onChange={(e) => setAssignMatchId(e.target.value)} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#ff4655]" style={{ borderRadius: 0 }}>
                  <option value="">选择比赛</option>
                  {matches.map((m) => <option key={m.matchId} value={m.matchId}>{m.teamAName} vs {m.teamBName} · {m.boType}</option>)}
                </select>
              </label>
              <button onClick={doAssign} disabled={busy || !assignRefereeId || !assignMatchId} className="min-h-12 w-full bg-[#0f1923] px-4 py-3 text-sm font-black text-white transition hover:bg-[#25313b] disabled:opacity-40" style={{ borderRadius: 0 }}>
                分配
              </button>
            </div>

            <div className="border-t border-slate-200 px-5 py-4">
              <h2 className="text-sm font-black text-slate-950">当前分配 · {assignments.length}</h2>
            </div>
            {assignments.length === 0 ? (
              <div className="border-t border-slate-100 p-6 text-center text-xs font-bold text-slate-400">暂无分配。</div>
            ) : (
              <ul>
                {assignments.map((a) => (
                  <li key={a.assignmentId} className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900">
                        {nameOf(a.refereeId)}
                        <span className={`ml-2 border px-1.5 py-0.5 text-[0.5625rem] font-bold ${a.selfClaimed ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-slate-50 text-slate-600"}`}>
                          {a.selfClaimed ? "裁判认领" : "负责人指派"}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{matchLabel(a.matchId)}</p>
                    </div>
                    <button onClick={() => doRevoke(a.assignmentId)} disabled={busy} className="shrink-0 border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-[#ff4655] hover:text-[#c83242] disabled:opacity-50" style={{ borderRadius: 0 }}>
                      撤销
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}