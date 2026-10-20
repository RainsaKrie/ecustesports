"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 「更多操作」溢出菜单（唯一来源）。
 *
 * 全站只有这一处实现：页头工具条、卡片行尾、成员标签里的「⋯」都用它。
 * 改造前页头是三到五个平级按钮，看不出哪个是主要动作；
 * 低频动作收进这里之后，一个按钮区就只剩一个主按钮。
 *
 * 行为：点外部关闭、Esc 关闭、打开时焦点进菜单、关闭时焦点还给触发按钮。
 * 按钮样式走 `.adm-btn`，不在组件里重复写颜色。
 */
export interface AdminMenuItem {
  text: string;
  onSelect: () => void;
  /** 可选文字色（用令牌，例如 var(--adm-warn-text)）。不传则跟随菜单默认色。 */
  tone?: string;
  /** 条件不满足时置灰。不要用「点了没反应」来代替置灰。 */
  disabled?: boolean;
}

export default function AdminOverflowMenu({
  label,
  items,
  size = "icon",
  align = "right",
}: {
  label: string;
  items: AdminMenuItem[];
  /**
   * icon：跟页头按钮同高（44px）。
   * compact：跟行内文字动作并排（`adm-btn--sm` 的 32px）。
   * chip：嵌在 22px 高的成员标签里 —— 必须显式压掉 `adm-btn--sm` 自带的
   *       `min-height: 32px`，否则按钮比标签高 10px，每个 chip 右侧鼓出一块。
   */
  size?: "icon" | "compact" | "chip";
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocumentDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDocumentDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocumentDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  if (items.length === 0) return null;

  const triggerClass = size === "chip"
    ? "adm-btn adm-btn--ghost adm-btn--sm h-[22px] min-h-0 w-[22px] px-0"
    : size === "compact"
      ? "adm-btn adm-btn--ghost adm-btn--sm w-[24px] px-0"
      : "adm-btn adm-btn--secondary adm-btn--md w-[44px] px-0";

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        className={triggerClass}
      >
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`absolute top-full z-40 mt-[2px] min-w-[180px] adm-panel py-[3px] ${align === "right" ? "right-0" : "left-0"}`}
        >
          {items.map((item, index) => (
            <button
              key={item.text}
              ref={index === 0 ? firstItemRef : undefined}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onSelect(); }}
              className={`block w-full whitespace-nowrap px-[14px] py-[8px] text-left text-[length:var(--adm-fs-md)] font-medium leading-tight hover:bg-[var(--adm-surface-2)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${item.tone ? "" : "text-[var(--adm-text-soft)]"}`}
              style={item.tone ? { color: item.tone } : undefined}
            >
              {item.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
