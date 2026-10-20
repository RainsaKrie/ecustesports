// =====================
// 公开面状态标签（2026-10-18）
//
// 公开面此前有 4 种写法：PublicSchedule 的 StatusBadge（绿色）、名单里的红描边小标、
// bp 页的 <Badge className="bg-[#ff4655]">、以及若干手写 span。
// 现在收口到这一个组件，只允许四种 tone —— 与"全站只有一个彩色"的规则一致。
//
// 注意：管理端仍用 .adm-chip（令牌色），公开面用这里的硬编码色。两套是**按端分开**的，
// 不是历史遗留 —— 公开面与管理端的色板本来就不同。
// =====================

import type { ReactNode } from "react";

export type StatusTone = "accent" | "live" | "neutral" | "muted";

const TONE_CLASS: Record<StatusTone, string> = {
  // 品牌红：需要被看见的状态（待处理、先手、裁判模式）
  accent: "border-[var(--pub-red)]/35 bg-[rgba(255,70,85,0.12)] text-[var(--pub-red)]",
  // 进行中：唯一带点的红色
  live: "border-[#ff4655] bg-[#ff4655] text-white",
  // 中性：已确认、已完成这类"没事"的状态
  neutral: "border-[var(--pub-line)] bg-[var(--pub-card)] text-[var(--pub-txt-soft)]",
  // 更弱：场次号、BO 这类纯信息
  muted: "border-[var(--pub-line-soft)] bg-white/[0.06] text-[var(--pub-txt-mute)]",
};

export default function StatusChip({
  tone = "neutral",
  children,
  dot = false,
  className = "",
}: {
  tone?: StatusTone;
  children: ReactNode;
  /** 是否显示左侧小圆点（live 建议开） */
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex flex-none items-center gap-1.5 whitespace-nowrap border px-1.5 py-0.5 text-[0.625rem] font-black leading-none tracking-[0.02em] ${TONE_CLASS[tone]} ${className}`}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={`inline-block h-1.5 w-1.5 ${tone === "live" ? "bg-[var(--pub-card)]" : "bg-current"}`}
        />
      )}
      {children}
    </span>
  );
}
