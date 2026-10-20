"use client";

import { useEffect, type ReactNode } from "react";

/**
 * 管理端弹窗外壳（唯一来源）。
 *
 * 取代散落的 `window.confirm` / 各文件自建的遮罩层。
 * 行为约定：
 *   - Esc 关闭
 *   - 点遮罩关闭（`dismissible` 为 false 时不关，用于正在提交的场景）
 *   - 打开时锁滚动
 * 视觉约定：直角、结构线、无阴影投射以外的装饰。
 */
export type AdminModalWidth = "sm" | "md" | "lg";

const WIDTH_CLASS: Record<AdminModalWidth, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
};

export function AdminModal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = "md",
  tone = "default",
  dismissible = true,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: AdminModalWidth;
  tone?: "default" | "danger";
  dismissible?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, dismissible]);

  return (
    <div
      className="adm-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(0,0,0,0.6)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`adm-modal-panel adm-panel max-h-[90vh] w-full ${WIDTH_CLASS[width]} overflow-y-auto`}>
        <div
          className={`flex items-start justify-between gap-5 border-b px-5 py-4 ${
            tone === "danger"
              ? "border-[var(--adm-red-line)] bg-[var(--adm-red-soft)]"
              : "border-[var(--adm-line-soft)] bg-[var(--adm-surface)]"
          }`}
        >
          <div>
            <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{title}</h2>
            {subtitle && <p className="mt-1 text-[length:var(--adm-fs-sm)] leading-relaxed text-[var(--adm-text-soft)]">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="adm-btn adm-btn--ghost adm-btn--sm shrink-0"
          >
            关闭
          </button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--adm-line-soft)] bg-[var(--adm-surface)] px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminModal;
