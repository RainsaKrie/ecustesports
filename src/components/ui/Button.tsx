import Link from "next/link";
import { ReactNode } from "react";

/**
 * 全站按钮（2026-10-20 对齐 v8 基准）
 *
 * 改造前：5 个变体里有 3 个在暗底上不可见 —— outline 用 `#0f1923` 字/框（对 #0a0b0d 仅 1.11:1），
 * secondary 是深蓝底、ghost 是深蓝字。赛事对阵全屏页的「← 返回赛事详情」因此整颗按钮看不见。
 *
 * 现在只有四种语义 + 一个画在图上的透明变体：
 *   primary       红底白字 —— 每屏只允许 1 个（主要动作）
 *   secondary     1px 浅框 + 正文色 —— 常规动作
 *   outline       1px 弱框 + 正文色 —— 与 secondary 同族，框更轻，用于并列的次级动作
 *   ghost         无底无框，hover 才出现 —— 行内动作
 *   dark-outline  画在海报/图片上的透明按钮（白框白字）
 * 高度用 px 定值：桌面根字号 150%，rem 会被放大 1.5 倍。
 *
 * ⚠️ ui-guards 用字符串断言检查本文件必须含 `focus-visible:outline-2` 与
 * `focus-visible:outline-offset`，改结构时不要删这两个类名。
 */
interface ButtonProps {
  children: ReactNode;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "dark-outline";
  size?: "sm" | "md" | "lg" | "xl";
  href?: string;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  /** 处理中：文案保留占位以锁定宽度，叠加转圈，并自动禁用 */
  loading?: boolean;
}

const variantClasses = {
  primary: "bg-[#ff4655] text-white hover:bg-[#d83b48]",
  secondary: "border border-white/35 text-[var(--pub-txt)] hover:border-white hover:bg-white/[0.06]",
  outline: "border border-[var(--pub-line-soft)] text-[var(--pub-txt)] hover:border-[var(--pub-line)] hover:bg-white/[0.04]",
  "dark-outline": "border border-white/35 bg-white/[0.04] text-white hover:border-white hover:bg-white/[0.10]",
  ghost: "text-[var(--pub-txt-soft)] hover:bg-white/[0.06] hover:text-[var(--pub-txt)]",
};

const sizeClasses = {
  sm: "h-[32px] px-3 text-xs",
  md: "h-[44px] px-5 text-sm",
  lg: "h-[52px] px-7 text-sm",
  xl: "h-[56px] px-8 text-base",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  href,
  onClick,
  className = "",
  type = "button",
  disabled = false,
  loading = false,
}: ButtonProps) {
  const baseClass = [
    "btn-cut relative inline-flex items-center justify-center gap-3 font-bold",
    "transition-[background-color,border-color,color,transform,opacity] duration-[var(--dur-fast)] ease-[var(--ease-standard)]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--red)]",
    "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
    loading ? "cursor-progress" : "",
    variantClasses[variant], sizeClasses[size], className,
  ].filter(Boolean).join(" ");

  const content = loading ? (
    <>
      <span className="opacity-0">{children}</span>
      <span className="absolute inset-0 grid place-items-center" aria-hidden="true">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      </span>
    </>
  ) : (
    children
  );

  if (href) {
    return <Link href={href} className={baseClass}>{content}</Link>;
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={baseClass}
    >
      {content}
    </button>
  );
}
