// =====================
// 报名与队伍页 · 纯计算 + 样式常量 + 小展示零件
//
// 从 `RegistrationOperationsWorkspace.tsx` 整段搬来（逐字，只给顶层声明加了 `export`）。
// 那个文件原本 1000 行：一屏要同时看「怎么算队伍状态」与「几十行密集 JSX」，
// 改一处得通读全部上下文。搬出这一层之后，那个文件只剩页面本身。
//
// 这里放三类东西：
//   · 类型与常量（分档、排序方式、密度字号、控件样式）—— 全页共用的口径
//   · 纯计算（`teamRoster` / `matchesTeamFilter` / `teamSortRank` / `captainContactSheet`）
//   · 三个小零件（`CopyButton` / `RosterMemberChip` / `Field`）
//
// ★ 密度约定（原来是写在这个文件头上的，一并搬来，改之前先读）：
//   globals.css 里桌面根字号是 150%（24px），而 **Tailwind 的字号类与间距类都是 rem**
//   —— 也就是说 `text-[length:var(--adm-fs-md)]` 在桌面等于 18px，`min-h-11` 等于 66px。
//   所以这里**字号与间距一律写固定 px**（`text-[length:var(--adm-fs-md)]`、`min-h-[40px]`、`gap-[10px]`），
//   不随根字号放大，密度才可控。改动时请沿用这个约定，
//   不要退回 `min-h-11` / `gap-3` 这类 rem 类，否则桌面又会撑开。
// =====================

"use client";

import { useEffect, useRef, useState } from "react";

import { AdminOverflowMenu, StatusDot, type AdminBadgeTone } from "@/components/admin/ui";
import {
  type RegistrationPlayer,
  type RegistrationState,
  type RegistrationTeam,
} from "@/lib/domains/registration/data";
import { teamAvgRank } from "@/lib/domains/registration/format";
import { getGameConfig, rankValueOf } from "@/lib/games";

/** 首发/替补/教练上限与段位阶梯都取自游戏配置层（原先是写死在本文件里的 5/1/1 与一张段位表）。 */
export const GAME = getGameConfig();

export type Tab = "players" | "teams" | "history";
export type ReviewStatus = NonNullable<RegistrationPlayer["reviewStatus"]>;
export type Role = NonNullable<RegistrationPlayer["role"]>;
export type Modal =
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
  | { kind: "team-detail"; team: RegistrationTeam }
  | { kind: "set-member-role"; player: RegistrationPlayer }
  /**
   * 代录选手：给没走线上报名的选手补一条报名数据，可直接编入指定队伍。
   * 开赛后临时加人走这条路 —— 本人来不及报名，但名单里必须有个选手身份。
   */
  | { kind: "create-player"; team?: RegistrationTeam; role?: Role };

export const inputClass = "w-full adm-panel px-3 py-2.5 text-[length:var(--adm-fs-lg)] text-[var(--adm-text)] outline-none focus:border-[var(--adm-red)] focus:ring-2 focus:ring-[rgba(255,70,85,0.15)]";

/**
 * 队伍视图分档。报名截止后的真实状态是「一批满编 + 几支还缺人」，
 * 混在一起看既找不到要催的队，也看不出哪些已经可以确认。
 */
export type TeamFilter = "全部" | "未满编" | "满编待确认" | "已确认";
export const TEAM_FILTERS: readonly TeamFilter[] = ["全部", "未满编", "满编待确认", "已确认"];

/**
 * 队伍排序方式。
 *
 * 「平均段位」沿用**赛制里那一套口径**（`teamAvgRank`）：只算首发 5 人、段位值 铁1→无畏战魂9、
 * 未填段位的人被剔除。资格赛的参赛队就是按这个顺序取最弱的一批，
 * 所以这里必须跟赛制共用同一个函数，不能各算一份。
 */
export type TeamSort = "待办优先" | "平均段位";
export const TEAM_SORTS: readonly TeamSort[] = ["待办优先", "平均段位"];

