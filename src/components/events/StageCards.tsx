// =====================
// 编号阶段卡（2026-10-18）
//
// 把首页那排「01/02/03/04」的卡片抽成组件 —— 首页有，内页没有，这是他说的「设计一到内页就消失」
// 的具体所指（缺的是**结构**，不是风格）。
//
// 语言照抄首页：编号（等宽）+ 右上红「＋」+ 英文小标（等宽、大字距、红）+ 中文粗标题 +
// 完成情况；**当前阶段反白并用 clip-path 切掉右下角**（首页 brand-mark 的同一招）。
// 配色沿用公开面既有的硬编码色（var(--pub-txt) / var(--pub-card) / rgba(255,255,255,0.06) / #ff4655），与管理端令牌分开。
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
  /** 当前阶段的索引（反白那一格）；没有则全部常规样式 */
  currentIndex?: number;
  className?: string;
}

export default function StageCards({ items, currentIndex, className = "" }: StageCardsProps) {
  if (items.length === 0) return null;
  return (
    <div className={`grid grid-cols-2 border border-[var(--pub-line)] md:grid-cols-4 ${className}`}>
      {items.map((item, index) => {
        const isActive = index === currentIndex;
        const isDone = typeof item.total === "number" && typeof item.done === "number" && item.total > 0 && item.done >= item.total;
        const note =
          item.note ??
          (typeof item.total === "number" && typeof item.done === "number" ? `${item.done} / ${item.total} 已完成` : undefined);
        return (
          <div
            key={item.label}
            className={[
              "flex min-h-[9.5rem] flex-col justify-between p-5",
              index % 2 === 0 ? "border-r border-[var(--pub-line)]" : "",
              "md:border-r md:border-[var(--pub-line)]",
              index === items.length - 1 ? "md:border-r-0" : "",
              index < 2 ? "border-b border-[var(--pub-line)] md:border-b-0" : "",
              isActive
                ? "bg-[var(--pub-card)] ring-2 ring-inset ring-[#ff4655]"
                : isDone
                  ? "bg-[var(--pub-card)]/[0.06]"
                  : "bg-[var(--pub-card)]",
            ].join(" ")}
          >
            <div className="flex items-start justify-between">
              <span className={`font-mono text-xs tracking-[0.12em] ${isActive ? "text-[var(--pub-red)]" : "text-[var(--pub-txt-mute)]"}`}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <span aria-hidden className="text-lg leading-none text-[#ff4655]">＋</span>
            </div>
            <div>
              {item.en && (
                <p className={`font-mono text-[0.625rem] font-black uppercase tracking-[0.16em] text-[var(--pub-red)]`}>
                  {item.en}
                </p>
              )}
              <h3 className={`mt-1.5 text-[1.375rem] font-black leading-tight tracking-[-0.01em] text-[var(--pub-txt)]`}>
                {item.label}
              </h3>
              {note && <p className={`mt-2 font-mono text-[0.6875rem] tracking-[0.04em] ${isActive ? "text-[var(--pub-txt)]" : "text-[var(--pub-txt-soft)]"}`}>{note}</p>}
            </div>
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
