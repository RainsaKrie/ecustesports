"use client";

// =====================
// RPT-07a 管理员裁判管理工作台
// 能力：创建裁判（一次性展示凭证）、停用、重置凭证、分配 / 撤销比赛。
// 视觉对齐管理端规格：无圆角、白卡 + 1px 墨线、品牌红强调、无阴影、字号放大。
// =====================

import { useCallback, useEffect, useState } from "react";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { EmptyState, useAdminConfirm } from "@/components/admin/ui";

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
  const confirm = useAdminConfirm();
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

  async function doDisable(refereeId: string, displayName: string) {
    const confirmed = await confirm({
      title: `停用裁判《${displayName}》？`,
      body: "停用后其凭证将立即无法用于报分，且不可恢复。",
      confirmLabel: "停用",
      tone: "danger",
    });
    if (!confirmed) return;
    void post("disable", { refereeId });
  }

  async function doReset(refereeId: string, displayName: string) {
    const confirmed = await confirm({
      title: `重置《${displayName}》的凭证？`,
      body: "重置后旧凭证立即失效。新凭证只会展示一次，请立即抄录并重新分发。",
      confirmLabel: "重置凭证",
      tone: "danger",
    });
    if (!confirmed) return;
    void post("reset", { refereeId });
  }

  function doAssign() {
    if (!assignRefereeId || !assignMatchId) { setActionError("请选择裁判与比赛"); return; }
    void post("assign", { refereeId: assignRefereeId, matchId: assignMatchId });
    setAssignMatchId("");
  }

  async function doRevoke(assignmentId: string) {
    const asg = assignments.find((a) => a.assignmentId === assignmentId);
    if (!asg) return;
    const confirmed = await confirm({
      title: "撤销这次裁判分配？",
      body: `将撤销《${nameOf(asg.refereeId)}》对「${matchLabel(asg.matchId)}」的分配。`,
      confirmLabel: "撤销分配",
      tone: "danger",
    });
    if (!confirmed) return;
    void post("revoke", { assignmentId });
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow="模块 02"
        title="裁判管理"
        description="创建裁判、分配比赛、停用与重置凭证。创建与重置时凭证只展示一次，请立即抄录并分发给对应裁判。"
        status={referees.length > 0 ? `${referees.length} 名裁判` : "暂无裁判"}
        actions={
          <button type="button" onClick={() => void load()} className="adm-btn adm-btn--secondary adm-btn--md">
            刷新
          </button>
        }
      />

      {error && <div className="adm-note adm-note--danger mb-5 text-[length:var(--adm-fs-lg)] font-semibold">{error}</div>}

      {revealed && (
        <div className="adm-note adm-note--danger mb-5">
          <p className="text-[length:var(--adm-fs-sm)] font-medium tracking-[0.14em] text-[var(--adm-text-mute)]">{revealed.label}</p>
          <p className="mt-2 break-all text-[length:var(--adm-fs-lg)] font-semibold tabular-nums text-[var(--adm-text)]">{revealed.credential}</p>
          <button onClick={() => setRevealed(null)} className="adm-btn adm-btn--secondary adm-btn--md mt-3">我已抄录，关闭</button>
        </div>
      )}

      {actionResult && (
        <div className={`adm-note mb-5 ${actionResult.ok ? "adm-note--ok" : "adm-note--danger"} text-[length:var(--adm-fs-lg)] font-semibold`}>
          {actionResult.message}
        </div>
      )}

      {loading ? (
        <p className="py-10 text-center text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">加载中…</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* 左：创建 + 裁判列表 */}
          <section className="adm-panel">
            <div className="border-b border-[var(--adm-line-soft)] px-5 py-4">
              <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">创建裁判</h2>
            </div>
            <div className="space-y-3 p-5">
              <label className="block">
                <span className="text-[length:var(--adm-fs-sm)] font-medium tracking-[0.14em] text-[var(--adm-text-soft)]">裁判姓名</span>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="例如：张三"
                  className="mt-2 h-[44px] w-full adm-input px-3 text-[length:var(--adm-fs-lg)] text-[var(--adm-text)] outline-none focus:border-[var(--adm-red)]"
                />
              </label>
              <label className="block">
                <span className="text-[length:var(--adm-fs-sm)] font-medium tracking-[0.14em] text-[var(--adm-text-soft)]">凭证有效期（可选，默认 90 天）</span>
                <input
                  type="datetime-local"
                  value={createExpiry}
                  onChange={(e) => setCreateExpiry(e.target.value)}
                  className="mt-2 h-[44px] w-full adm-input px-3 text-[length:var(--adm-fs-lg)] text-[var(--adm-text)] outline-none focus:border-[var(--adm-red)]"
                />
              </label>
              {actionError && <p className="text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-red-text)]">{actionError}</p>}
              <button onClick={doCreate} disabled={busy} className="adm-btn adm-btn--primary adm-btn--lg w-full hover:bg-[var(--adm-red-hover)]">
                {busy ? "处理中…" : "创建裁判"}
              </button>
            </div>

            <div className="border-t border-[var(--adm-line-soft)] px-5 py-4">
              <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">裁判列表 · {referees.length}</h2>
            </div>
            {referees.length === 0 ? (
              <div className="border-t border-[var(--adm-line-soft)] p-5">
                <EmptyState
                  title="还没有裁判"
                  description="用上面的表单创建。凭证只在创建的那一次显示，请当场抄录并分发给本人，关掉就看不到了。"
                />
              </div>
            ) : (
              <ul>
                {referees.map((r) => (
                  <li key={r.id} className="border-t border-[var(--adm-line-soft)]">
                    <div className="flex items-center justify-between gap-3 px-5 py-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{r.displayName}</span>
                          <span className="adm-chip" data-tone={r.status === "active" ? "done" : "neutral"}>
                            {r.status === "active" ? "可用" : "已停用"}
                          </span>
                        </div>
                        <p className="mt-1 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">已分配 {r.assignmentCount} 场 · 有效期至 {fmtTime(r.credentialExpiresAt)}</p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {r.status === "active" && (
                          <button onClick={() => doReset(r.id, r.displayName)} disabled={busy} className="adm-btn adm-btn--secondary adm-btn--md">
                            重置凭证
                          </button>
                        )}
                        {r.status === "active" && (
                          <button onClick={() => doDisable(r.id, r.displayName)} disabled={busy} className="adm-btn adm-btn--danger adm-btn--md hover:border-[var(--adm-red)] hover:bg-[var(--adm-red-soft)]">
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
          <section className="adm-panel">
            <div className="border-b border-[var(--adm-line-soft)] px-5 py-4">
              <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">分配比赛</h2>
            </div>
            <div className="space-y-3 p-5">
              <label className="block">
                <span className="text-[length:var(--adm-fs-sm)] font-medium tracking-[0.14em] text-[var(--adm-text-soft)]">裁判</span>
                <select value={assignRefereeId} onChange={(e) => setAssignRefereeId(e.target.value)} className="mt-2 h-[44px] w-full adm-input px-3 text-[length:var(--adm-fs-lg)] text-[var(--adm-text)] outline-none focus:border-[var(--adm-red)]">
                  <option value="">选择裁判</option>
                  {referees.filter((r) => r.status === "active").map((r) => <option key={r.id} value={r.id}>{r.displayName}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[length:var(--adm-fs-sm)] font-medium tracking-[0.14em] text-[var(--adm-text-soft)]">比赛</span>
                <select value={assignMatchId} onChange={(e) => setAssignMatchId(e.target.value)} className="mt-2 h-[44px] w-full adm-input px-3 text-[length:var(--adm-fs-lg)] text-[var(--adm-text)] outline-none focus:border-[var(--adm-red)]">
                  <option value="">选择比赛</option>
                  {matches.map((m) => <option key={m.matchId} value={m.matchId}>{m.teamAName} vs {m.teamBName} · {m.boType}</option>)}
                </select>
              </label>
              {/* 原来用深墨 `--ink` 填充，是全站唯一一处「非标准色」的实心按钮。
                  改成标准的主操作档：它是这张表单里唯一的提交动作。 */}
              <button onClick={doAssign} disabled={busy || !assignRefereeId || !assignMatchId} className="adm-btn adm-btn--primary adm-btn--lg w-full">
                分配
              </button>
            </div>

            <div className="border-t border-[var(--adm-line-soft)] px-5 py-4">
              <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">当前分配 · {assignments.length}</h2>
            </div>
            {assignments.length === 0 ? (
              <div className="border-t border-[var(--adm-line-soft)] p-5">
                <EmptyState
                  title="还没有分配比赛"
                  description="用上面的表单选一名裁判和一场比赛。分配后这场比赛会出现在该裁判的裁判端列表里，他才能认领并报分。"
                />
              </div>
            ) : (
              <ul>
                {assignments.map((a) => (
                  <li key={a.assignmentId} className="flex items-center justify-between gap-3 border-t border-[var(--adm-line-soft)] px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-[length:var(--adm-fs-lg)] font-bold text-[var(--adm-text)]">
                        {nameOf(a.refereeId)}
                        <span className="adm-chip ml-2" data-tone={a.selfClaimed ? "done" : "neutral"}>
                          {a.selfClaimed ? "裁判认领" : "负责人指派"}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">{matchLabel(a.matchId)}</p>
                    </div>
                    <button onClick={() => doRevoke(a.assignmentId)} disabled={busy} className="adm-btn adm-btn--secondary adm-btn--md shrink-0 hover:border-[var(--adm-red)] hover:text-[var(--adm-red-text)]">
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