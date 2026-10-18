// =====================
// 骨架屏（U2，2026-10-18）
//
// 用途：首屏与面板加载时占位，避免「白屏抖一下」。
// ★ 只动 opacity（不动 width/height），并且被全局 prefers-reduced-motion 兜底关掉。
//   骨架的脉动是"告知正在加载"的必要反馈，属于循环动画里唯一被允许的一类。
// =====================

export interface SkeletonProps {
  /** 行数（表格骨架用） */
  rows?: number;
  /** 每行高度档位 */
  size?: "sm" | "md";
  className?: string;
}

const heightOf = { sm: "h-[32px]", md: "h-[44px]" } as const;

export default function Skeleton({ rows = 3, size = "md", className = "" }: SkeletonProps) {
  return (
    <div className={`space-y-[var(--sp-2)] ${className}`} aria-busy="true" aria-live="polite">
      <span className="sr-only">正在加载</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className={`adm-skeleton ${heightOf[size]}`} />
      ))}
    </div>
  );
}

/** 单块骨架（卡片、面板内容区用） */
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`adm-skeleton ${className}`} aria-hidden="true" />;
}
