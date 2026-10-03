"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";

import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import {
  initialRegistration,
  normalizeRegistrationState,
  POSITIONS,
  TEAM_SIZE,
  type RegistrationAuditLog,
  type RegistrationPlayer,
  type RegistrationState,
  type RegistrationTeam,
} from "@/lib/scheduling/registration-data";
import { RANK_VALUE, teamAvgRank } from "@/lib/scheduling/format-data";

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
 * 队伍视图分档。报名截止后的真实状态是「一批满编 + 几支还缺人」，
 * 混在一起看既找不到要催的队，也看不出哪些已经可以确认。
 */
type TeamFilter = "全部" | "未满编" | "满编待确认" | "已确认";
const TEAM_FILTERS: readonly TeamFilter[] = ["全部", "未满编", "满编待确认", "已确认"];

/**
 * 队伍排序方式。
 *
 * 「平均段位」沿用**赛制里那一套口径**（`teamAvgRank`）：只算首发 5 人、段位值 铁1→无畏战魂9、
 * 未填段位的人被剔除。资格赛的参赛队就是按这个顺序取最弱的一批，
 * 所以这里必须跟赛制共用同一个函数，不能各算一份。
 */
type TeamSort = "待办优先" | "平均段位";
const TEAM_SORTS: readonly TeamSort[] = ["待办优先", "平均段位"];

interface TeamRoster {
  members: RegistrationPlayer[];
  /** 队长本人（`team.captainId` 指向的那名选手）；数据异常时可能找不到，故为可选。 */
  captain?: RegistrationPlayer;
  /** 队长的联系方式（QQ 优先，其次手机号）；查不到队长或两栏都空时是「未填写」。 */
  contact: string;
  starterCount: number;
  complete: boolean;
  frozen: boolean;
  withdrawn: boolean;
  /** 首发段位均值（口径见 `teamAvgRank`）；一个人都没填段位时为 0。 */
  avgRank: number;
  /** 首发里没填段位（或段位值无法识别）的人数 —— 会影响均值可信度，要显式提示。 */
  unrankedStarters: number;
}

function teamRoster(state: RegistrationState, team: RegistrationTeam): TeamRoster {
  const members = state.players.filter((player) => player.teamId === team.id);
  const starters = members.filter((player) => player.role === "首发");
  const captain = members.find((player) => player.id === team.captainId);
  return {
    members,
    captain,
    contact: captain ? contactOf(captain) : "未填写",
    starterCount: starters.length,
    complete: starters.length >= TEAM_SIZE,
    frozen: team.status === "已冻结",
    withdrawn: team.status === "已退赛",
    avgRank: teamAvgRank(team, state.players),
    unrankedStarters: starters.filter((player) => !(RANK_VALUE[player.rank] > 0)).length,
  };
}

/**
 * 把队伍列表里每位队长的联系方式汇总成一段可直接粘贴的文本。
 *
 * 用途很具体：队长群缺人时，负责人要挨个加人，不能靠「点开队伍 → 记 ID → 去选手列表搜」
 * 这条路走 36 遍。制表符分隔是为了**粘进表格就是三列**（Excel / 腾讯文档），
 * 直接粘进聊天窗口也仍然读得懂。
 */
function captainContactSheet(rows: Array<{ team: RegistrationTeam; roster: TeamRoster }>): string {
  const lines = rows.map(({ team, roster }) => [
    team.name,
    roster.captain?.gameId ?? "（队长不在名单中）",
    roster.contact,
  ].join("\t"));
  return ["队伍\t队长\t联系方式", ...lines].join("\n");
}

function matchesTeamFilter(filter: TeamFilter, roster: TeamRoster): boolean {
  switch (filter) {
    case "未满编": return !roster.withdrawn && !roster.complete;
    case "满编待确认": return !roster.withdrawn && roster.complete && !roster.frozen;
    case "已确认": return roster.frozen;
    default: return true;
  }
}