export interface TeamRoster {
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

export function teamRoster(state: RegistrationState, team: RegistrationTeam): TeamRoster {
  const members = state.players.filter((player) => player.teamId === team.id);
  const starters = members.filter((player) => player.role === "首发");
  const captain = members.find((player) => player.id === team.captainId);
  return {
    members,
    captain,
    contact: captain ? contactOf(captain) : "未填写",
    starterCount: starters.length,
    complete: starters.length >= GAME.roster.starters,
    frozen: team.status === "已冻结",
    withdrawn: team.status === "已退赛",
    avgRank: teamAvgRank(team, state.players),
    unrankedStarters: starters.filter((player) => rankValueOf(player.rank, GAME) === 0).length,
  };
}

/**
 * 把队伍列表里每位队长的联系方式汇总成一段可直接粘贴的文本。
 *
 * 用途很具体：队长群缺人时，负责人要挨个加人，不能靠「点开队伍 → 记 ID → 去选手列表搜」
 * 这条路走 36 遍。制表符分隔是为了**粘进表格就是三列**（Excel / 腾讯文档），
 * 直接粘进聊天窗口也仍然读得懂。
 */
export function captainContactSheet(rows: Array<{ team: RegistrationTeam; roster: TeamRoster }>): string {
  const lines = rows.map(({ team, roster }) => [
    team.name,
    roster.captain?.gameId ?? "（队长不在名单中）",
    roster.contact,
  ].join("\t"));
  return ["队伍\t队长\t联系方式", ...lines].join("\n");
}

export function matchesTeamFilter(filter: TeamFilter, roster: TeamRoster): boolean {
  switch (filter) {
    case "未满编": return !roster.withdrawn && !roster.complete;
    case "满编待确认": return !roster.withdrawn && roster.complete && !roster.frozen;
    case "已确认": return roster.frozen;
    default: return true;
  }
}

/** 排序：需要处理的排前面 —— 缺人 → 满编待确认 → 已确认 → 已退赛。 */
export function teamSortRank(roster: TeamRoster): number {
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
export const textActionClass = "inline-flex min-h-[32px] items-center whitespace-nowrap text-[length:var(--adm-fs-sm)] font-bold leading-tight hover:underline";

/**
 * 卡片内的一键复制。与 `textActionClass` 同一密度档，但带框 ——
 * 它按下去会改自己的文案（复制 / 已复制 / 复制失败），
 * 没有边框的话这三个状态在同一行里看起来只是文字抖动。
 */
export const copyActionClass = "inline-flex h-[22px] shrink-0 items-center adm-panel px-[6px] text-[length:var(--adm-fs-xs)] font-bold leading-none text-[var(--adm-text-soft)] hover:border-[var(--adm-text)] hover:text-[var(--adm-text)]";
export const subscribeStatic = () => () => {};

/**
 * 这个工作台是**操作台**不是展示页：一屏要看几十行，一支队有 20 多个交互点。
 *
 * ⚠️ globals.css 里桌面根字号是 150%（24px），而 **Tailwind 的字号类与间距类都是 rem**
 * —— 也就是说 text-[length:var(--adm-fs-md)] 在桌面等于 18px，`min-h-11` 等于 66px。
 * 所以这里**字号与间距一律写固定 px**（`text-[length:var(--adm-fs-md)]`、`min-h-[40px]`、`gap-[10px]`），
 * 不随根字号放大，密度才可控。改动本文件时请沿用这个约定，
 * 不要退回 `min-h-11` / `gap-3` 这类 rem 类，否则桌面又会撑开。
 *
 * 队伍卡片 2026-10-03 又压了一轮：原来是「每名成员占一整行」，一支满编队要 7 行、
 * 一屏只看得到 2 支多。现在成员做成 22px 的行内标签流，7 个槽位通常压成 3 行，
 * 列数由 2 列提到 3 列。**再改这里时请守住「标签流 + 固定 px」这两条**，
 * 否则很快会退回一屏两支的状态。
 */
export const DENSE_TITLE = "text-[length:var(--adm-fs-md)]";     // 队名
export const DENSE_BODY = "text-[length:var(--adm-fs-md)]";      // 成员名、正文
export const DENSE_META = "text-[length:var(--adm-fs-xs)]";      // 摘要、次级信息
export const DENSE_MICRO = "text-[length:var(--adm-fs-xs)]";     // 徽章
export const DENSE_CHIP = "text-[length:var(--adm-fs-sm)]";      // 成员标签
// 角色名 + 计数列。原为 44px —— 而「首发 5/5」在 12px 字号下实测需要 48px，
// 差 4px 就折行，于是「首发」「5/5」上下分两行、和旁边单行的 chip 完全对不齐。
export const ROSTER_SLOT_LABEL = "w-[56px] shrink-0 pt-[5px]";

/** 标签流里每个成员/空缺槽位的高度 —— 卡片密度的主要旋钮。 */
export const CHIP_HEIGHT = "h-[22px]";

/** 只有被标记为不合规的选手才显示徽章 —— 默认通过不产生视觉噪音。 */
export function isFlagged(status: ReviewStatus | undefined) {
  return status === "需修改" || status === "已拒绝";
}

/**
 * 审核状态 → 标签语义档（2026-10-08 重做）。
 *
 * 改造前这里返回「描边 + 浅底 + 彩字」三个色值，四个状态就是 12 个色值。
 * 现在只返回一个语义档，视觉交给 `.adm-chip` 的方点：
 * 已通过 = 实心墨点（已定），需修改 = 空心方点（待办），已拒绝 = 红点（出事了）。
 */
export function reviewTone(status: ReviewStatus | undefined): AdminBadgeTone {
  switch (status) {
    case "已通过": return "done";
    case "需修改": return "active";
    case "已拒绝": return "attention";
    default: return "neutral";
  }
}

export function teamTone(status: RegistrationTeam["status"]): AdminBadgeTone {
  if (status === "已冻结") return "done";
  if (status === "已退赛") return "attention";
  return "active";
}

export function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export function contactOf(player: RegistrationPlayer) {
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
export function CopyButton({ text, label = "复制", copiedLabel = "已复制", title, className = "", disabled = false }: {
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
  const tone = status === "copied" ? "text-[var(--adm-ok-text)]" : status === "failed" ? "text-[var(--adm-red-text)]" : "";
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
export function RosterMemberChip({
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
  if (team.status !== "已退赛") actions.push({ text: "换人", onSelect: onReplace, tone: "text-[var(--adm-red-text)]" });
  if (team.status === "报名中") actions.push({ text: "移出", onSelect: onRemove, tone: "text-[var(--adm-red-text)]" });
  const flagged = isFlagged(player.reviewStatus);
  const tone: AdminBadgeTone = reviewTone(player.reviewStatus);

  return (
    <span className={`inline-flex ${CHIP_HEIGHT} max-w-full items-center adm-panel`} title={`${player.gameId}${isCaptain ? "（队长）" : ""}`}>
      {/* 上限从 104px 放宽到 128px：实测 `ECUST004#1004` 这类 ID 内容宽 110px，
          卡在 104px 上被截成 `ECUST002#1…` —— 5 个首发看起来一模一样，分不出谁是谁。
          128px 给 18px 余量，同时仍能一行并排两个 chip（2×128+3 < 可用宽 380）。
          原来靠 `title` 悬停兜底，但 tooltip 不是可用的信息呈现方式（负责人明确不要）。 */}
      <span className={`max-w-[128px] truncate pl-[6px] ${DENSE_CHIP} font-semibold leading-none`}>{player.gameId}</span>
      {isCaptain && <span className={`ml-[4px] shrink-0 ${DENSE_MICRO} font-medium text-[var(--adm-text-mute)]`}>队长</span>}
      {flagged && (
        <span className="ml-[5px] flex shrink-0 items-center gap-1">
          <StatusDot tone={tone} />
          <span className={`${DENSE_MICRO} font-medium text-[var(--adm-text-soft)]`}>{player.reviewStatus}</span>
        </span>
      )}
      {actions.length > 0 ? <AdminOverflowMenu size="chip" label={`${player.gameId} 的操作`} items={actions} /> : <span className="w-[5px]" />}
    </span>
  );
}



export function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">{label}</span>
      {children}
      {help && <span className="mt-1.5 block text-[length:var(--adm-fs-sm)] leading-[1.5] text-[var(--adm-text-mute)]">{help}</span>}
    </label>
  );
}
