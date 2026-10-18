// =====================
// 编号阶段卡（2026-10-18）
//
// 把首页那排「01/02/03/04」的卡片抽成组件 —— 首页有，内页没有，这是他说的「设计一到内页就消失」
// 的具体所指（缺的是**结构**，不是风格）。
//
// 语言照抄首页：编号（等宽）+ 右上红「＋」+ 英文小标（等宽、大字距、红）+ 中文粗标题 +
// 完成情况；**当前阶段反白并用 clip-path 切掉右下角**（首页 brand-mark 的同一招）。
// 配色沿用公开面既有的硬编码色（#171a1f / #fffdf8 / #f2eee6 / #ff4655），与管理端令牌分开。
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
    <div className={`grid grid-cols-2 border border-[#d8d1c6] md:grid-cols-4 ${className}`}>
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
              index % 2 === 0 ? "border-r border-[#d8d1c6]" : "",
              "md:border-r md:border-[#d8d1c6]",
              index === items.length - 1 ? "md:border-r-0" : "",
              index < 2 ? "border-b border-[#d8d1c6] md:border-b-0" : "",
              isActive
                ? "bg-[#14171c] text-white"
                : isDone
                  ? "bg-[#f2eee6]"
                  : "bg-[#fffdf8]",
            ].join(" ")}
            style={isActive ? { clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%)" } : undefined}
          >
            <div className="flex items-start justify-between">
              <span className={`font-mono text-xs tracking-[0.12em] ${isActive ? "text-white/55" : "text-[#96918a]"}`}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <span aria-hidden className="text-lg leading-none text-[#ff4655]">＋</span>
            </div>
            <div>
              {item.en && (
                <p className={`font-mono text-[0.625rem] font-black uppercase tracking-[0.16em] ${isActive ? "text-[#ff4655]" : "text-[#c83242]"}`}>
                  {item.en}
                </p>
              )}
              <h3 className={`mt-1.5 text-[1.375rem] font-black leading-tight tracking-[-0.01em] ${isActive ? "text-white" : "text-[#171a1f]"}`}>
                {item.label}
              </h3>
              {note && <p className={`mt-2 font-mono text-[0.6875rem] tracking-[0.04em] ${isActive ? "text-white/60" : "text-[#7b766f]"}`}>{note}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
