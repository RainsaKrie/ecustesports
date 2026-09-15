"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";

import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import {
  initialRegistration,
  normalizeRegistrationState,
  POSITIONS,
  type RegistrationAuditLog,
  type RegistrationPlayer,
  type RegistrationState,
  type RegistrationTeam,
} from "@/lib/scheduling/registration-data";

type Tab = "players" | "teams" | "history";
type ReviewStatus = NonNullable<RegistrationPlayer["reviewStatus"]>;
type Role = NonNullable<RegistrationPlayer["role"]>;
type Modal =
  | { kind: "edit-player"; player: RegistrationPlayer }
  | { kind: "delete-player"; player: RegistrationPlayer }
  | { kind: "create-team" }
  | { kind: "assign-player"; player?: RegistrationPlayer; team?: RegistrationTeam; role?: Role }
  | { kind: "remove-player"; player: RegistrationPlayer }
  | { kind: "reopen-team"; team: RegistrationTeam }
  | { kind: "replace-player"; team: RegistrationTeam; outgoing?: RegistrationPlayer }
  | { kind: "withdraw-team"; team: RegistrationTeam }
  | { kind: "dissolve-team"; team: RegistrationTeam }
  | { kind: "rename-team"; team: RegistrationTeam }
  | { kind: "set-member-role"; player: RegistrationPlayer };

const inputClass = "w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#ff4655] focus:ring-2 focus:ring-[#ff4655]/15";

/**
 * 卡片内的文字型操作按钮（改角色 / 换人 / 移出 / 审核通过 / 编辑资料 / 删除选手）。
 *
 * 视觉上保持轻量，但**触控区必须够大**：这些按钮原本只有文字高度（实测 15px），
 * 在手机上很难点准，而其中「移出」「删除选手」是破坏性操作——误触的代价是丢数据。
 * min-h-11 = 44px，是移动端触控目标的推荐下限。
 */
const textActionClass = "inline-flex min-h-11 items-center whitespace-nowrap font-bold hover:underline";
const subscribeStatic = () => () => {};

