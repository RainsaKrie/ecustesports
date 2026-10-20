import type { CSSProperties } from "react";

// =====================
// 编号阶段卡（2026-10-18，2026-10-20 改成 v8 的阶段条语言）
//
// 以前这一条是"首页的编号卡"：每格 min-h 9.5rem、右上一个红「＋」、当前阶段用
// ring-2 描一圈红 —— 描边只说明"它是当前"，看不出"走到哪了、还剩多少"。
//
// 现在用 v8 的三个语义：
//   · .ui-stage.done —— 编号转红、标题压灰（这一阶段已经打完）
//   · .ui-stage.now  —— 渐变底 + 左侧 2px 红条（这一阶段正在进行）
//   · 底部进度线     —— 红实线覆盖到当前阶段的位置（比"红框"更早被看到）
//
// 列数按 items.length 走 CSS 变量 --stage-cols：3 段赛事不该排出空列。
// =====================

export interface StageCardItem {
  /** 显示名，如「小组赛」 */
  label: string;
  /** 英文小标，如 GROUP STAGE */
  en?: string;
  /** 完成数 / 总数；都给不出时只显示一句说明 */
  done?: number;
  total?: number;
  note?: string;
}

export interface StageCardsProps {
  items: StageCardItem[];
  /** 当前阶段的索引（高亮那一格）；没有则全部常规样式 */
  currentIndex?: number;
  className?: string;
}

export default function StageCards({ items, currentIndex, className = "" }: StageCardsProps) {
  if (items.length === 0) return null;

  const progress = Math.min(100, Math.max(0, ((currentIndex ?? 0) / Math.max(1, items.length)) * 100));

  return (
    <div className={`ui-stages ${className}`} style={{ "--stage-cols": items.length } as CSSProperties}>
      <span aria-hidden className="ui-stage-progress" style={{ width: `${progress}%` }} />
      {items.map((item, index) => {
        const isActive = index === currentIndex;
        const isDone =
          typeof item.total === "number" && typeof item.done === "number" && item.total > 0 && item.done >= item.total;
        const note =
          item.note ??
          (typeof item.total === "number" && typeof item.done === "number" ? `${item.done} / ${item.total} 场已完成` : undefined);
        const serial = `STAGE ${String(index + 1).padStart(2, "0")}`;

        return (
          <div key={item.label} className={["ui-stage", isDone ? "done" : "", isActive ? "now" : ""].join(" ").trim()}>
            <div className="n">{item.en ?? serial}</div>
            <div className="t">{item.label}</div>
            {note && <div className="m">{note}</div>}
          </div>
        );
      })}
    </div>
  );
}

const PHASE_EN: Record<string, string> = {
  资格赛: "QUALIFIER",
  入围赛: "PLAY-IN",
  小组赛: "GROUP STAGE",
  淘汰赛: "PLAYOFFS",
  总决赛: "GRAND FINAL",
};

/**
 * 从比赛列表推导阶段卡（赛程页与赛事页共用一份，避免两处各写一遍）。
 * 顺序 = 比赛里首次出现的顺序；当前阶段 = 第一个还没打完的。
 */
export function stageCardsFromMatches(
  matches: Array<{ phase: string; status: string }>,
): { items: StageCardItem[]; currentIndex?: number } {
  const order = Array.from(new Set(matches.map((match) => match.phase)));
  const items = order.map((phase) => {
    const inPhase = matches.filter((match) => match.phase === phase);
    return {
      label: phase,
      en: PHASE_EN[phase] ?? undefined,
      done: inPhase.filter((match) => match.status === "已完成").length,
      total: inPhase.length,
    };
  });
  const current = items.findIndex((item) => (item.done ?? 0) < (item.total ?? 0));
  return { items, currentIndex: current >= 0 ? current : undefined };
}