/** 排序：需要处理的排前面 —— 缺人 → 满编待确认 → 已确认 → 已退赛。 */
function teamSortRank(roster: TeamRoster): number {
  if (roster.withdrawn) return 3;
  if (!roster.complete) return 0;
  if (!roster.frozen) return 1;
  return 2;
}

/**
 * 卡片内的文字型操作按钮（编辑资料 / 删除选手等）。
 *
 * 触控区仍要够大：其中「删除选手」是破坏性操作，误触代价是丢数据。
 * min-h-10 = 40px，在移动端可用与桌面密度之间取折中。
 */
const textActionClass = "inline-flex min-h-[32px] items-center whitespace-nowrap text-[13px] font-bold leading-tight hover:underline";

/**
 * 卡片内的一键复制。与 `textActionClass` 同一密度档，但带框 ——
 * 它按下去会改自己的文案（复制 / 已复制 / 复制失败），
 * 没有边框的话这三个状态在同一行里看起来只是文字抖动。
 */
const copyActionClass = "inline-flex h-[22px] shrink-0 items-center border border-slate-300 bg-white px-[6px] text-[11px] font-bold leading-none text-slate-600 hover:border-slate-900 hover:text-slate-900";
const subscribeStatic = () => () => {};

/**
 * 这个工作台是**操作台**不是展示页：一屏要看几十行，一支队有 20 多个交互点。
 *
 * ⚠️ globals.css 里桌面根字号是 150%（24px），而 **Tailwind 的字号类与间距类都是 rem**
 * —— 也就是说 text-xs 在桌面等于 18px，`min-h-11` 等于 66px。
 * 所以这里**字号与间距一律写固定 px**（`text-[14px]`、`min-h-[40px]`、`gap-[10px]`），
 * 不随根字号放大，密度才可控。改动本文件时请沿用这个约定，
 * 不要退回 `min-h-11` / `gap-3` 这类 rem 类，否则桌面又会撑开。
 *
 * 队伍卡片 2026-10-03 又压了一轮：原来是「每名成员占一整行」，一支满编队要 7 行、
 * 一屏只看得到 2 支多。现在成员做成 22px 的行内标签流，7 个槽位通常压成 3 行，
 * 列数由 2 列提到 3 列。**再改这里时请守住「标签流 + 固定 px」这两条**，
 * 否则很快会退回一屏两支的状态。
 */
const DENSE_TITLE = "text-[15px]";     // 队名
const DENSE_BODY = "text-[14px]";      // 成员名、正文
const DENSE_META = "text-[12px]";      // 摘要、次级信息
const DENSE_MICRO = "text-[11px]";     // 徽章
const DENSE_CHIP = "text-[13px]";      // 成员标签
const ROSTER_SLOT_LABEL = "w-[44px] shrink-0 pt-[5px]"; // 角色名 + 计数列的固定宽度与对齐

/** 标签流里每个成员/空缺槽位的高度 —— 卡片密度的主要旋钮。 */
const CHIP_HEIGHT = "h-[22px]";

/** 只有被标记为不合规的选手才显示徽章 —— 默认通过不产生视觉噪音。 */
function isFlagged(status: ReviewStatus | undefined) {
  return status === "需修改" || status === "已拒绝";
}

/**
 * 行内「更多」菜单：把低频操作（改名 / 解散队伍 / 换人 / 移出）收起来。
 * 用受控 state 而不是 <details>，因为卡片列表里需要「点开一个自动关掉另一个」，
 * 且要支持点击外部关闭。
 */
