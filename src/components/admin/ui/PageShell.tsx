// =====================
// 页面骨架（U2，2026-10-18）
//
// 目的：让每个页面不再自己写布局。三段结构固定：页头 → 上下文条 → 主体。
// 只用 --adm-* 与 --sp-* 令牌，页面里不再出现手写间距（U3 的验收判据就是 grep 这个）。
//
// 设计约束（沿用已确认的约定）：
//   · 标题 ≤24px（管理端不用海报尺寸）；
//   · 主按钮最多一个，用 .adm-btn--primary（白底墨字 + 2px 红条），不许深色填充；
//   · 上下文条一行 ≤5 个数字，每格「12px 眉标 + 24px 数字 + 12px 说明」。
// =====================

import type { ReactNode } from "react";

export interface ContextItem {
  label: string;
  value: ReactNode;
  note?: string;
  /** 需要被看见的那一格（例如待处理数）—— 只允许一个 */
  tone?: "default" | "alert";
}

export function ContextBar({ items }: { items: ContextItem[] }) {
  return (
    <div className="grid grid-cols-2 adm-panel md:grid-cols-3 xl:grid-cols-6">
      {/* 上限 6 格（超过只取前 6）：一行数字太多就变成"数字汤"。只允许一个 tone="alert"。 */}
      {items.slice(0, 6).map((item, index) => (
        <div
          key={item.label}
          className={`p-[var(--sp-4)] xl:p-[var(--sp-6)] ${
            index < items.length - 1 ? "border-r border-[var(--adm-line-soft)]" : ""
          }`}
        >
          <p className="text-[length:var(--fs-xs)] leading-[var(--lh-xs)] text-[var(--adm-text-mute)]">{item.label}</p>
          <p
            className={`mt-[var(--sp-1)] text-[length:var(--fs-h2)] leading-[var(--lh-h2)] font-semibold tabular-nums ${
              item.tone === "alert" ? "text-[var(--adm-red-text)]" : "text-[var(--adm-text)]"
            }`}
          >
            {item.value}
          </p>
          {item.note && (
            <p className="mt-[var(--sp-1)] text-[length:var(--fs-xs)] leading-[var(--lh-xs)] text-[var(--adm-text-soft)]">{item.note}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export interface PageShellProps {
  /** 眉标：必须是中文，且不与标题同词 */
  eyebrow: string;
  title: string;
  description?: ReactNode;
  /** 右侧动作区：最多一个 primary */
  actions?: ReactNode;
  context?: ContextItem[];
  children: ReactNode;
}

export default function PageShell({ eyebrow, title, description, actions, context, children }: PageShellProps) {
  return (
    <div className="space-y-[var(--sp-6)]">
      <header
        className={`flex flex-wrap items-end justify-between gap-[var(--sp-6)] ${
          context ? "adm-panel border-b-0 p-[var(--sp-6)]" : ""
        }`}
      >
        <div className="min-w-0">
          <p className="text-[length:var(--fs-xs)] leading-[var(--lh-xs)] tracking-[0.08em] text-[var(--adm-text-mute)]">{eyebrow}</p>
          <h1 className="mt-[var(--sp-2)] text-[length:var(--fs-xl)] leading-[var(--lh-h2)] font-semibold text-[var(--adm-text)]">{title}</h1>
          {description && (
            <p className="mt-[var(--sp-2)] text-[length:var(--fs-md)] leading-[var(--lh-body)] text-[var(--adm-text-soft)]">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-[var(--sp-2)]">{actions}</div>}
      </header>

      {context && <ContextBar items={context} />}

      <div className="space-y-[var(--sp-8)]">{children}</div>
    </div>
  );
}

export interface SectionProps {
  title: string;
  /** 右侧计数或一句说明（比再放一个卡片更轻） */
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function Section({ title, meta, actions, children }: SectionProps) {
  return (
    <section>
      <div className="mb-[var(--sp-3)] flex flex-wrap items-baseline justify-between gap-[var(--sp-3)]">
        <h2 className="text-[length:var(--fs-h3)] leading-[var(--lh-h3)] font-semibold text-[var(--adm-text)]">{title}</h2>
        <div className="flex items-center gap-[var(--sp-3)]">
          {meta && <span className="text-[length:var(--fs-xs)] text-[var(--adm-text-mute)]">{meta}</span>}
          {actions}
        </div>
      </div>
      {children}
    </section>
  );
}
