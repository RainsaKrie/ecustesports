"use client";

import type { ReactNode } from "react";

/**
 * 管理端基础件（唯一来源）。
 *
 * 同一组样式在改造前有几十种写法手写在各页面里，这里收敛成一处。
 * 2026-10-20 起形态来自 admin-theme.css：输入 44px 定值、面板玻璃卡 —— 页面只写类名。
 */

export const adminInputClass = "adm-input";

export const adminTextareaClass = `${adminInputClass} resize-y`;

export const adminSelectClass = adminInputClass;

/** 表单字段：标签 + 说明 + 错误 + 可选计数。计数用于有字数上限的字段。 */
export function Field({
  label,
  hint,
  error,
  counter,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  counter?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[length:var(--adm-fs-sm)] font-semibold text-[var(--adm-text-soft)]">{label}</span>
        {counter && <span className="text-[length:var(--adm-fs-xs)] tabular-nums text-[var(--adm-text-mute)]">{counter}</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-[length:var(--adm-fs-xs)] leading-relaxed text-[var(--adm-text-mute)]">{hint}</span>}
      {error && <span className="mt-1.5 block text-[length:var(--adm-fs-xs)] font-bold leading-relaxed text-[var(--adm-red-text)]">{error}</span>}
    </label>
  );
}

/** 区块：眉标 + 标题 + 说明 + 右侧动作。一个区块最多一个 primary 动作。 */
export function Panel({
  eyebrow,
  title,
  description,
  actions,
  children,
  bare = false,
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  bare?: boolean;
}) {
  const hasHead = Boolean(eyebrow || title || actions);
  return (
    <section className="adm-panel">
      {hasHead && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--adm-line-soft)] px-5 py-4">
          <div>
            {eyebrow && (
              <p className="adm-micro">{eyebrow}</p>
            )}
            {title && <h2 className="mt-1 text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{title}</h2>}
            {description && <p className="mt-1 text-[length:var(--adm-fs-sm)] leading-relaxed text-[var(--adm-text-soft)]">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bare ? "" : "p-5"}>{children}</div>
    </section>
  );
}

/**
 * 状态语义档 —— 标签与方点共用这一套取值。
 *
 * 设计取舍（2026-10-08 重做）：改造前用「描边 + 浅底 + 彩字」五套语义色，
 * 一共 15 个色值，满屏彩色小块，看起来杂乱。
 * 现在徽标本体只有一种中性样式（白底 + 结构线 + 次色文字），
 * **语义只由一个 6px 方点承载**，颜色降到「线 + 字 + 一个点色」。
 * 进行中不用颜色区分，用「空心方点」——形状比颜色更安静。
 *
 * ★ 样式的唯一来源是 `globals.css` 里的 `.adm-chip`（标签）与 `.adm-note`（提示条），
 *   两者都在 `@layer components` 里。调用点**直接写类名**：
 *   `<span className="adm-chip" data-tone="done">` / `<div className="adm-note adm-note--danger">`。
 *
 * ★ **不要给状态标签 / 提示条建 React 包装组件。** 曾经建过 `StatusPill`、
 *   `StatusNote`、`Toolbar` 三个，**全仓库零引用**（调用点一律直写 CSS 类），
 *   只在仓库里留成「两套并行实现」，每次重构都要重新判断哪一套是唯一来源。
 *   2026-10-08 收掉。
 *
 *   `AdminButton` 是**例外** —— `AdminUIProvider` 的确认弹窗真的在用它，所以保留。
 *   **判断标准：有真实调用点才建组件。建完要数一遍导入处，注意同目录的相对导入
 *   （`from "./AdminButton"`）也算 —— 只数 `@/components/admin/ui` 会漏报。**
 */
export type AdminBadgeTone = "neutral" | "active" | "done" | "attention";

const DOT_CLASS: Record<AdminBadgeTone, string> = {
  neutral: "bg-[var(--adm-text-mute)]",
  active: "border border-[var(--adm-text-soft)] bg-transparent",
  done: "bg-[var(--adm-text)]",
  attention: "bg-[var(--adm-red)]",
};

/** 方形语义点（全站无圆角，所以是方块不是圆点）。 */
export function StatusDot({ tone = "neutral" }: { tone?: AdminBadgeTone }) {
  return <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 ${DOT_CLASS[tone]}`} />;
}

/** 空态：说明「为什么空」+「下一步做什么」，不留白板。 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 border border-dashed border-[var(--adm-line)] bg-white/[0.03] px-6 py-10 text-center">
      <p className="text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text)]">{title}</p>
      {description && <p className="max-w-md text-[length:var(--adm-fs-sm)] leading-relaxed text-[var(--adm-text-soft)]">{description}</p>}
      {action}
    </div>
  );
}