function InlineMenu({ label, items, compact = false }: {
  label: string;
  items: Array<{ text: string; onSelect: () => void; tone?: string }>;
  /** 嵌在成员标签里时用无边框的小按钮，避免一个标签出现两层框。 */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocumentDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocumentDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocumentDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className={`inline-flex items-center justify-center leading-none ${compact
          ? "h-[20px] w-[18px] text-[13px] font-black text-slate-400 hover:bg-slate-100 hover:text-slate-900"
          : "h-[30px] w-[30px] border border-slate-300 bg-white text-[14px] font-black text-slate-500 hover:border-slate-900 hover:text-slate-900"}`}
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-[2px] w-[116px] border border-slate-300 bg-white py-[3px]">
          {items.map((item) => (
            <button
              key={item.text}
              type="button"
              onClick={() => { setOpen(false); item.onSelect(); }}
              className={`block w-full px-[10px] py-[6px] text-left text-[13px] font-bold leading-tight hover:bg-slate-100 ${item.tone ?? "text-slate-700"}`}
            >
              {item.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

/**
 * 一键复制。
 *
 * 这是**联系人**类信息，手工记数字必然出错（QQ 与手机号都是长数字串），
 * 所以复制按钮不是锦上添花，而是这条动线上唯一可靠的输入方式。
 *
 * 用 `navigator.clipboard`（只在安全上下文可用，localhost 与 https 都在其内），
 * 且**必须留失败兜底**：剪贴板被拒时（无权限、非安全上下文）要让人知道，
 * 不能让按钮看起来点了没反应 —— 那会让人以为号码已经复制走了。
 */
function CopyButton({ text, label = "复制", copiedLabel = "已复制", title, className = "", disabled = false }: {
  text: string;
  label?: string;
  /** 复制成功后的文案。长标签的按钮要传等长的文案，否则按钮宽度会跳。 */
  copiedLabel?: string;
  title?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const settle = (next: "copied" | "failed") => {
    setStatus(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus("idle"), 1600);
  };
  const tone = status === "copied" ? "text-emerald-700" : status === "failed" ? "text-red-700" : "";
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={() => {
        const pending = navigator.clipboard?.writeText(text);
        if (!pending) { settle("failed"); return; }
        pending.then(() => settle("copied")).catch(() => settle("failed"));
      }}
      className={`${className} ${tone}`}
    >
      {status === "copied" ? copiedLabel : status === "failed" ? "复制失败" : label}
    </button>
  );
}

/**
 * 名单里的一个成员标签。角色与序号由所在那一行决定，标签本身只放
 * 游戏 ID + 队长标记 + 异常徽章 + 一个收起式操作入口 —— 一行 40px 的信息
 * 压进 22px 里，是队伍列表能一屏看十来支的关键。
 */
function RosterMemberChip({
  player,
  team,
  onReplace,
  onRemove,
  onChangeRole,
}: {
  player: RegistrationPlayer;
  team: RegistrationTeam;
  onReplace: () => void;
  onRemove: () => void;
  onChangeRole?: () => void;
}) {
  const isCaptain = team.captainId === player.id;
  // 低频操作收进菜单：改角色 / 换人 / 移出原本常驻每一行，
  // 一支满编队 7 个槽位就是 21 个按钮 —— 这是列表显得挤压的主因。
  const actions: Array<{ text: string; onSelect: () => void; tone?: string }> = [];
  if (team.status === "报名中" && onChangeRole) actions.push({ text: "改角色", onSelect: onChangeRole });
  if (team.status !== "已退赛") actions.push({ text: "换人", onSelect: onReplace, tone: "text-[#c83242]" });
  if (team.status === "报名中") actions.push({ text: "移出", onSelect: onRemove, tone: "text-red-700" });
  const flagged = isFlagged(player.reviewStatus);
  const tone = flagged
    ? reviewTone(player.reviewStatus)
    : isCaptain
      ? "border-slate-400 bg-slate-50 text-slate-900"
      : "border-slate-200 bg-white text-slate-800";

  return (
    <span className={`inline-flex ${CHIP_HEIGHT} max-w-full items-center border ${tone}`} title={`${player.gameId}${isCaptain ? "（队长）" : ""}`}>
      <span className={`max-w-[104px] truncate pl-[6px] ${DENSE_CHIP} font-bold leading-none`}>{player.gameId}</span>
      {isCaptain && <span className={`ml-[4px] shrink-0 ${DENSE_MICRO} font-bold text-slate-400`}>队长</span>}
      {flagged && <span className={`ml-[4px] shrink-0 ${DENSE_MICRO} font-bold`}>{player.reviewStatus}</span>}
      {actions.length > 0 ? <InlineMenu compact label={`${player.gameId} 的操作`} items={actions} /> : <span className="w-[5px]" />}
    </span>
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
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("全部");
  const [teamSort, setTeamSort] = useState<TeamSort>("待办优先");
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
  // 审核已改为「默认通过 + 手动标记」：不再有「待审核」，
  // 只剩「需修改 / 已拒绝」这一种异常态需要负责人关注。
  const flaggedPlayers = activePlayers.filter((player) => isFlagged(player.reviewStatus));
  const unteamedApproved = activePlayers.filter((player) => player.status === "已报名" && player.reviewStatus === "已通过");
  const activeTeams = state.teams.filter((team) => team.status !== "已退赛");
  const confirmedTeams = activeTeams.filter((team) => team.status === "已冻结").length;
  const visiblePlayers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return state.players.filter((player) => {
      if (reviewFilter !== "全部" && player.reviewStatus !== reviewFilter) return false;
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
        status={flaggedPlayers.length > 0 ? `${flaggedPlayers.length} 人资料待修改` : `${confirmedTeams}/${activeTeams.length} 队已确认`}
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

      <section className="mb-5 grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["有效报名", `${activePlayers.length} 人`],
          ["资料待修改", `${flaggedPlayers.length} 人`],
          ["未组队", `${unteamedApproved.length} 人`],
          ["正式队伍", `${confirmedTeams}/${activeTeams.length} 支`],
        ].map(([label, value]) => (
          <div key={label} className="bg-white p-[12px] leading-tight">
            <p className={`${DENSE_MICRO} font-bold tracking-[0.12em] text-slate-400`}>{label}</p>
            <p className="mt-[4px] font-mono text-[20px] font-black text-slate-950">{value}</p>
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
            <div className="flex gap-[6px] px-[10px] pb-[10px] md:pb-0">
              <button type="button" onClick={() => runOperation("approve-all-players")} disabled={busy || flaggedPlayers.length === 0} className="inline-flex min-h-[32px] shrink-0 items-center bg-emerald-600 px-[10px] text-[13px] font-bold leading-tight text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">全部通过{flaggedPlayers.length > 0 ? `（${flaggedPlayers.length} 人）` : ""}</button>
              <input value={query} onChange={(event) => { setQuery(event.target.value); setPlayerPage(1); }} placeholder="搜索游戏 ID、姓名或学号" className="min-h-[32px] min-w-0 border border-slate-200 px-[10px] text-[13px] leading-tight outline-none focus:border-[#ff4655] md:w-56" />
              <select value={reviewFilter} onChange={(event) => { setReviewFilter(event.target.value as typeof reviewFilter); setPlayerPage(1); }} className="min-h-[32px] border border-slate-200 bg-white px-[8px] text-[13px] leading-tight outline-none">
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
                className="inline-flex min-h-[32px] shrink-0 items-center bg-[#ff4655] px-[10px] text-[13px] font-bold leading-tight text-white hover:bg-[#d83b48] disabled:cursor-not-allowed disabled:opacity-40"
              >
                一键确认满编队伍{teamBuckets["满编待确认"] > 0 ? `（${teamBuckets["满编待确认"]}）` : ""}
              </button>
              <div className="flex shrink-0 overflow-hidden border border-slate-200">
                {TEAM_FILTERS.map((bucket) => (
                  <button
                    key={bucket}
                    type="button"
                    onClick={() => setTeamFilter(bucket)}
                    className={`inline-flex min-h-[32px] items-center gap-[5px] border-r border-slate-200 px-[10px] text-[13px] font-bold leading-tight last:border-r-0 ${teamFilter === bucket ? "bg-[#fff1f2] text-[#c83242]" : "bg-white text-slate-500 hover:text-slate-950"}`}
                  >
                    {bucket}
                    <span className="font-mono text-[11px] font-bold text-slate-400">{teamBuckets[bucket]}</span>
                  </button>
                ))}
              </div>
              <div className="flex shrink-0 overflow-hidden border border-slate-200">
                {TEAM_SORTS.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTeamSort(mode)}
                    title={mode === "平均段位" ? "按首发 5 人的段位均值排序，强 → 弱（替补与教练不计）" : "缺人、待确认的队伍排在前面"}
                    className={`inline-flex min-h-[32px] items-center gap-[5px] border-r border-slate-200 px-[10px] text-[13px] font-bold leading-tight last:border-r-0 ${teamSort === mode ? "bg-[#fff1f2] text-[#c83242]" : "bg-white text-slate-500 hover:text-slate-950"}`}
                  >
                    排序：{mode}
                  </button>
                ))}
              </div>
              {/* 汇总复制：队长群缺人时，一次拿到当前列表全部队长的号，
                  不用在 36 张卡里挨个点。复制的是**当前筛选与排序下的队伍**，
                  按钮上直接写出队数，避免「筛了一半却以为复制的是全部」。 */}
              <CopyButton
                text={captainContactSheet(visibleTeams)}
                disabled={visibleTeams.length === 0}
                label={`复制队长联系方式（${visibleTeams.length} 队）`}
                copiedLabel={`已复制（${visibleTeams.length} 队）`}
                title="按当前筛选与排序复制：队名 / 队长游戏 ID / 联系方式，制表符分隔，可直接粘进表格或聊天窗口"
                className="inline-flex min-h-[32px] shrink-0 items-center border border-slate-300 bg-white px-[10px] text-[13px] font-bold leading-tight text-slate-700 hover:border-slate-950 disabled:cursor-not-allowed disabled:text-slate-300"
              />
            </div>
          )}
        </div>

        {tab === "players" && (
          visiblePlayers.length === 0 ? <p className="px-5 py-16 text-center text-xs text-slate-400">没有符合条件的选手</p> : (
            <div className="divide-y divide-slate-100">
              {pagedPlayers.map((player) => {
                const team = state.teams.find((candidate) => candidate.id === player.teamId);
                return (
                  <article key={player.id} className={`p-[10px] leading-tight ${player.status === "已退赛" ? "bg-slate-50/70 text-slate-400" : "text-slate-700"}`}>
                    <div className="flex items-center justify-between gap-[10px]">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-baseline gap-[6px]">
                          <p className={`truncate ${DENSE_BODY} font-bold text-slate-950`}>{player.gameId}</p>
                          {/* 默认通过不再显示徽章 —— 159 个人人都挂一个「已通过」只是噪音 */}
                          {isFlagged(player.reviewStatus) && (
                            <span className={`shrink-0 border px-[6px] py-[1px] ${DENSE_MICRO} font-bold ${reviewTone(player.reviewStatus)}`}>{player.reviewStatus}</span>
                          )}
                        </div>
                        <p className={`mt-[1px] truncate ${DENSE_MICRO}`}>{player.name} · {player.studentId}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-[10px]">
                        {player.status !== "已退赛" && isFlagged(player.reviewStatus) && <button type="button" onClick={() => runOperation("review-player", { playerId: player.id, reviewStatus: "已通过" })} disabled={busy} className={`${textActionClass} text-emerald-700 disabled:text-slate-400`}>标记通过</button>}
                        <button type="button" onClick={() => openModal({ kind: "edit-player", player })} className={`${textActionClass} text-slate-700`}>编辑资料</button>
                        <button type="button" onClick={() => openModal({ kind: "delete-player", player })} className={`${textActionClass} text-red-700`}>删除选手</button>
                      </div>
                    </div>
                    <div className={`mt-[6px] grid gap-[5px] border-t border-slate-100 pt-[6px] ${DENSE_META} sm:grid-cols-2 xl:grid-cols-4`}>
                      <div><p className={`${DENSE_MICRO} font-bold text-slate-400`}>段位 / 位置</p><p className="mt-0.5 truncate">{player.rank} · {(player.positions ?? []).join("、") || "未填"}</p></div>
                      <div><p className={`${DENSE_MICRO} font-bold text-slate-400`}>联系方式</p><p className="mt-0.5 truncate">{contactOf(player)}</p></div>
                      <div className="sm:col-span-2"><p className={`${DENSE_MICRO} font-bold text-slate-400`}>队伍状态</p><p className="mt-0.5 truncate">{team ? <><span className="font-bold text-slate-800">{team.name}</span><span className="ml-1 text-slate-400">· {player.role}</span></> : player.status === "已退赛" ? "已退赛" : "未组队"}</p></div>
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
          state.teams.length === 0
            ? <p className="px-5 py-16 text-center text-xs text-slate-400">暂无队伍</p>
            : visibleTeams.length === 0
              ? <p className="px-5 py-16 text-center text-xs text-slate-400">这个筛选下没有队伍</p>
              : (
                <div className="grid gap-px bg-slate-200 md:grid-cols-2 xl:grid-cols-3">
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
                  teamActions.push({ text: "解散队伍", onSelect: () => openModal({ kind: "dissolve-team", team }), tone: "text-amber-700" });
                }
                if (team.status !== "已退赛") {
                  teamActions.push({ text: "整队退赛", onSelect: () => openModal({ kind: "withdraw-team", team }), tone: "text-red-700" });
                }
                return (
                  <article key={team.id} className={`bg-white px-[10px] py-[8px] leading-tight ${roster.withdrawn ? "bg-slate-50/70 text-slate-400" : ""}`}>
                    <div className="flex items-start justify-between gap-[8px]">
                      <div className="flex min-w-0 flex-wrap items-center gap-[6px]">
                        <h3 className={`truncate ${DENSE_TITLE} font-black text-slate-950`}>{team.name}</h3>
                        <span className={`shrink-0 border px-[6px] py-[1px] ${DENSE_MICRO} font-bold ${teamTone(team.status)}`}>{team.status === "已冻结" ? "正式名单" : team.status}</span>
                        <span className={`shrink-0 font-mono ${DENSE_MICRO} font-bold ${roster.complete ? "text-slate-400" : "text-amber-600"}`}>首发 {roster.starterCount}/{TEAM_SIZE}</span>
                        {/* 平均段位是资格赛选队的依据，必须看得见 —— 否则「按段位排序」也是黑箱。
                            一个人都没填段位时不显示 0.00，那会让人误以为是「最弱」。 */}
                        <span className={`shrink-0 font-mono ${DENSE_MICRO} font-bold text-slate-500`} title="首发 5 人段位均值（铁 1 → 无畏战魂 9）">均 {roster.avgRank > 0 ? roster.avgRank.toFixed(2) : "—"}</span>
                        {roster.unrankedStarters > 0 && <span className={`shrink-0 border border-amber-300 px-[5px] py-[1px] ${DENSE_MICRO} font-bold text-amber-700`}>{roster.unrankedStarters} 人未填段位</span>}
                      </div>
                      <div className="flex shrink-0 items-center gap-[4px]">
                        {team.status === "已冻结" && <button type="button" onClick={() => openModal({ kind: "reopen-team", team })} className="border border-slate-300 inline-flex h-[24px] items-center px-[8px] text-[12px] font-bold leading-tight text-slate-700 hover:border-slate-950">开放调整</button>}
                        <InlineMenu compact label={`${team.name} 的更多操作`} items={teamActions} />
                      </div>
                    </div>
                    {flaggedCount > 0 && <p className={`mt-[4px] ${DENSE_META} font-bold text-amber-700`}>{flaggedCount} 人资料待修改，需先标记通过才能确认名单</p>}
                    {/* 队长联系方式直接摆在卡片上。负责人要把队长逐个拉进队长群，
                        原来的路径是「点开队伍 → 记住队长 ID → 去选手列表搜这个 ID → 再找联系方式」，
                        36 支队就是 36 遍。这里一次给全：ID、号码、是 QQ 还是手机、一键复制。
                        号码缺失时显式标黄，避免「看着有空位、实际没填」被漏掉。 */}
                    <div className={`mt-[5px] flex min-w-0 items-center gap-[6px] ${DENSE_META}`}>
                      <span className={`${DENSE_MICRO} font-bold text-slate-400`}>队长</span>
                      {captain ? (
                        <>
                          <span className="min-w-0 truncate font-bold text-slate-900">{captain.gameId}</span>
                          <span className={`shrink-0 ${DENSE_MICRO} font-bold text-slate-400`}>{captain.qq ? "QQ" : captain.phone ? "手机" : "联系方式"}</span>
                          <span className={`truncate font-mono ${roster.contact === "未填写" ? "font-bold text-amber-700" : "text-slate-700"}`}>{roster.contact}</span>
                          {roster.contact !== "未填写" && <CopyButton text={roster.contact} title={`复制队长 ${captain.gameId} 的联系方式`} className={copyActionClass} />}
                        </>
                      ) : (
                        <span className="font-bold text-amber-700">队长不在名单中</span>
                      )}
                    </div>
                    <div className="mt-[6px] grid gap-[3px] border-t border-slate-100 pt-[5px]">
                      {([
                        { role: "首发" as const, limit: TEAM_SIZE },
                        { role: "替补" as const, limit: 1 },
                        { role: "教练" as const, limit: 1 },
                      ]).map(({ role, limit }) => {
                        const roleMembers = members.filter((player) => player.role === role);
                        // 数据异常（超出上限）时也要把多出来的人渲染出来，
                        // 否则会出现「列表里看不见、也就删不掉」的成员。
                        const slots = Math.max(limit, roleMembers.length);
                        const short = role === "首发" && roleMembers.length < limit;
                        return (
                          <div key={role} className="flex items-start gap-[6px]">
                            <span className={`${ROSTER_SLOT_LABEL} ${DENSE_MICRO} font-black ${short ? "text-amber-600" : "text-slate-400"}`}>{role} {roleMembers.length}/{limit}</span>
                            <div className="flex min-w-0 flex-1 flex-wrap gap-[3px]">
                              {Array.from({ length: slots }, (_, index) => {
                                const player = roleMembers[index];
                                return player ? (
                                  <RosterMemberChip
                                    key={player.id}
                                    player={player}
                                    team={team}
                                    onChangeRole={() => openModal({ kind: "set-member-role", player })}
                                    onReplace={() => openModal({ kind: "replace-player", team, outgoing: player })}
                                    onRemove={() => openModal({ kind: "remove-player", player })}
                                  />
                                ) : (
                                  <button key={`${role}-${index}`} type="button" onClick={() => openModal({ kind: "assign-player", team, role })} disabled={team.status !== "报名中" || state.teamRegistrationClosed || unteamedApproved.length === 0} className={`inline-flex ${CHIP_HEIGHT} items-center border border-dashed border-slate-300 bg-slate-50 px-[6px] ${DENSE_META} font-bold leading-none text-slate-400 enabled:hover:border-[#ff4655] enabled:hover:text-[#c83242] disabled:cursor-default`}>
                                    {role === "首发" ? `首发 ${index + 1} 空缺` : `${role}空缺`}
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