function reviewTone(status: ReviewStatus | undefined) {
  switch (status) {
    case "已通过": return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "需修改": return "border-amber-200 bg-amber-50 text-amber-700";
    case "已拒绝": return "border-red-200 bg-red-50 text-red-700";
    default: return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function teamTone(status: RegistrationTeam["status"]) {
  if (status === "已冻结") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "已退赛") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function contactOf(player: RegistrationPlayer) {
  return player.qq || player.phone || "未填写";
}

function RosterMemberRow({
  player,
  team,
  role,
  index,
  onReplace,
  onRemove,
  onChangeRole,
}: {
  player: RegistrationPlayer;
  team: RegistrationTeam;
  role: Role;
  index: number;
  onReplace: () => void;
  onRemove: () => void;
  onChangeRole?: () => void;
}) {
  const rosterLabel = team.captainId === player.id ? "队长" : `${role} ${index + 1}`;

  return (
    <div className="grid min-h-12 gap-2 border border-slate-200 bg-white px-3 py-2.5 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="truncate font-black text-slate-950" title={player.gameId}>{player.gameId}</p>
        <p className="mt-1 truncate text-[0.625rem] font-bold text-slate-400">{rosterLabel}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:flex-nowrap sm:justify-end">
        <span className={`shrink-0 whitespace-nowrap border px-1.5 py-0.5 text-[0.5rem] font-bold ${reviewTone(player.reviewStatus)}`}>{player.reviewStatus ?? "待审核"}</span>
        {team.status === "报名中" && onChangeRole && <button type="button" onClick={onChangeRole} className={`shrink-0 ${textActionClass} text-slate-700`}>改角色</button>}
        {team.status !== "已退赛" && <button type="button" onClick={onReplace} className={`shrink-0 ${textActionClass} text-[#c83242]`}>换人</button>}
        {team.status === "报名中" && <button type="button" onClick={onRemove} className={`shrink-0 ${textActionClass} text-red-700`}>移出</button>}
      </div>
    </div>
  );
}

function ModalShell({ title, subtitle, onClose, children, footer }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto border border-slate-300 bg-[#f8f6f1] shadow-2xl">
        <div className="flex items-start justify-between gap-5 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-base font-black text-slate-950">{title}</h2>
            {subtitle && <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-xs font-bold text-slate-400 hover:text-slate-900">关闭</button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">{footer}</div>
      </div>
    </div>
  );
}

function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-slate-700">{label}</span>
      {children}
      {help && <span className="mt-1.5 block text-[0.625rem] leading-4 text-slate-400">{help}</span>}
    </label>
  );
}

export default function RegistrationOperationsWorkspace({ eventId }: { eventId: string }) {
  const router = useRouter();
  const event = useCurrentEventConfig(eventId);
  const origin = useSyncExternalStore(subscribeStatic, () => window.location.origin, () => "");
  const [state, setState] = useState<RegistrationState>(initialRegistration());
  const [bracketTeamIds, setBracketTeamIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [tab, setTab] = useState<Tab>("players");
  const [query, setQuery] = useState("");
  const [reviewFilter, setReviewFilter] = useState<"全部" | ReviewStatus>("全部");
  const [playerPage, setPlayerPage] = useState(1);
  const [modal, setModal] = useState<Modal | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [editPositions, setEditPositions] = useState<string[]>([]);

  const registerUrl = origin ? `${origin}/events/${eventId}/register` : "";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/registration?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error((data as { message?: string }).message ?? "报名数据读取失败");
        if (!cancelled) {
          setState(normalizeRegistrationState((data as { state?: unknown }).state));
          setBracketTeamIds((data as { bracketTeamIds?: string[] }).bracketTeamIds ?? []);
        }
      })
      .catch((reason) => {
        if (!cancelled) setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "报名数据读取失败" });
      })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [eventId]);

  const activePlayers = state.players.filter((player) => player.status !== "已退赛");
  const waitingReview = activePlayers.filter((player) => (player.reviewStatus ?? "待审核") === "待审核").length;
  const needsChanges = activePlayers.filter((player) => player.reviewStatus === "需修改").length;
  const unteamedApproved = activePlayers.filter((player) => player.status === "已报名" && player.reviewStatus === "已通过");
  const activeTeams = state.teams.filter((team) => team.status !== "已退赛");
  const confirmedTeams = activeTeams.filter((team) => team.status === "已冻结").length;
  const visiblePlayers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return state.players.filter((player) => {
      if (reviewFilter !== "全部" && (player.reviewStatus ?? "待审核") !== reviewFilter) return false;
      if (!keyword) return true;
      return [player.gameId, player.name, player.studentId, player.rank, ...(player.positions ?? [])]
        .some((value) => value?.toLowerCase().includes(keyword));
    });
  }, [query, reviewFilter, state.players]);
  const pageSize = 20;
  const playerPageCount = Math.max(1, Math.ceil(visiblePlayers.length / pageSize));
  const safePlayerPage = Math.min(playerPage, playerPageCount);
  const pagedPlayers = visiblePlayers.slice((safePlayerPage - 1) * pageSize, safePlayerPage * pageSize);
  const latestUndoable = (state.operationLogs ?? []).find((log) => !log.undoneAt);

  function openModal(next: Modal) {
    setModal(next);
    setNotice(null);
    if (next.kind === "edit-player") {
      setForm({
        name: next.player.name,
        studentId: next.player.studentId,
        gameId: next.player.gameId,
        rank: next.player.rank,
        qq: next.player.qq ?? "",
        phone: next.player.phone ?? "",
        intro: next.player.intro ?? "",
        reason: "",
      });
      setEditPositions(next.player.positions ?? []);
      return;
    }
    if (next.kind === "create-team") {
      setForm({ name: "", captainId: unteamedApproved[0]?.id ?? "", captainRole: "首发" });
      return;
    }
    if (next.kind === "rename-team") {
      setForm({ name: next.team.name, reason: "" });
      return;
    }
    if (next.kind === "set-member-role") {
      setForm({ playerId: next.player.id, role: next.player.role ?? "首发", reason: "" });
      return;
    }
    if (next.kind === "assign-player") {
      setForm({
        playerId: next.player?.id ?? unteamedApproved[0]?.id ?? "",
        teamId: next.team?.id ?? activeTeams.find((team) => team.status === "报名中")?.id ?? "",
        role: next.role ?? "首发",
      });
      return;
    }
    if (next.kind === "replace-player") {
      const members = state.players.filter((player) => player.teamId === next.team.id);
      setForm({ outgoingPlayerId: next.outgoing?.id ?? members[0]?.id ?? "", incomingPlayerId: unteamedApproved[0]?.id ?? "", reason: "" });
      return;
    }
    setForm({ reason: "", replacementCaptainId: "" });
  }

  async function runOperation(action: string, payload: Record<string, unknown> = {}, close = true) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, action, payload }),
      });
      const data = await response.json().catch(() => ({})) as { message?: string; state?: RegistrationState };
      if (data.state) setState(normalizeRegistrationState(data.state));
      if (!response.ok) throw new Error(data.message ?? "操作失败");
      setNotice({ kind: "success", text: data.message ?? "操作已完成" });
      if (close) setModal(null);
      router.refresh();
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "操作失败，请重试" });
    } finally {
      setBusy(false);
    }
  }

  function submitModal() {
    if (!modal) return;
    if (modal.kind === "edit-player") return runOperation("update-player", { playerId: modal.player.id, ...form, positions: editPositions });
    if (modal.kind === "delete-player") return runOperation("delete-player", { playerId: modal.player.id });
    if (modal.kind === "create-team") return runOperation("create-team", form);
    if (modal.kind === "assign-player") return runOperation("assign-player", form);
    if (modal.kind === "remove-player") return runOperation("remove-player", { playerId: modal.player.id, reason: form.reason, replacementCaptainId: form.replacementCaptainId });
    if (modal.kind === "reopen-team") return runOperation("reopen-team", { teamId: modal.team.id, reason: form.reason });
    if (modal.kind === "replace-player") return runOperation("replace-player", { teamId: modal.team.id, ...form });
    if (modal.kind === "withdraw-team") return runOperation("withdraw-team", { teamId: modal.team.id, reason: form.reason });
    if (modal.kind === "dissolve-team") return runOperation("dissolve-team", { teamId: modal.team.id, reason: form.reason });
    if (modal.kind === "rename-team") return runOperation("rename-team", { teamId: modal.team.id, name: form.name, reason: form.reason });
    if (modal.kind === "set-member-role") return runOperation("set-member-role", { playerId: modal.player.id, role: form.role, reason: form.reason });
  }

  function captainReplacementOptions(player: RegistrationPlayer) {
    if (!player.teamId) return [];
    const team = state.teams.find((candidate) => candidate.id === player.teamId);
    if (team?.captainId !== player.id) return [];
    return state.players.filter((candidate) => candidate.teamId === player.teamId && candidate.id !== player.id);
  }

  if (!loaded) {
    return <div className="border border-slate-200 bg-white px-6 py-20 text-center text-sm text-slate-500">正在读取报名与队伍数据…</div>;
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow="MODULE 01 / REGISTER"
        title="报名与队伍"
        status={waitingReview > 0 ? `${waitingReview} 人待审核` : `${confirmedTeams}/${activeTeams.length} 队已确认`}
        actions={(
          <>
            <a href={`/api/admin/registration/export?eventId=${encodeURIComponent(eventId)}`} className="border border-slate-300 bg-white inline-flex min-h-11 items-center px-4 text-xs font-bold text-slate-700 hover:border-slate-950">导出报名</a>
            <button type="button" onClick={() => openModal({ kind: "create-team" })} disabled={busy || state.teamRegistrationClosed} className="border border-slate-300 bg-white inline-flex min-h-11 items-center px-4 text-xs font-bold text-slate-700 hover:border-slate-950 disabled:cursor-not-allowed disabled:text-slate-300">代建队伍</button>
            <button type="button" onClick={() => runOperation("toggle-player-registration")} disabled={busy} className="border border-slate-300 bg-white inline-flex min-h-11 items-center px-4 text-xs font-bold text-slate-700 hover:border-slate-950 disabled:opacity-50">{state.playerRegistrationClosed ? "开放选手报名" : "截止选手报名"}</button>
            <button type="button" onClick={() => runOperation("toggle-team-registration")} disabled={busy} className={`inline-flex min-h-11 items-center px-4 text-xs font-bold disabled:opacity-50 ${state.teamRegistrationClosed ? "border border-slate-300 bg-white text-slate-700" : "bg-[#ff4655] text-white hover:bg-[#d83b48]"}`}>{state.teamRegistrationClosed ? "开放队伍申报" : "截止队伍申报"}</button>
          </>
        )}
      />

      {notice && (
        <div className={`mb-5 flex items-start justify-between gap-4 border px-4 py-3 text-xs font-bold ${notice.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`} role="status">
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 font-black">×</button>
        </div>
      )}

      <section className="mb-5 grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["有效报名", `${activePlayers.length} 人`],
          ["待审核", `${waitingReview} 人`],
          ["需修改", `${needsChanges} 人`],
          ["已审核未组队", `${unteamedApproved.length} 人`],
          ["正式队伍", `${confirmedTeams}/${activeTeams.length} 支`],
        ].map(([label, value]) => (
          <div key={label} className="bg-white p-4">
            <p className="text-[0.625rem] font-bold tracking-[0.12em] text-slate-400">{label}</p>
            <p className="mt-2 font-mono text-2xl font-black text-slate-950">{value}</p>
          </div>
        ))}
      </section>

      <section className="mb-5 border border-slate-200 bg-white">
        <div className="grid gap-5 p-5 md:grid-cols-[auto_1fr] md:items-center">
          <div className="w-fit border border-slate-200 bg-white p-2">
            {registerUrl ? <QRCodeSVG value={registerUrl} size={92} /> : <div className="h-[92px] w-[92px] bg-slate-50" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-950">给选手的报名入口</p>
            <p className="mt-1 break-all text-xs text-slate-500">{registerUrl || "正在生成链接…"}</p>
            <p className="mt-2 text-[0.625rem] font-bold text-slate-500">选手报名截止 {event.registrationEnd || "待定"} · 队伍申报截止 {event.teamRegistrationEnd || "待定"}</p>
          </div>
        </div>
      </section>

      <section className="border border-slate-200 bg-white">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-200 md:flex-row md:items-center">
          <div className="flex overflow-x-auto">
            {([
              ["players", "选手", state.players.length],
              ["teams", "队伍", state.teams.length],
              ["history", "操作记录", state.operationLogs?.length ?? 0],
            ] as const).map(([value, label, count]) => (
              <button key={value} type="button" onClick={() => setTab(value)} className={`shrink-0 border-r border-slate-200 px-5 py-3.5 text-sm font-bold ${tab === value ? "border-b-2 border-b-[#ff4655] bg-[#fff1f2] text-slate-950" : "text-slate-500 hover:text-slate-950"}`}>
                {label} <span className="ml-1 font-mono text-[0.625rem] text-slate-400">{count}</span>
              </button>
            ))}
          </div>
          {tab === "players" && (
            <div className="flex gap-2 px-3 pb-3 md:pb-0">
              <button type="button" onClick={() => runOperation("approve-all-players")} disabled={busy || waitingReview + needsChanges === 0} className="inline-flex min-h-11 shrink-0 items-center bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">全部通过{waitingReview + needsChanges > 0 ? `（${waitingReview + needsChanges} 人）` : ""}</button>
              <input value={query} onChange={(event) => { setQuery(event.target.value); setPlayerPage(1); }} placeholder="搜索游戏 ID、姓名或学号" className="min-h-11 min-w-0 border border-slate-200 px-3 text-xs outline-none focus:border-[#ff4655] md:w-56" />
              <select value={reviewFilter} onChange={(event) => { setReviewFilter(event.target.value as typeof reviewFilter); setPlayerPage(1); }} className="min-h-11 border border-slate-200 bg-white px-2 text-xs outline-none">
                {(["全部", "待审核", "已通过", "需修改", "已拒绝"] as const).map((status) => <option key={status}>{status}</option>)}
              </select>
            </div>
          )}
        </div>

        {tab === "players" && (
          visiblePlayers.length === 0 ? <p className="px-5 py-16 text-center text-xs text-slate-400">没有符合条件的选手</p> : (
            <div className="divide-y divide-slate-100">
              {pagedPlayers.map((player) => {
                const team = state.teams.find((candidate) => candidate.id === player.teamId);
                return (
                  <article key={player.id} className={`p-4 ${player.status === "已退赛" ? "bg-slate-50/70 text-slate-400" : "text-slate-700"}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-950">{player.gameId}</p>
                        <p className="mt-1 text-[0.625rem]">{player.name} · {player.studentId}</p>
                      </div>
                      <span className={`shrink-0 border px-2 py-1 text-[0.5625rem] font-bold ${reviewTone(player.reviewStatus)}`}>{player.reviewStatus ?? "待审核"}</span>
                    </div>
                    <div className="mt-3 grid gap-2 border-y border-slate-100 py-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
                      <div><p className="text-[0.5625rem] font-bold text-slate-400">段位 / 位置</p><p className="mt-1">{player.rank} · {(player.positions ?? []).join("、") || "未填"}</p></div>
                      <div><p className="text-[0.5625rem] font-bold text-slate-400">联系方式</p><p className="mt-1">{contactOf(player)}</p></div>
                      <div className="sm:col-span-2"><p className="text-[0.5625rem] font-bold text-slate-400">队伍状态</p><p className="mt-1">{team ? <><span className="font-bold text-slate-800">{team.name}</span><span className="ml-1 text-slate-400">· {player.role}</span></> : player.status === "已退赛" ? "已退赛" : "未组队"}</p></div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[0.625rem] font-bold">
                      {player.status !== "已退赛" && (player.reviewStatus === "待审核" || player.reviewStatus === "需修改") && <button type="button" onClick={() => runOperation("review-player", { playerId: player.id, reviewStatus: "已通过" })} disabled={busy} className={`${textActionClass} text-emerald-700 disabled:text-slate-400`}>审核通过</button>}
                      <button type="button" onClick={() => openModal({ kind: "edit-player", player })} className={`${textActionClass} text-slate-700`}>编辑资料</button>
                      <button type="button" onClick={() => openModal({ kind: "delete-player", player })} className={`${textActionClass} text-red-700`}>删除选手</button>
                    </div>
                  </article>
                );
              })}
              {visiblePlayers.length > pageSize && (
                <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-[0.625rem] text-slate-500">
                  <span>显示 {(safePlayerPage - 1) * pageSize + 1}–{Math.min(safePlayerPage * pageSize, visiblePlayers.length)}，共 {visiblePlayers.length} 人</span>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setPlayerPage((page) => Math.max(1, page - 1))} disabled={safePlayerPage === 1} className="inline-flex min-h-11 items-center border border-slate-300 bg-white px-4 font-bold text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300">上一页</button>
                    <span className="font-mono">{safePlayerPage} / {playerPageCount}</span>
                    <button type="button" onClick={() => setPlayerPage((page) => Math.min(playerPageCount, page + 1))} disabled={safePlayerPage === playerPageCount} className="inline-flex min-h-11 items-center border border-slate-300 bg-white px-4 font-bold text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300">下一页</button>
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {tab === "teams" && (
          state.teams.length === 0 ? <p className="px-5 py-16 text-center text-xs text-slate-400">暂无队伍</p> : (
            <div className="grid gap-px bg-slate-200 xl:grid-cols-2">
              {state.teams.map((team) => {
                const members = state.players.filter((player) => player.teamId === team.id);
                const starters = members.filter((player) => player.role === "首发");
                const subs = members.filter((player) => player.role === "替补");
                const coaches = members.filter((player) => player.role === "教练");
                const pending = members.filter((player) => player.reviewStatus !== "已通过").length;
                return (
                  <article key={team.id} className="bg-white p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-black text-slate-950">{team.name}</h3><span className={`border px-2 py-1 text-[0.5625rem] font-bold ${teamTone(team.status)}`}>{team.status === "已冻结" ? "正式名单" : team.status}</span></div><p className="mt-2 text-[0.625rem] text-slate-400">首发 {starters.length}/5 · 替补 {subs.length}/1 · 教练 {coaches.length}/1{pending > 0 ? ` · ${pending} 人未通过审核` : ""}</p></div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-2">
                        {team.status === "报名中" && <button type="button" onClick={() => runOperation("confirm-team", { teamId: team.id })} disabled={busy} className="bg-[#ff4655] inline-flex min-h-11 items-center px-3 text-xs font-bold text-white disabled:opacity-50">确认名单</button>}
                        {team.status === "已冻结" && <button type="button" onClick={() => openModal({ kind: "reopen-team", team })} className="border border-slate-300 inline-flex min-h-11 items-center px-3 text-xs font-bold text-slate-700">开放调整</button>}
                        {team.status === "报名中" && <button type="button" onClick={() => openModal({ kind: "rename-team", team })} className="border border-slate-300 inline-flex min-h-11 items-center px-3 text-xs font-bold text-slate-700">改名</button>}
                        {(team.status === "报名中" || (team.status === "已冻结" && !bracketTeamIds.includes(team.id))) && <button type="button" onClick={() => openModal({ kind: "dissolve-team", team })} className="border border-amber-300 inline-flex min-h-11 items-center px-3 text-xs font-bold text-amber-700">解散队伍</button>}
                        {team.status !== "已退赛" && <button type="button" onClick={() => openModal({ kind: "withdraw-team", team })} className="border border-red-200 inline-flex min-h-11 items-center px-3 text-xs font-bold text-red-700">整队退赛</button>}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 border-y border-slate-100 py-4">
                      {([
                        { role: "首发" as const, limit: 5 },
                        { role: "替补" as const, limit: 1 },
                        { role: "教练" as const, limit: 1 },
                      ]).map(({ role, limit }) => {
                        const roleMembers = members.filter((player) => player.role === role);
                        return (
                          <div key={role} className="grid gap-2 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
                            <div className="pt-2 text-[0.625rem] font-black text-slate-500">{role} {roleMembers.length}/{limit}</div>
                            <div className="grid min-w-0 gap-2">
                              {Array.from({ length: limit }, (_, index) => {
                                const player = roleMembers[index];
                                return player ? (
                                  <RosterMemberRow
                                    key={player.id}
                                    player={player}
                                    team={team}
                                    role={role}
                                    index={index}
                                    onChangeRole={() => openModal({ kind: "set-member-role", player })}
                                    onReplace={() => openModal({ kind: "replace-player", team, outgoing: player })}
                                    onRemove={() => openModal({ kind: "remove-player", player })}
                                  />
                                ) : (
                                  <button key={`${role}-${index}`} type="button" onClick={() => openModal({ kind: "assign-player", team, role })} disabled={team.status !== "报名中" || state.teamRegistrationClosed || unteamedApproved.length === 0} className="min-h-11 border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-left text-xs font-bold text-slate-400 enabled:hover:border-[#ff4655] enabled:hover:text-[#c83242] disabled:cursor-default">
                                    {role === "首发" ? `首发 ${index + 1}` : role} · 空缺
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          )
        )}

        {tab === "history" && (
          (state.operationLogs?.length ?? 0) === 0 ? <p className="px-5 py-16 text-center text-xs text-slate-400">暂无操作记录</p> : (
            <div className="divide-y divide-slate-100">
              {(state.operationLogs ?? []).map((log: RegistrationAuditLog) => (
                <div key={log.id} className={`flex flex-col justify-between gap-4 px-5 py-4 md:flex-row md:items-center ${log.undoneAt ? "bg-slate-50 text-slate-400" : ""}`}>
                  <div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-bold text-slate-900">{log.summary}</p>{log.undoneAt && <span className="border border-slate-200 px-2 py-0.5 text-[0.5625rem] font-bold">已撤销</span>}</div>{log.reason && <p className="mt-1 text-xs text-slate-500">原因：{log.reason}</p>}<p className="mt-1.5 font-mono text-[0.5625rem] text-slate-400">{formatTime(log.createdAt)} · {log.actor}</p></div>
                  {!log.undoneAt && latestUndoable?.id === log.id && <button type="button" onClick={() => runOperation("undo", { logId: log.id })} disabled={busy} className="w-fit border border-slate-300 bg-white inline-flex min-h-11 items-center px-3 text-xs font-bold text-slate-700 hover:border-slate-950 disabled:opacity-50">撤销这次操作</button>}
                </div>
              ))}
            </div>
          )
        )}
      </section>

      {modal?.kind === "edit-player" && <ModalShell title={`编辑报名 · ${modal.player.gameId}`} onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="border border-slate-300 inline-flex min-h-11 items-center px-4 text-xs font-bold text-slate-600">取消</button><button type="button" onClick={submitModal} disabled={busy} className="bg-[#ff4655] inline-flex min-h-11 items-center px-4 text-xs font-bold text-white disabled:opacity-50">保存更正</button></>}>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="姓名"><input className={inputClass} value={form.name ?? ""} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="学号"><input className={inputClass} value={form.studentId ?? ""} onChange={(event) => setForm({ ...form, studentId: event.target.value })} /></Field><Field label="游戏 ID"><input className={inputClass} value={form.gameId ?? ""} onChange={(event) => setForm({ ...form, gameId: event.target.value })} /></Field><Field label="段位"><input className={inputClass} value={form.rank ?? ""} onChange={(event) => setForm({ ...form, rank: event.target.value })} /></Field><Field label="QQ"><input className={inputClass} value={form.qq ?? ""} onChange={(event) => setForm({ ...form, qq: event.target.value })} /></Field><Field label="手机号"><input className={inputClass} value={form.phone ?? ""} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field></div>
        <div className="mt-4"><p className="mb-1.5 block text-xs font-bold text-slate-700">擅长位置</p><div className="flex flex-wrap gap-2">{POSITIONS.map((pos) => { const active = editPositions.includes(pos); return <button key={pos} type="button" onClick={() => setEditPositions((current) => current.includes(pos) ? current.filter((item) => item !== pos) : [...current, pos])} className={`border px-3 py-1.5 text-xs transition ${active ? "border-[#ff4655] bg-[#ff4655] text-white" : "border-slate-300 bg-white text-slate-700 hover:border-[#ff4655]"}`}>{pos}</button>; })}</div></div>
        <Field label="自我介绍"><textarea className={`${inputClass} min-h-20 resize-y`} value={form.intro ?? ""} onChange={(event) => setForm({ ...form, intro: event.target.value })} placeholder="选填" /></Field>
        <Field label="修改原因"><textarea className={`${inputClass} min-h-20 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="如：选手联系负责人更正游戏 ID" /></Field>
      </ModalShell>}

      {modal?.kind === "delete-player" && (() => {
        const team = state.teams.find((candidate) => candidate.id === modal.player.teamId);
        const isCaptain = team?.captainId === modal.player.id;
        const remainingCount = team ? team.memberIds.filter((id) => id !== modal.player.id).length : 0;
        return <ModalShell title={`删除选手 · ${modal.player.gameId}`} subtitle="报名数据会被移除，选手无法再登录参赛管理；删除后可在「操作记录」中撤销。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="border border-slate-300 inline-flex min-h-11 items-center px-4 text-xs font-bold text-slate-600">取消</button><button type="button" onClick={submitModal} disabled={busy} className="bg-red-600 inline-flex min-h-11 items-center px-4 text-xs font-bold text-white disabled:opacity-40">确认删除</button></>}>
          <p className="text-sm leading-6 text-slate-700">确定要删除 <span className="font-black text-slate-900">{modal.player.gameId}</span>（{modal.player.name}）吗？</p>
          <ul className="space-y-1.5 text-xs leading-5 text-slate-500">
            {team ? (
              <li>将移出队伍「{team.name}」：{isCaptain ? (remainingCount > 0 ? "队长自动移交给队内现有成员" : "该队已无成员，将标记为退赛") : "自动腾出其队内位置"}</li>
            ) : (
              <li>该选手未组队，无队伍关联。</li>
            )}
            <li>与该选手相关的组队申请会一并清理。</li>
            <li>报名资料与参赛码一并移除，不可恢复（可在操作记录中撤销）。</li>
          </ul>
        </ModalShell>;
      })()}

      {modal?.kind === "create-team" && <ModalShell title="负责人代建队伍" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="border border-slate-300 inline-flex min-h-11 items-center px-4 text-xs font-bold text-slate-600">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.name?.trim() || !form.captainId} className="bg-[#ff4655] inline-flex min-h-11 items-center px-4 text-xs font-bold text-white disabled:opacity-40">创建队伍</button></>}><Field label="队伍名称"><input autoFocus className={inputClass} value={form.name ?? ""} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="输入参赛队名" /></Field><Field label="队长"><select className={inputClass} value={form.captainId ?? ""} onChange={(event) => setForm({ ...form, captainId: event.target.value })}><option value="">选择已审核且未组队选手</option>{unteamedApproved.map((player) => <option key={player.id} value={player.id}>{player.gameId}（{player.rank}）</option>)}</select></Field><Field label="队长场上角色"><select className={inputClass} value={form.captainRole ?? "首发"} onChange={(event) => setForm({ ...form, captainRole: event.target.value })}><option>首发</option><option>替补</option><option>教练</option></select></Field></ModalShell>}

      {modal?.kind === "rename-team" && <ModalShell title={`修改队名 · ${modal.team.name}`} subtitle="仅组队期可改；改名后生成赛程时会用新队名。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="border border-slate-300 inline-flex min-h-11 items-center px-4 text-xs font-bold text-slate-600">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.name?.trim() || !form.reason?.trim()} className="bg-[#ff4655] inline-flex min-h-11 items-center px-4 text-xs font-bold text-white disabled:opacity-40">确认改名</button></>}><Field label="新队名"><input autoFocus className={inputClass} value={form.name ?? ""} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="输入新队名（≤40 字）" /></Field><Field label="改名原因"><textarea className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="如：队长申请更正队名" /></Field></ModalShell>}

      {modal?.kind === "set-member-role" && <ModalShell title={`调整角色 · ${modal.player.gameId}`} subtitle="仅组队期可改；目标角色须有空位。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="border border-slate-300 inline-flex min-h-11 items-center px-4 text-xs font-bold text-slate-600">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.role || !form.reason?.trim()} className="bg-[#ff4655] inline-flex min-h-11 items-center px-4 text-xs font-bold text-white disabled:opacity-40">确认调整</button></>}><Field label="新角色"><select className={inputClass} value={form.role ?? "首发"} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}><option>首发</option><option>替补</option><option>教练</option></select></Field><Field label="调整原因"><textarea autoFocus className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="如：队长与队员协商后调整位置" /></Field></ModalShell>}

      {modal?.kind === "assign-player" && <ModalShell title="添加队员" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="border border-slate-300 inline-flex min-h-11 items-center px-4 text-xs font-bold text-slate-600">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.playerId || !form.teamId} className="bg-[#ff4655] inline-flex min-h-11 items-center px-4 text-xs font-bold text-white disabled:opacity-40">确认加入</button></>}><Field label="选手"><select className={inputClass} value={form.playerId ?? ""} onChange={(event) => setForm({ ...form, playerId: event.target.value })}><option value="">选择已审核且未组队选手</option>{unteamedApproved.map((player) => <option key={player.id} value={player.id}>{player.gameId}（{player.rank}）</option>)}</select></Field><Field label="队伍"><select className={inputClass} value={form.teamId ?? ""} onChange={(event) => setForm({ ...form, teamId: event.target.value })}><option value="">选择报名中的队伍</option>{activeTeams.filter((team) => team.status === "报名中").map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Field><Field label="队内角色"><select className={inputClass} value={form.role ?? "首发"} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}><option>首发</option><option>替补</option><option>教练</option></select></Field></ModalShell>}

      {modal?.kind === "remove-player" && (() => { const options = captainReplacementOptions(modal.player); return <ModalShell title={`移出名单 · ${modal.player.gameId}`} subtitle="选手会回到未组队状态，队伍名单重新进入待确认。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="border border-slate-300 inline-flex min-h-11 items-center px-4 text-xs font-bold text-slate-600">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.reason?.trim() || (options.length > 0 && !form.replacementCaptainId)} className="bg-red-600 inline-flex min-h-11 items-center px-4 text-xs font-bold text-white disabled:opacity-40">确认执行</button></>}>
        {options.length > 0 && <Field label="新队长" help="当前选手是队长，必须先移交队长身份。"><select className={inputClass} value={form.replacementCaptainId ?? ""} onChange={(event) => setForm({ ...form, replacementCaptainId: event.target.value })}><option value="">请选择新队长</option>{options.map((player) => <option key={player.id} value={player.id}>{player.gameId}</option>)}</select></Field>}<Field label="原因"><textarea autoFocus className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="请记录申请来源和原因" /></Field>
      </ModalShell>; })()}

      {modal?.kind === "reopen-team" && <ModalShell title={`开放名单调整 · ${modal.team.name}`} subtitle="已确认名单会退回报名中状态，调整完成后需要再次确认。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="border border-slate-300 inline-flex min-h-11 items-center px-4 text-xs font-bold text-slate-600">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.reason?.trim()} className="bg-[#ff4655] inline-flex min-h-11 items-center px-4 text-xs font-bold text-white disabled:opacity-40">开放调整</button></>}><Field label="开放原因"><textarea autoFocus className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ reason: event.target.value })} placeholder="如：队长申请更换一名首发" /></Field></ModalShell>}

      {modal?.kind === "replace-player" && <ModalShell title={`换人 · ${modal.team.name}`} subtitle="新选手会继承原选手的角色；若替换队长，新选手同时接任队长。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="border border-slate-300 inline-flex min-h-11 items-center px-4 text-xs font-bold text-slate-600">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.outgoingPlayerId || !form.incomingPlayerId || !form.reason?.trim()} className="bg-[#ff4655] inline-flex min-h-11 items-center px-4 text-xs font-bold text-white disabled:opacity-40">确认换人</button></>}><Field label="原选手"><select className={inputClass} value={form.outgoingPlayerId ?? ""} onChange={(event) => setForm({ ...form, outgoingPlayerId: event.target.value })}>{state.players.filter((player) => player.teamId === modal.team.id).map((player) => <option key={player.id} value={player.id}>{player.gameId}（{player.role}）</option>)}</select></Field><Field label="新选手"><select className={inputClass} value={form.incomingPlayerId ?? ""} onChange={(event) => setForm({ ...form, incomingPlayerId: event.target.value })}><option value="">选择已审核且未组队的选手</option>{unteamedApproved.map((player) => <option key={player.id} value={player.id}>{player.gameId}（{player.rank}）</option>)}</select></Field><Field label="换人原因"><textarea className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="请记录申请来源和原因" /></Field></ModalShell>}

      {modal?.kind === "withdraw-team" && <ModalShell title={`整队退赛 · ${modal.team.name}`} subtitle="队伍会保留为退赛记录，原成员回到未组队状态。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="border border-slate-300 inline-flex min-h-11 items-center px-4 text-xs font-bold text-slate-600">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.reason?.trim()} className="bg-red-600 inline-flex min-h-11 items-center px-4 text-xs font-bold text-white disabled:opacity-40">确认整队退赛</button></>}><Field label="退赛原因"><textarea autoFocus className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ reason: event.target.value })} placeholder="请记录队长申请或主办方处理原因" /></Field></ModalShell>}

      {modal?.kind === "dissolve-team" && <ModalShell title={`解散队伍 · ${modal.team.name}`} subtitle={modal.team.status === "已冻结" ? "该队伍名单已确认但尚未进入对阵图；解散会删除整支队伍，成员回到未组队，需重新补足参赛名额。此操作可撤销。" : "仅组队期适用；队伍会被删除（不留记录），所有成员回到未组队状态，可撤销。"} onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="border border-slate-300 inline-flex min-h-11 items-center px-4 text-xs font-bold text-slate-600">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.reason?.trim()} className="bg-amber-600 inline-flex min-h-11 items-center px-4 text-xs font-bold text-white disabled:opacity-40">确认解散</button></>}><Field label="解散原因"><textarea autoFocus className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ reason: event.target.value })} placeholder="如：队伍组建无法凑齐，或重复报名需要清理" /></Field></ModalShell>}
    </div>
  );
}
