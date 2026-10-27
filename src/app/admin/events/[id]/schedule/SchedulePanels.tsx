// =====================
// 赛程页的对阵图零件（2026-10-26 从 page.tsx 拆出）
// fmt / winCount / BracketCard / BlueprintCard / Bracket —— 显式 props，不依赖页面状态。
// `DialogMode` 与 `CLOCK_TICK_MS` 是页面级的，**不在这里**（上次硬拆就是这个原因失败的）。
// =====================

import type { GameResult, ScheduleMatch } from "@/lib/domains/schedule/schedule-data";
import type { BPSession } from "@/lib/domains/schedule/bp-ops";
import TournamentBracketCanvas, { advancementPath } from "@/components/events/TournamentBracketCanvas";
import type { AdminBadgeTone } from "@/components/admin/ui";

export function fmt(iso: string): string {
  if (!iso) return "";
  return iso.slice(5, 16).replace("T", " ");
}

export function winCount(gameResults: GameResult[] | undefined, side: "A" | "B"): number {
  if (!gameResults) return 0;
  return gameResults.filter((g) => (side === "A" ? g.teamAScore > g.teamBScore : g.teamBScore > g.teamAScore)).length;
}

/** 对阵图卡片：点击弹出比赛操作面板 */
export function BracketCard({ m, bp, onClick }: { m: ScheduleMatch; bp?: BPSession; onClick: () => void }) {
  const completed = m.status === "已完成";
  const aWin = completed && m.winnerTeamId === m.teamAId;
  const bWin = completed && m.winnerTeamId === m.teamBId;
  const advancement = advancementPath(m);
  // 卡框一律中性线，状态只由右上角标签的方点承载 —— 原先四种状态四色描边，
  // 一屏几十张卡片就是一片彩色框，喧宾夺主。
  const status: { tone: AdminBadgeTone; label: string } = m.frozen
    ? { tone: "neutral", label: "冻结" }
    : completed
      ? { tone: "done", label: "已完成" }
      : m.status === "待排期"
        ? { tone: "attention", label: "待排期" }
        : { tone: "active", label: "待开始" };

  const row = (name: string | undefined, score: number, win: boolean) => (
    <div className="flex items-center justify-between gap-2">
      <span className={`truncate text-[length:var(--adm-fs-sm)] ${win ? "font-semibold text-[var(--adm-text)]" : "text-[var(--adm-text-soft)]"}`}>
        {name || "待定"}
      </span>
      {completed && (
        <span className={`shrink-0 text-[length:var(--adm-fs-md)] font-semibold tabular-nums ${win ? "text-[var(--adm-red)]" : "text-[var(--adm-text-mute)]"}`}>
          {score}
        </span>
      )}
    </div>
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full adm-panel p-2.5 text-left transition hover:border-[var(--adm-text)]"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-[length:var(--adm-fs-xs)] tabular-nums text-[var(--adm-text-mute)]">{m.id} · {m.boType}</span>
        <span className="adm-chip" data-tone={status.tone}>{status.label}</span>
      </div>
      <div className="space-y-1">
        {row(m.teamAName, winCount(m.gameResults, "A"), aWin)}
        <div className="border-t border-[var(--adm-line-soft)]" />
        {row(m.teamBName, winCount(m.gameResults, "B"), bWin)}
      </div>
      <div className="mt-2 border-t border-[var(--adm-line-soft)] pt-1.5 text-[length:var(--adm-fs-xs)] text-[var(--adm-text-mute)]">
        {m.startTime ? fmt(m.startTime) : "未排期"}
        {m.status === "已排期" && bp ? (bp.status === "已完成" ? " · BP✓" : bp.status === "进行中" ? ` · BP ${bp.actions.length}/${bp.order.length}` : " · BP未开始") : ""}
      </div>
      {advancement && <div className="mt-1 text-[length:var(--adm-fs-xs)] text-[var(--adm-text-mute)]">{advancement}</div>}
    </button>
  );
}

export function BlueprintCard({ m }: { m: ScheduleMatch }) {
  const advancement = advancementPath(m);
  return (
    <div className="border border-dashed border-[var(--adm-line)] bg-[var(--adm-surface)] p-2.5" aria-label={`${m.id} 待抽签签位`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-[length:var(--adm-fs-xs)] tabular-nums text-[var(--adm-text-mute)]">{m.id} · {m.boType}</span>
        <span className="adm-chip" data-tone="neutral">待抽签</span>
      </div>
      <div className="space-y-1.5">
        <div className="border-b border-[var(--adm-line-soft)] pb-1.5 text-[length:var(--adm-fs-sm)] text-[var(--adm-text-mute)]">签位 A</div>
        <div className="text-[length:var(--adm-fs-sm)] text-[var(--adm-text-mute)]">签位 B</div>
      </div>
      <div className="mt-2 border-t border-[var(--adm-line-soft)] pt-1.5 text-[length:var(--adm-fs-xs)] text-[var(--adm-text-mute)]">
        {advancement ?? "抽签后生成正式对阵"}
      </div>
    </div>
  );
}

/** 对阵图：按阶段 → 轮次横向排布 */
export function Bracket({ matches, bpSessions, onSelect }: { matches: ScheduleMatch[]; bpSessions: Record<string, BPSession>; onSelect: (m: ScheduleMatch) => void }) {
  return (
    <TournamentBracketCanvas
      matches={matches}
      renderMatch={(match) => <BracketCard m={match} bp={bpSessions[match.id]} onClick={() => onSelect(match)} />}
    />
  );
}
