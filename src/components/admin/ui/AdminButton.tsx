"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * 管理端按钮（推荐写法）。
 *
 * ⚠️ 样式的唯一来源是 `globals.css` 里的 `.adm-btn` 系列，这个组件只是语法糖。
 *    颜色、高度、字号都在 CSS 里定义，这里不重复写一遍 —— 与 `StatusPill`
 *    之于 `.adm-chip` 是同一套做法。存量页面直接写类名即可，两条路最终同源。
 *
 * 与前台 `components/ui/Button` 是两套语言：前台是海报语言（切角、上浮），
 * 后台是工具语言（直角、无阴影）。遵守 `UI设计规格 v0.1` 第七节。
 *
 * 层级约束（详见 `后台工作台重构设计_v0.1.md` 第 5.1 节）：
 *   primary   本区主要动作，一个按钮区最多一个
 *   secondary 常规动作
 *   ghost     行内动作
 *   danger    破坏性动作，调用方必须配确认
 *   link      跳转
 */
export type AdminButtonLevel = "primary" | "secondary" | "ghost" | "danger" | "link";
export type AdminButtonSize = "sm" | "md" | "lg";

interface AdminButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  level?: AdminButtonLevel;
  size?: AdminButtonSize;
  href?: string;
  className?: string;
  children: ReactNode;
}

export default function AdminButton({
  level = "secondary",
  size = "md",
  href,
  className = "",
  children,
  type = "button",
  ...rest
}: AdminButtonProps) {
  const classes = `adm-btn adm-btn--${level} adm-btn--${size} ${className}`.trim();

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
