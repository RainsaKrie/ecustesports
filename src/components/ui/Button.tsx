import Link from "next/link";
import { ReactNode } from "react";

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
  secondary: "bg-[#0f1923] text-white hover:bg-[#25313b]",
  outline: "border border-[#0f1923]/35 text-[#0f1923] hover:bg-[#0f1923] hover:text-white",
  "dark-outline": "border border-white/35 bg-black/15 text-white hover:border-white hover:bg-white hover:text-[#0f1923]",
  ghost: "text-[#25313b] hover:bg-[#0f1923]/8",
};

const sizeClasses = {
  sm: "px-4 py-2 text-xs",
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-sm",
  xl: "px-10 py-5 text-lg",
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
    "btn-cut relative inline-flex items-center justify-center gap-3",
    "transition-[background-color,border-color,color,transform,opacity] duration-[var(--dur-fast)] ease-[var(--ease-standard)]",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--red)]",
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
