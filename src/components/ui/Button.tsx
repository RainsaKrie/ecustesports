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
}: ButtonProps) {
  const baseClass = `btn-cut inline-flex items-center justify-center gap-3 disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`;

  if (href) {
    return <Link href={href} className={baseClass}>{children}</Link>;
  }

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={baseClass}>
      {children}
    </button>
  );
}
