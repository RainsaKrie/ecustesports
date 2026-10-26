"use client";

import TeamRosterModal from "@/components/admin/TeamRosterModal";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";

import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { AdminModal, AdminOverflowMenu, EmptyState, ContextBar} from "@/components/admin/ui";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import {
  initialRegistration,
  normalizeRegistrationState,
  type RegistrationAuditLog,
  type RegistrationPlayer,
  type RegistrationState,
} from "@/lib/domains/registration/data";
import {
  GAME,
  CopyButton,
  DENSE_BODY,
  DENSE_META,
  DENSE_MICRO,
  DENSE_TITLE,
  Field,
  TEAM_FILTERS,
  TEAM_SORTS,
  captainContactSheet,
  contactOf,
  copyActionClass,
  formatTime,
  inputClass,
  isFlagged,
  matchesTeamFilter,
  reviewTone,
  subscribeStatic,
  teamRoster,
  teamSortRank,
  teamTone,
  textActionClass,
  type Modal,
  type ReviewStatus,
  type Role,
  type Tab,
  type TeamFilter,
  type TeamSort,
} from "./RegistrationWorkspaceParts";

/* 这里原来有一个本地 `ModalShell`（约 20 行）。已删，原因有三个：
   ① 它是 `AdminModal` 的复制品，属于「同一件事两种表达」；
   ② 它**没有 Esc 关闭、也没有点遮罩关闭**（设计文档 6.7 明确要求 Esc 能关弹窗），
      而这页的弹窗是最多的（12 个）；
   ③ 它的 z-index 是 70，统一弹窗是 80，和确认框不在同一层。
   本文件的弹窗现在一律用 `@/components/admin/ui` 的 `AdminModal`。 */

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
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("全部");
  const [teamSort, setTeamSort] = useState<TeamSort>("待办优先");
  const [playerPage, setPlayerPage] = useState(1);
  /**
   * 批量操作的选择集（设计文档 6.6「选中后顶部出现批量操作条」）。
   * **只存 id、不存对象**：每次操作后服务端会整份替换 state，
   * 存对象会拿到过期引用，判断「这个人还在不在」就错了。
   */
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
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
  // 审核已改为「默认通过 + 手动标记」：不再有「待审核」，
  // 只剩「需修改 / 已拒绝」这一种异常态需要负责人关注。
  const flaggedPlayers = activePlayers.filter((player) => isFlagged(player.reviewStatus));
  const unteamedApproved = activePlayers.filter((player) => player.status === "已报名" && player.reviewStatus === "已通过");
  const activeTeams = state.teams.filter((team) => team.status !== "已退赛");
  const confirmedTeams = activeTeams.filter((team) => team.status === "已冻结").length;
  /** 队名映射：选手搜索要认「队名」，但队伍名只在 teams 里 */
  const teamNameById = useMemo(() => new Map(state.teams.map((team) => [team.id, team.name])), [state.teams]);

  const visiblePlayers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return state.players.filter((player) => {
      if (reviewFilter !== "全部" && player.reviewStatus !== reviewFilter) return false;
      if (!keyword) return true;
      // 2026-10-18：加队名。此前只能按选手自己的 ID/姓名/学号/段位/位置搜，
      // 想「把这支队的人都找出来」就得先记住每个人的名字 —— 核验身份时很别扭。
      return [
        player.gameId,
        player.name,
        player.studentId,
        player.rank,
        ...(player.positions ?? []),
        player.teamId ? teamNameById.get(player.teamId) : undefined,
        player.teamId ? "未组队" : undefined,
      ].some((value) => value?.toLowerCase().includes(keyword));
    });
  }, [query, reviewFilter, state.players, teamNameById]);
  const pageSize = 20;
  const playerPageCount = Math.max(1, Math.ceil(visiblePlayers.length / pageSize));
  const safePlayerPage = Math.min(playerPage, playerPageCount);
  const pagedPlayers = visiblePlayers.slice((safePlayerPage - 1) * pageSize, safePlayerPage * pageSize);
  const latestUndoable = (state.operationLogs ?? []).find((log) => !log.undoneAt);

  const teamRows = useMemo(
    () => state.teams.map((team) => ({ team, roster: teamRoster(state, team) })),
    [state],
  );
  const teamBuckets = useMemo(() => {
    const counts: Record<TeamFilter, number> = { 全部: teamRows.length, 未满编: 0, 满编待确认: 0, 已确认: 0 };
    for (const { roster } of teamRows) {
      for (const filter of TEAM_FILTERS) {
        if (filter !== "全部" && matchesTeamFilter(filter, roster)) counts[filter] += 1;
      }
    }
    return counts;
  }, [teamRows]);
  const visibleTeams = useMemo(
    // sort 在现代 JS 里是稳定的，所以同分/同档队伍仍保持原来的报名顺序。
    // 「平均段位」用「强 → 弱」（分高在前），与赛制里取最弱一批的方向一致，
    // 同分时再按待办优先级排，避免看起来是乱的。
    () => teamRows
      .filter(({ roster }) => matchesTeamFilter(teamFilter, roster))
      .sort((a, b) => teamSort === "平均段位"
        ? b.roster.avgRank - a.roster.avgRank || teamSortRank(a.roster) - teamSortRank(b.roster)
        : teamSortRank(a.roster) - teamSortRank(b.roster)),
    [teamRows, teamFilter, teamSort],
  );

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
    if (next.kind === "create-player") {
      setForm({
        name: "",
        studentId: "",
        gameId: "",
        rank: "",
        qq: "",
        phone: "",
        teamId: next.team?.id ?? activeTeams.find((team) => team.status === "报名中")?.id ?? "",
        role: next.role ?? "替补",
        reason: "",
      });
      setEditPositions([]);
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

  /**
   * 批量执行同一个 action（设计文档 6.6「选中后顶部出现批量操作条」）。
   *
   * **为什么串行、不用 `Promise.all`**：每次响应都带回**整份** state 并 `setState`，
   * 并发写会互相覆盖（后到的响应可能是较早的 state），界面上就会出现
   * 「有的已生效、有的没生效」。串行慢一点，但状态一路正确。
   *
   * **中途失败不吞**：报告已完成的条数，并把**失败的那些**留在选择集里，
   * 负责人可以直接再点一次重试，不用重新勾选。
   */
  async function runBatch(
    action: string,
    ids: string[],
    payloadOf: (id: string) => Record<string, unknown>,
    doneText: (n: number) => string,
  ) {
    if (ids.length === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    let done = 0;
    const failed: string[] = [];
    try {
      for (const id of ids) {
        const response = await fetch("/api/admin/registration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, action, payload: payloadOf(id) }),
        });
        const data = await response.json().catch(() => ({})) as { message?: string; state?: RegistrationState };
        if (data.state) setState(normalizeRegistrationState(data.state));
        if (!response.ok) {
          failed.push(id);
          continue;
        }
        done += 1;
      }
      setSelectedPlayerIds(failed);
      setNotice(failed.length > 0
        ? { kind: "error", text: `已完成 ${done} 条，${failed.length} 条失败（失败的那些已留在选择集里，可直接重试）` }
        : { kind: "success", text: doneText(done) });
      router.refresh();
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "批量操作失败，请重试" });
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
    if (modal.kind === "create-player") return runOperation("create-player", { ...form, positions: editPositions });
  }

  function captainReplacementOptions(player: RegistrationPlayer) {
    if (!player.teamId) return [];
    const team = state.teams.find((candidate) => candidate.id === player.teamId);
    if (team?.captainId !== player.id) return [];
    return state.players.filter((candidate) => candidate.teamId === player.teamId && candidate.id !== player.id);
  }

  if (!loaded) {
    return <div className="adm-panel px-6 py-20 text-center text-[length:var(--adm-fs-lg)] text-[var(--adm-text-soft)]">正在读取报名与队伍数据…</div>;
  }

  return (
    <div>
      {/* 页头状态徽标只在「有事要你做」时出现。原来没有待改资料时会显示
          「N/M 队已确认」，但那和下面上下文条里的「正式队伍」是同一个数字，
          同一屏不把同一个数字说两遍。 */}
      <AdminPageHeader
        eyebrow="模块 01"
        title="报名与队伍"
        status={flaggedPlayers.length > 0 ? `${flaggedPlayers.length} 人资料待修改` : undefined}
        actions={(
          <>
            <a href={`/api/admin/registration/export?eventId=${encodeURIComponent(eventId)}`} className="adm-btn adm-btn--secondary adm-btn--md">导出报名</a>
            {/* 队伍申报开关留在外面：它的按钮文字本身就是「报名开没开」的状态指示，
                收进「⋯」之后就看不出来了。 */}
            <button
              type="button"
              onClick={() => runOperation("toggle-team-registration")}
              disabled={busy}
              className={`adm-btn adm-btn--md ${state.teamRegistrationClosed ? "adm-btn--secondary" : "adm-btn--primary"}`}
            >
              {state.teamRegistrationClosed ? "开放队伍申报" : "截止队伍申报"}
            </button>
          </>
        )}
        overflow={[
          { text: "代建队伍", onSelect: () => openModal({ kind: "create-team" }), disabled: busy || state.teamRegistrationClosed },
          { text: "代录选手", onSelect: () => openModal({ kind: "create-player" }), disabled: busy },
          { text: state.playerRegistrationClosed ? "开放选手报名" : "截止选手报名", onSelect: () => runOperation("toggle-player-registration"), disabled: busy },
        ]}
      />

      {notice && (
        <div className={`adm-note mb-5 flex items-start justify-between gap-4 ${notice.kind === "success" ? "adm-note--ok" : "adm-note--danger"}`} role="status">
          <span>{notice.text}</span>
          {/* 单个字符的图标钮不用 --md/--lg：那两档是按文字宽度定的，
              字符本身很窄，用大档只会得到一个又高又空的方块。
              这里固定 32×32，和溢出菜单的图标触发钮同尺寸。 */}
          <button type="button" onClick={() => setNotice(null)} aria-label="关闭提示" className="adm-btn adm-btn--ghost adm-btn--sm w-[32px] shrink-0 px-0">×</button>
        </div>
      )}

      {/* 上下文条：一行数字，不做卡片（设计文档 4.2）。信息与原来的四张统计卡完全一致，
          只是不再各占一块边框 —— 数字仍然是页面上第二重的东西，仅次于标题。
          移动端隐藏（设计文档 4.4：不减字号，改为减少一屏信息）。 */}
      <ContextBar
        items={[
          { label: "有效报名", value: `${activePlayers.length} 人` },
          {
            label: "资料待修改",
            value: `${flaggedPlayers.length} 人`,
            tone: flaggedPlayers.length > 0 ? ("alert" as const) : ("default" as const),
            note: flaggedPlayers.length > 0 ? "需要负责人处理" : undefined,
          },
          { label: "未组队", value: `${unteamedApproved.length} 人` },
          { label: "正式队伍", value: `${confirmedTeams}/${activeTeams.length} 支` },
        ]}
      />

      <section className="mb-5 adm-panel">
        <div className="grid gap-5 p-5 md:grid-cols-[auto_1fr] md:items-center">
          <div className="w-fit adm-panel p-2">
            {registerUrl ? <QRCodeSVG value={registerUrl} size={92} /> : <div className="h-[92px] w-[92px] bg-[var(--adm-surface-2)]" />}
          </div>
          <div className="min-w-0">
            <p className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">给选手的报名入口</p>
            <p className="mt-1 break-all text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">{registerUrl || "正在生成链接…"}</p>
            <p className="mt-2 text-[length:var(--adm-fs-sm)] font-bold text-[var(--adm-text-soft)]">选手报名截止 {event.registrationEnd || "待定"} · 队伍申报截止 {event.teamRegistrationEnd || "待定"}</p>
          </div>
        </div>
      </section>

      <section className="adm-panel">
        <div className="flex flex-col justify-between gap-3 border-b border-[var(--adm-line-soft)] md:flex-row md:items-center">
          <div className="flex overflow-x-auto">
            {([
              ["players", "选手", state.players.length],
              ["teams", "队伍", state.teams.length],
              ["history", "操作记录", state.operationLogs?.length ?? 0],
            ] as const).map(([value, label, count]) => (
              <button key={value} type="button" onClick={() => setTab(value)} aria-current={tab === value} className={`shrink-0 border-r border-[var(--adm-line-soft)] px-5 py-3.5 text-[length:var(--adm-fs-lg)] ${tab === value ? "border-b-2 border-b-[var(--adm-red)] font-semibold text-[var(--adm-text)]" : "text-[var(--adm-text-soft)] hover:text-[var(--adm-text)]"}`}>
                {label} <span className="ml-1 text-[length:var(--adm-fs-sm)] tabular-nums text-[var(--adm-text-mute)]">{count}</span>
              </button>
            ))}
          </div>
          {tab === "players" && (
            <div className="flex gap-[6px] px-[10px] pb-[10px] md:pb-0">
              <button type="button" onClick={() => runOperation("approve-all-players")} disabled={busy || flaggedPlayers.length === 0} className="inline-flex min-h-[32px] shrink-0 items-center bg-[var(--adm-red)] px-[10px] text-[length:var(--adm-fs-sm)] font-bold leading-tight text-white hover:bg-[var(--adm-red-hover)] disabled:cursor-not-allowed disabled:opacity-40">全部通过{flaggedPlayers.length > 0 ? `（${flaggedPlayers.length} 人）` : ""}</button>
              {/* data-search-input 是 Cmd/Ctrl+K 的约定（见 AdminUIProvider）：
                  全站任何搜索框只要带上这个属性，那个快捷键就会聚焦到它。 */}
              <input data-search-input value={query} onChange={(event) => { setQuery(event.target.value); setPlayerPage(1); }} placeholder="搜索游戏 ID、姓名、学号或队名" className="min-h-[32px] min-w-0 border border-[var(--adm-line-soft)] px-[10px] text-[length:var(--adm-fs-sm)] leading-tight outline-none focus:border-[var(--adm-red)] md:w-56" />
              <select value={reviewFilter} onChange={(event) => { setReviewFilter(event.target.value as typeof reviewFilter); setPlayerPage(1); }} className="min-h-[32px] border border-[var(--adm-line-soft)] bg-white/[0.04] px-[8px] text-[length:var(--adm-fs-sm)] leading-tight outline-none">
                {(["全部", "已通过", "需修改", "已拒绝"] as const).map((status) => <option key={status}>{status}</option>)}
              </select>
            </div>
          )}
          {tab === "teams" && (
            <div className="flex flex-wrap items-center gap-[6px] px-[10px] pb-[10px] md:pb-0">
              <button
                type="button"
                onClick={() => runOperation("confirm-eligible-teams")}
                disabled={busy || teamBuckets["满编待确认"] === 0}
                title="把首发满 5 人且资料全部通过的队伍一次性确认为正式名单"
                className="adm-btn adm-btn--primary adm-btn--sm shrink-0 hover:bg-[var(--adm-red-hover)]"
              >
                一键确认满编队伍{teamBuckets["满编待确认"] > 0 ? `（${teamBuckets["满编待确认"]}）` : ""}
              </button>
              {/* 筛选与排序收成下拉。原来是两组分段按钮、一共 6 个格子，
                  把「一键确认满编队伍」和「复制队长联系方式」挤到第二行，
                  工具栏白白高一截。选手标签页的审核筛选本来就是 <select>，
                  这里跟着统一成同一种控件。 */}
              <select
                value={teamFilter}
                onChange={(event) => setTeamFilter(event.target.value as TeamFilter)}
                aria-label="按队伍状态筛选"
                title="按队伍状态筛选；括号里是该状态下的队伍数"
                className="min-h-[32px] shrink-0 adm-panel px-[8px] text-[length:var(--adm-fs-sm)] font-bold leading-tight text-[var(--adm-text-soft)] outline-none"
              >
                {TEAM_FILTERS.map((bucket) => (
                  <option key={bucket} value={bucket}>{bucket}（{teamBuckets[bucket]}）</option>
                ))}
              </select>
              <select
                value={teamSort}
                onChange={(event) => setTeamSort(event.target.value as TeamSort)}
                aria-label="队伍排序方式"
                title="待办优先：缺人、待确认的队伍排在前面；平均段位：按首发 5 人的段位均值，强 → 弱（替补与教练不计）"
                className="min-h-[32px] shrink-0 adm-panel px-[8px] text-[length:var(--adm-fs-sm)] font-bold leading-tight text-[var(--adm-text-soft)] outline-none"
              >
                {TEAM_SORTS.map((mode) => (
                  <option key={mode} value={mode}>排序：{mode}</option>
                ))}
              </select>
              {/* 汇总复制：队长群缺人时，一次拿到当前列表全部队长的号，
                  不用在 36 张卡里挨个点。复制的是**当前筛选与排序下的队伍**，
                  按钮上直接写出队数，避免「筛了一半却以为复制的是全部」。 */}
              <button type="button" onClick={() => void runOperation("scrub-personal-data", {}, false)} title="清掉姓名/学号/QQ/手机/位置/自我介绍；保留队伍、游戏 ID、段位与赛果" className="inline-flex min-h-[32px] shrink-0 items-center adm-panel px-[10px] text-[length:var(--adm-fs-sm)] font-bold leading-tight text-[var(--adm-text-soft)] hover:border-[var(--adm-red-text)] hover:text-[var(--adm-red-text)]">清理个人信息</button>
              <CopyButton
                text={captainContactSheet(visibleTeams)}
                disabled={visibleTeams.length === 0}
                label={`复制队长联系方式（${visibleTeams.length} 队）`} copiedLabel={`已复制（${visibleTeams.length} 队）`}
                title="按当前筛选与排序复制：队名 / 队长 GameID / 联系方式，制表符分隔"
                className="inline-flex min-h-[32px] shrink-0 items-center adm-panel px-[10px] text-[length:var(--adm-fs-sm)] font-bold leading-tight text-[var(--adm-text-soft)] hover:border-[var(--adm-text)] disabled:cursor-not-allowed disabled:text-[var(--adm-text-mute)]"
              />
            </div>
          )}
        </div>

        {/* 批量操作条（设计文档 6.6「选中后顶部出现批量操作条」）。
            只在有选中项时出现，不占常态空间；「清空选择」与选择集同生共死。 */}
        {tab === "players" && selectedPlayerIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-y border-[var(--adm-red-line)] bg-[var(--adm-red-soft)] px-[10px] py-[8px]">
            <span className="text-[length:var(--adm-fs-sm)] font-bold text-[var(--adm-red-text)]">已选 {selectedPlayerIds.length} 人</span>
            <button
              type="button"
              onClick={() => runBatch("review-player", selectedPlayerIds, (id) => ({ playerId: id, reviewStatus: "已通过" }), (n) => `已标记通过 ${n} 人`)}
              disabled={busy}
              className="adm-btn adm-btn--primary adm-btn--sm hover:bg-[var(--adm-red-hover)]"
            >
              标记通过
            </button>
            <button type="button" onClick={() => setSelectedPlayerIds([])} disabled={busy} className="adm-btn adm-btn--secondary adm-btn--sm">
              清空选择
            </button>
          </div>
        )}

        {tab === "players" && (
          activePlayers.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="还没有选手报名"
                description="选手从玩家页面的报名入口提交资料后会出现在这里。也可以从页头「⋯」里的「代录选手」帮人补录。"
              />
            </div>
          ) : visiblePlayers.length === 0 ? (
            <div className="p-5">
              <EmptyState title="没有符合条件的选手" description="换一个筛选条件或清空搜索再看看。" />
            </div>
          ) : (
            <div className="divide-y divide-[var(--adm-line-soft)]">
              {pagedPlayers.map((player) => {
                const team = state.teams.find((candidate) => candidate.id === player.teamId);
                return (
                  <article key={player.id} className={`p-[10px] leading-tight ${player.status === "已退赛" ? "bg-[var(--adm-surface-2)] text-[var(--adm-text-mute)]" : "text-[var(--adm-text-soft)]"}`}>
                    <div className="flex items-center justify-between gap-[10px]">
                      <input
                        type="checkbox"
                        checked={selectedPlayerIds.includes(player.id)}
                        onChange={(event) => setSelectedPlayerIds((ids) => event.target.checked ? [...ids, player.id] : ids.filter((id) => id !== player.id))}
                        aria-label={`选择 ${player.gameId}`}
                        className="h-[16px] w-[16px] shrink-0 accent-[var(--adm-red)]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-baseline gap-[6px]">
                          <p className={`truncate ${DENSE_BODY} font-bold text-[var(--adm-text)]`}>{player.gameId}</p>
                          {/* 默认通过不再显示徽章 —— 159 个人人都挂一个「已通过」只是噪音 */}
                          {isFlagged(player.reviewStatus) && (
                            <span className="adm-chip shrink-0" data-tone={reviewTone(player.reviewStatus)}>{player.reviewStatus}</span>
                          )}
                        </div>
                        <p className={`mt-[1px] truncate ${DENSE_MICRO}`}>{player.name} · {player.studentId}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-[10px]">
                        {/* 行内动作 ≤2（设计文档 6.6）：留「待办」性质的「标记通过」和最常用的
                            「编辑资料」，「删除选手」是低频 + 破坏性动作，收进行尾 ⋯ ——
                            顺带降低误触丢数据的概率。 */}
                        {player.status !== "已退赛" && isFlagged(player.reviewStatus) && <button type="button" onClick={() => runOperation("review-player", { playerId: player.id, reviewStatus: "已通过" })} disabled={busy} className={`${textActionClass} text-[var(--adm-ok-text)] disabled:text-[var(--adm-text-mute)]`}>标记通过</button>}
                        <button type="button" onClick={() => openModal({ kind: "edit-player", player })} className={`${textActionClass} text-[var(--adm-text-soft)]`}>编辑资料</button>
                        <AdminOverflowMenu size="compact" label={`${player.gameId} 的更多操作`} items={[{ text: "删除选手", onSelect: () => openModal({ kind: "delete-player", player }), tone: "text-[var(--adm-red-text)]" }]} />
                      </div>
                    </div>
                    <div className={`mt-[6px] grid gap-[5px] border-t border-[var(--adm-line-soft)] pt-[6px] ${DENSE_META} sm:grid-cols-2 xl:grid-cols-4`}>
                      <div><p className={`${DENSE_MICRO} font-bold text-[var(--adm-text-mute)]`}>段位 / 位置</p><p className="mt-0.5 truncate">{player.rank} · {(player.positions ?? []).join("、") || "未填"}</p></div>
                      <div><p className={`${DENSE_MICRO} font-bold text-[var(--adm-text-mute)]`}>联系方式</p><p className="mt-0.5 truncate">{contactOf(player)}</p></div>
                      <div className="sm:col-span-2"><p className={`${DENSE_MICRO} font-bold text-[var(--adm-text-mute)]`}>队伍状态</p><p className="mt-0.5 truncate">{team ? (
                        <>
                          {/* 队名可点：一键按这支队筛选手 —— 比让负责人手动敲队名省事，
                              也是"核验一支队"这条路径上最常做的一步。 */}
                          <button
                            type="button"
                            onClick={() => { setQuery(team.name); setPlayerPage(1); }}
                            title={`只看 ${team.name} 的选手`}
                            className="font-bold text-[var(--adm-text)] underline-offset-2 hover:text-[var(--adm-red-text)] hover:underline"
                          >
                            {team.name}
                          </button>
                          <span className="ml-1 text-[var(--adm-text-mute)]">· {player.role}</span>
                        </>
                      ) : player.status === "已退赛" ? "已退赛" : "未组队"}</p></div>
                    </div>
                  </article>
                );
              })}
              {visiblePlayers.length > pageSize && (
                <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--adm-surface-2)] px-4 py-3 text-[length:var(--adm-fs-sm)] text-[var(--adm-text-soft)]">
                  <span>显示 {(safePlayerPage - 1) * pageSize + 1}–{Math.min(safePlayerPage * pageSize, visiblePlayers.length)}，共 {visiblePlayers.length} 人</span>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setPlayerPage((page) => Math.max(1, page - 1))} disabled={safePlayerPage === 1} className="adm-btn adm-btn--secondary adm-btn--md">上一页</button>
                    <span className="tabular-nums text-[var(--adm-text-soft)]">{safePlayerPage} / {playerPageCount}</span>
                    <button type="button" onClick={() => setPlayerPage((page) => Math.min(playerPageCount, page + 1))} disabled={safePlayerPage === playerPageCount} className="adm-btn adm-btn--secondary adm-btn--md">下一页</button>
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {tab === "teams" && (
          state.teams.length === 0
            ? (
              <div className="p-5">
                <EmptyState
                  title="还没有队伍"
                  description="队伍由队长在玩家页面创建后出现在这里。也可以从页头「⋯」里的「代建队伍」先建好，再把选手放进去。"
                />
              </div>
            )
            : visibleTeams.length === 0
              ? (
                <div className="p-5">
                  <EmptyState title="这个筛选下没有队伍" description="换一个筛选条件再看看。" />
                </div>
              )
              : (
                <div className="grid gap-px bg-[var(--adm-surface-3)] md:grid-cols-2 xl:grid-cols-3">
              {visibleTeams.map(({ team, roster }) => {
                const members = roster.members;
                const captain = roster.captain;
                const flaggedCount = members.filter((player) => isFlagged(player.reviewStatus)).length;
                // 低频/破坏性操作收进「更多」，队头只留一个主操作。
                // 原先 4 个按钮横排 + shrink-0，把队名挤到换行、右列还会溢出被裁。
                const teamActions: Array<{ text: string; onSelect: () => void; tone?: string }> = [];
                if (team.status === "报名中") {
                  teamActions.push({ text: "改名", onSelect: () => openModal({ kind: "rename-team", team }) });
                }
                if (team.status === "报名中" || (team.status === "已冻结" && !bracketTeamIds.includes(team.id))) {
                  teamActions.push({ text: "解散队伍", onSelect: () => openModal({ kind: "dissolve-team", team }), tone: "text-[var(--adm-warn-text)]" });
                }
                if (team.status !== "已退赛") {
                  teamActions.push({ text: "整队退赛", onSelect: () => openModal({ kind: "withdraw-team", team }), tone: "text-[var(--adm-red-text)]" });
                }
                return (
                  <article key={team.id} className={`bg-[var(--adm-surface)] px-[10px] py-[8px] leading-tight ${roster.withdrawn ? "bg-[var(--adm-surface-2)] text-[var(--adm-text-mute)]" : ""}`}>
                    <div className="flex items-start justify-between gap-[8px]">
                      <div className="flex min-w-0 flex-wrap items-center gap-[6px]">
                        <h3 className={`truncate ${DENSE_TITLE} font-semibold text-[var(--adm-text)]`}>{team.name}</h3>
                        <span className="adm-chip shrink-0" data-tone={teamTone(team.status)}>{team.status === "已冻结" ? "正式名单" : team.status}</span>
                        <span className={`shrink-0 ${DENSE_MICRO} font-medium tabular-nums ${roster.complete ? "text-[var(--adm-text-mute)]" : "text-[var(--adm-red-text)]"}`}>首发 {roster.starterCount}/{GAME.roster.starters}</span>
                        {/* 平均段位是资格赛选队的依据，必须看得见 —— 否则「按段位排序」也是黑箱。
                            一个人都没填段位时不显示 0.00，那会让人误以为是「最弱」。 */}
                        <span className={`shrink-0 ${DENSE_MICRO} font-medium tabular-nums text-[var(--adm-text-soft)]`} title="首发 5 人段位均值（铁 1 → 无畏战魂 9）">均 {roster.avgRank > 0 ? roster.avgRank.toFixed(2) : "—"}</span>
                        {roster.unrankedStarters > 0 && <span className="adm-chip shrink-0" data-tone="attention">{roster.unrankedStarters} 人未填段位</span>}
                      </div>
                      <div className="flex shrink-0 items-center gap-[4px]">
                        {team.status === "已冻结" && <button type="button" onClick={() => openModal({ kind: "reopen-team", team })} className="adm-btn adm-btn--secondary adm-btn--sm">开放调整</button>}
                        <AdminOverflowMenu size="compact" label={`${team.name} 的更多操作`} items={teamActions} />
                      </div>
                    </div>
                    {flaggedCount > 0 && <p className={`mt-[4px] ${DENSE_META} font-bold text-[var(--adm-warn-text)]`}>{flaggedCount} 人资料待修改，需先标记通过才能确认名单</p>}
                    {/* 队长联系方式直接摆在卡片上。负责人要把队长逐个拉进队长群，
                        原来的路径是「点开队伍 → 记住队长 ID → 去选手列表搜这个 ID → 再找联系方式」，
                        36 支队就是 36 遍。这里一次给全：ID、号码、是 QQ 还是手机、一键复制。
                        号码缺失时显式标黄，避免「看着有空位、实际没填」被漏掉。 */}
                    {/* 阵容摘要：七个点位 + 人数，点一下开弹窗看名单与操作。
                        弹窗而不是就地展开 —— 四列（ID/姓名/学号）+ 每人操作塞不进卡片宽度，
                        就地展开会把卡片撑高、把 ID 截断（负责人截图里已经截了）。 */}
                    <button
                      type="button"
                      onClick={() => openModal({ kind: "team-detail", team })}
                      className={`mt-[6px] flex w-full items-center gap-[6px] border-t border-[var(--adm-line-soft)] pt-[5px] text-left ${DENSE_META}`}
                    >
                      <span className={`${DENSE_MICRO} font-bold text-[var(--adm-text-mute)]`}>阵容</span>
                      <span className="flex items-center gap-[2px]" aria-hidden="true">
                        {Array.from({ length: GAME.roster.starters + 2 }, (_, i) => {
                          const filled = i < roster.starterCount || i >= GAME.roster.starters;
                          return <span key={i} className={`h-[6px] w-[12px] ${filled ? "bg-[var(--adm-text-soft)]" : "bg-[var(--adm-line-soft)]"}`} />;
                        })}
                      </span>
                      <span className="font-bold tabular-nums text-[var(--adm-text-soft)]">{members.length} 人</span>
                      <span className="text-[var(--adm-red-text)] group-hover:underline">查看队员与核验</span>
                    </button>

                    <div className={`mt-[5px] flex min-w-0 items-center gap-[6px] ${DENSE_META}`}>
                      <span className={`${DENSE_MICRO} font-bold text-[var(--adm-text-mute)]`}>队长</span>
                      {captain ? (
                        <>
                          <span className="min-w-0 truncate font-bold text-[var(--adm-text)]">{captain.gameId}</span>
                          <span className={`shrink-0 ${DENSE_MICRO} font-bold text-[var(--adm-text-mute)]`}>{captain.qq ? "QQ" : captain.phone ? "手机" : "联系方式"}</span>
                          <span className={`truncate tabular-nums ${roster.contact === "未填写" ? "text-[var(--adm-red-text)]" : "text-[var(--adm-text-soft)]"}`}>{roster.contact}</span>
                          {roster.contact !== "未填写" && <CopyButton text={roster.contact} title={`复制队长 ${captain.gameId} 的联系方式`} className={copyActionClass} />}
                        </>
                      ) : (
                        <span className="font-bold text-[var(--adm-warn-text)]">队长不在名单中</span>
                      )}
                    </div>
                    
                  </article>
                );
              })}
                </div>
              )
        )}

        {tab === "history" && (
          (state.operationLogs?.length ?? 0) === 0 ? (
            <div className="p-5">
              <EmptyState
                title="还没有操作记录"
                description="本页做的每一次通过、驳回、解散、开关报名都会记在这里，最近一次可以撤销。"
              />
            </div>
          ) : (
            <div className="divide-y divide-[var(--adm-line-soft)]">
              {(state.operationLogs ?? []).map((log: RegistrationAuditLog) => (
                <div key={log.id} className={`flex flex-col justify-between gap-4 px-5 py-4 md:flex-row md:items-center ${log.undoneAt ? "bg-[var(--adm-surface-2)] text-[var(--adm-text-mute)]" : ""}`}>
                  <div><div className="flex flex-wrap items-center gap-2"><p className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{log.summary}</p>{log.undoneAt && <span className="adm-chip" data-tone="neutral" data-dot="off">已撤销</span>}</div>{log.reason && <p className="mt-1 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">原因：{log.reason}</p>}<p className="mt-1.5 text-[length:var(--adm-fs-xs)] tabular-nums text-[var(--adm-text-mute)]">{formatTime(log.createdAt)} · {log.actor}</p></div>
                  {!log.undoneAt && latestUndoable?.id === log.id && <button type="button" onClick={() => runOperation("undo", { logId: log.id })} disabled={busy} className="adm-btn adm-btn--secondary adm-btn--md w-fit">撤销这次操作</button>}
                </div>
              ))}
            </div>
          )
        )}
      </section>

      {modal?.kind === "edit-player" && <AdminModal title={`编辑报名 · ${modal.player.gameId}`} onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="adm-btn adm-btn--secondary adm-btn--md">取消</button><button type="button" onClick={submitModal} disabled={busy} className="adm-btn adm-btn--primary adm-btn--md">保存更正</button></>}>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="姓名"><input className={inputClass} value={form.name ?? ""} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="学号"><input className={inputClass} value={form.studentId ?? ""} onChange={(event) => setForm({ ...form, studentId: event.target.value })} /></Field><Field label="游戏 ID"><input className={inputClass} value={form.gameId ?? ""} onChange={(event) => setForm({ ...form, gameId: event.target.value })} /></Field><Field label="段位"><input className={inputClass} value={form.rank ?? ""} onChange={(event) => setForm({ ...form, rank: event.target.value })} /></Field><Field label="QQ"><input className={inputClass} value={form.qq ?? ""} onChange={(event) => setForm({ ...form, qq: event.target.value })} /></Field><Field label="手机号"><input className={inputClass} value={form.phone ?? ""} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field></div>
        <div className="mt-4"><p className="mb-1.5 block text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">擅长位置</p><div className="flex flex-wrap gap-2">{GAME.positions.map((pos) => { const active = editPositions.includes(pos); return <button key={pos} type="button" onClick={() => setEditPositions((current) => current.includes(pos) ? current.filter((item) => item !== pos) : [...current, pos])} className={`border px-3 py-1.5 text-[length:var(--adm-fs-md)] transition ${active ? "border-[var(--adm-red)] bg-[var(--adm-red)] text-white" : "border-[var(--adm-line)] bg-[var(--adm-surface)] text-[var(--adm-text-soft)] hover:border-[var(--adm-red)]"}`}>{pos}</button>; })}</div></div>
        <Field label="自我介绍"><textarea className={`${inputClass} min-h-20 resize-y`} value={form.intro ?? ""} onChange={(event) => setForm({ ...form, intro: event.target.value })} placeholder="选填" /></Field>
        <Field label="修改原因"><textarea className={`${inputClass} min-h-20 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="如：选手联系负责人更正游戏 ID" /></Field>
      </AdminModal>}

      {modal?.kind === "delete-player" && (() => {
        const team = state.teams.find((candidate) => candidate.id === modal.player.teamId);
        const isCaptain = team?.captainId === modal.player.id;
        const remainingCount = team ? team.memberIds.filter((id) => id !== modal.player.id).length : 0;
        return <AdminModal title={`删除选手 · ${modal.player.gameId}`} subtitle="报名数据会被移除，选手无法再登录参赛管理；删除后可在「操作记录」中撤销。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="adm-btn adm-btn--secondary adm-btn--md">取消</button><button type="button" onClick={submitModal} disabled={busy} className="adm-btn adm-btn--primary adm-btn--md">确认删除</button></>}>
          <p className="text-[length:var(--adm-fs-lg)] leading-[1.75] text-[var(--adm-text-soft)]">确定要删除 <span className="font-semibold text-[var(--adm-text)]">{modal.player.gameId}</span>（{modal.player.name}）吗？</p>
          <ul className="space-y-1.5 text-[length:var(--adm-fs-md)] leading-[1.65] text-[var(--adm-text-soft)]">
            {team ? (
              <li>将移出队伍「{team.name}」：{isCaptain ? (remainingCount > 0 ? "队长自动移交给队内现有成员" : "该队已无成员，将标记为退赛") : "自动腾出其队内位置"}</li>
            ) : (
              <li>该选手未组队，无队伍关联。</li>
            )}
            <li>与该选手相关的组队申请会一并清理。</li>
            <li>报名资料与参赛码一并移除，不可恢复（可在操作记录中撤销）。</li>
          </ul>
        </AdminModal>;
      })()}

      {modal?.kind === "create-team" && <AdminModal title="负责人代建队伍" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="adm-btn adm-btn--secondary adm-btn--md">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.name?.trim() || !form.captainId} className="adm-btn adm-btn--primary adm-btn--md">创建队伍</button></>}><Field label="队伍名称"><input autoFocus className={inputClass} value={form.name ?? ""} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="输入参赛队名" /></Field><Field label="队长"><select className={inputClass} value={form.captainId ?? ""} onChange={(event) => setForm({ ...form, captainId: event.target.value })}><option value="">选择已审核且未组队选手</option>{unteamedApproved.map((player) => <option key={player.id} value={player.id}>{player.gameId}（{player.rank}）</option>)}</select></Field><Field label="队长场上角色"><select className={inputClass} value={form.captainRole ?? "首发"} onChange={(event) => setForm({ ...form, captainRole: event.target.value })}><option>首发</option><option>替补</option><option>教练</option></select></Field></AdminModal>}

      {modal?.kind === "rename-team" && <AdminModal title={`修改队名 · ${modal.team.name}`} subtitle="仅组队期可改；改名后生成赛程时会用新队名。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="adm-btn adm-btn--secondary adm-btn--md">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.name?.trim() || !form.reason?.trim()} className="adm-btn adm-btn--primary adm-btn--md">确认改名</button></>}><Field label="新队名"><input autoFocus className={inputClass} value={form.name ?? ""} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="输入新队名（≤40 字）" /></Field><Field label="改名原因"><textarea className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="如：队长申请更正队名" /></Field></AdminModal>}

      {modal?.kind === "team-detail" && (
        <TeamRosterModal
          team={modal.team}
          members={state.players.filter((player) => player.teamId === modal.team.id)}
          canAssign={
            modal.team.status === "报名中" && !state.teamRegistrationClosed && unteamedApproved.length > 0
          }
          onClose={() => setModal(null)}
          onAssign={(role) => {
            const team = modal.team;
            setModal(null);
            openModal({ kind: "assign-player", team, role });
          }}
          onMemberAction={(player, action) => {
            const team = modal.team;
            setModal(null);
            if (action === "change-role") openModal({ kind: "set-member-role", player });
            else if (action === "replace") openModal({ kind: "replace-player", team, outgoing: player });
            else openModal({ kind: "remove-player", player });
          }}
        />
      )}

      {modal?.kind === "set-member-role" && <AdminModal title={`调整角色 · ${modal.player.gameId}`} subtitle="仅组队期可改；目标角色须有空位。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="adm-btn adm-btn--secondary adm-btn--md">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.role || !form.reason?.trim()} className="adm-btn adm-btn--primary adm-btn--md">确认调整</button></>}><Field label="新角色"><select className={inputClass} value={form.role ?? "首发"} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}><option>首发</option><option>替补</option><option>教练</option></select></Field><Field label="调整原因"><textarea autoFocus className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="如：队长与队员协商后调整位置" /></Field></AdminModal>}

      {modal?.kind === "assign-player" && <AdminModal title="添加队员" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="adm-btn adm-btn--secondary adm-btn--md">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.playerId || !form.teamId} className="adm-btn adm-btn--primary adm-btn--md">确认加入</button><button type="button" onClick={() => openModal({ kind: "create-player", team: activeTeams.find((team) => team.id === form.teamId), role: (form.role as Role) ?? "替补" })} className="adm-btn adm-btn--secondary adm-btn--md">人不在列表里，代录</button></>}><Field label="选手"><select className={inputClass} value={form.playerId ?? ""} onChange={(event) => setForm({ ...form, playerId: event.target.value })}><option value="">选择已审核且未组队选手</option>{unteamedApproved.map((player) => <option key={player.id} value={player.id}>{player.gameId}（{player.rank}）</option>)}</select></Field><Field label="队伍"><select className={inputClass} value={form.teamId ?? ""} onChange={(event) => setForm({ ...form, teamId: event.target.value })}><option value="">选择报名中的队伍</option>{activeTeams.filter((team) => team.status === "报名中").map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Field><Field label="队内角色"><select className={inputClass} value={form.role ?? "首发"} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}><option>首发</option><option>替补</option><option>教练</option></select></Field></AdminModal>}

      {modal?.kind === "create-player" && <AdminModal title="代录选手" subtitle="给没有线上报名记录的选手补一条报名数据。代录即视为资料已通过，并会生成一个新的参赛码（只显示一次，请转交本人）。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="adm-btn adm-btn--secondary adm-btn--md">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.gameId?.trim() || !form.name?.trim() || !form.studentId?.trim() || !form.rank?.trim() || editPositions.length === 0} className="adm-btn adm-btn--primary adm-btn--md">确认代录</button></>}>
        <Field label="游戏 ID"><input autoFocus className={inputClass} value={form.gameId ?? ""} onChange={(event) => setForm({ ...form, gameId: event.target.value })} placeholder="如：炫炫子#8961" /></Field>
        <Field label="姓名"><input className={inputClass} value={form.name ?? ""} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="真实姓名" /></Field>
        <Field label="学号"><input className={inputClass} value={form.studentId ?? ""} onChange={(event) => setForm({ ...form, studentId: event.target.value })} placeholder="如：Y40251577" /></Field>
        <Field label="段位"><input className={inputClass} value={form.rank ?? ""} onChange={(event) => setForm({ ...form, rank: event.target.value })} placeholder="如：铂金 / 钻石 / 超凡" /></Field>
        <Field label="QQ 号"><input className={inputClass} value={form.qq ?? ""} onChange={(event) => setForm({ ...form, qq: event.target.value })} placeholder="选填" /></Field>
        <Field label="手机号"><input className={inputClass} value={form.phone ?? ""} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="选填" /></Field>
        <Field label="擅长位置" help="至少选一个。">
          <div className="flex flex-wrap gap-2">
            {GAME.positions.map((position) => {
              const active = editPositions.includes(position);
              return (
                <button key={position} type="button" onClick={() => setEditPositions(active ? editPositions.filter((item) => item !== position) : [...editPositions, position])} className={`border px-3 py-2 text-[length:var(--adm-fs-md)] font-bold ${active ? "border-[var(--adm-red)] bg-[var(--adm-red)] text-white" : "border-[var(--adm-line)] bg-[var(--adm-surface)] text-[var(--adm-text-soft)] hover:border-[var(--adm-text)]"}`}>{position}</button>
              );
            })}
          </div>
        </Field>
        <Field label="直接编入队伍" help="留空则只录入选手，不进队。">
          <select className={inputClass} value={form.teamId ?? ""} onChange={(event) => setForm({ ...form, teamId: event.target.value })}>
            <option value="">不编入队伍</option>
            {activeTeams.filter((team) => team.status !== "已退赛").map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </Field>
        <Field label="队内角色"><select className={inputClass} value={form.role ?? "替补"} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}><option>替补</option><option>首发</option><option>教练</option></select></Field>
        <Field label="代录原因"><textarea className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="如：开赛后临时补位，本人未及报名" /></Field>
      </AdminModal>}

      {modal?.kind === "remove-player" && (() => { const options = captainReplacementOptions(modal.player); return <AdminModal title={`移出名单 · ${modal.player.gameId}`} subtitle="选手会回到未组队状态，队伍名单重新进入待确认。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="adm-btn adm-btn--secondary adm-btn--md">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.reason?.trim() || (options.length > 0 && !form.replacementCaptainId)} className="adm-btn adm-btn--primary adm-btn--md">确认执行</button></>}>
        {options.length > 0 && <Field label="新队长" help="当前选手是队长，必须先移交队长身份。"><select className={inputClass} value={form.replacementCaptainId ?? ""} onChange={(event) => setForm({ ...form, replacementCaptainId: event.target.value })}><option value="">请选择新队长</option>{options.map((player) => <option key={player.id} value={player.id}>{player.gameId}</option>)}</select></Field>}<Field label="原因"><textarea autoFocus className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="请记录申请来源和原因" /></Field>
      </AdminModal>; })()}

      {modal?.kind === "reopen-team" && <AdminModal title={`开放名单调整 · ${modal.team.name}`} subtitle="已确认名单会退回报名中状态，调整完成后需要再次确认。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="adm-btn adm-btn--secondary adm-btn--md">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.reason?.trim()} className="adm-btn adm-btn--primary adm-btn--md">开放调整</button></>}><Field label="开放原因"><textarea autoFocus className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ reason: event.target.value })} placeholder="如：队长申请更换一名首发" /></Field></AdminModal>}

      {modal?.kind === "replace-player" && <AdminModal title={`换人 · ${modal.team.name}`} subtitle="新选手会继承原选手的角色；若替换队长，新选手同时接任队长。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="adm-btn adm-btn--secondary adm-btn--md">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.outgoingPlayerId || !form.incomingPlayerId || !form.reason?.trim()} className="adm-btn adm-btn--primary adm-btn--md">确认换人</button></>}><Field label="原选手"><select className={inputClass} value={form.outgoingPlayerId ?? ""} onChange={(event) => setForm({ ...form, outgoingPlayerId: event.target.value })}>{state.players.filter((player) => player.teamId === modal.team.id).map((player) => <option key={player.id} value={player.id}>{player.gameId}（{player.role}）</option>)}</select></Field><Field label="新选手"><select className={inputClass} value={form.incomingPlayerId ?? ""} onChange={(event) => setForm({ ...form, incomingPlayerId: event.target.value })}><option value="">选择已审核且未组队的选手</option>{unteamedApproved.map((player) => <option key={player.id} value={player.id}>{player.gameId}（{player.rank}）</option>)}</select></Field><Field label="换人原因"><textarea className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="请记录申请来源和原因" /></Field></AdminModal>}

      {modal?.kind === "withdraw-team" && <AdminModal title={`整队退赛 · ${modal.team.name}`} subtitle="队伍会保留为退赛记录，原成员回到未组队状态。" onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="adm-btn adm-btn--secondary adm-btn--md">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.reason?.trim()} className="adm-btn adm-btn--primary adm-btn--md">确认整队退赛</button></>}><Field label="退赛原因"><textarea autoFocus className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ reason: event.target.value })} placeholder="请记录队长申请或主办方处理原因" /></Field></AdminModal>}

      {modal?.kind === "dissolve-team" && <AdminModal title={`解散队伍 · ${modal.team.name}`} subtitle={modal.team.status === "已冻结" ? "该队伍名单已确认但尚未进入对阵图；解散会删除整支队伍，成员回到未组队，需重新补足参赛名额。此操作可撤销。" : "仅组队期适用；队伍会被删除（不留记录），所有成员回到未组队状态，可撤销。"} onClose={() => setModal(null)} footer={<><button type="button" onClick={() => setModal(null)} className="adm-btn adm-btn--secondary adm-btn--md">取消</button><button type="button" onClick={submitModal} disabled={busy || !form.reason?.trim()} className="bg-[var(--adm-red)] inline-flex min-h-[44px] items-center px-4 text-[length:var(--adm-fs-md)] font-bold text-white disabled:opacity-40">确认解散</button></>}><Field label="解散原因"><textarea autoFocus className={`${inputClass} min-h-24 resize-y`} value={form.reason ?? ""} onChange={(event) => setForm({ reason: event.target.value })} placeholder="如：队伍组建无法凑齐，或重复报名需要清理" /></Field></AdminModal>}
    </div>
  );
}

