// =====================
// 裁判台的三个小零件（2026-10-26 从 RefereeWorkbench.tsx 拆出）
// fmtTime / Shell / EmptyState —— 纯展示，无状态依赖。
// =====================

import type React from "react";

/** 把 ISO 时间显示成「10-06 12:00」——裁判看比赛时间不需要年份和秒 */
export function fmtTime(iso: string): string {
  if (!iso) return "时间待定";
  return iso.slice(5, 16).replace("T", " ");
}

export function Shell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-6">
      <div className="mb-5 flex items-center justify-between border-b-2 border-[var(--pub-red)] pb-4">
        {/* min-h-[44px] = 44px：手机上可点。此前只有 text-base（约 24px 高），
            是裁判端手机适配里最后一处未达标的触控目标。宽度 53px 本来就够，故不加横向 padding，
            以免按钮变宽把标题挤歪（右侧只有 w-8 的占位）。 */}
        <button
          onClick={onBack}
          className="inline-flex min-h-[44px] items-center text-base text-[var(--pub-txt)] hover:text-[#ff4655]"
        >
          ← 返回
        </button>
        <h1 className="display-type text-xl font-extrabold tracking-[-0.04em] text-[var(--pub-txt)]">{title}</h1>
        <span className="w-8" />
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="border border-dashed border-[var(--pub-line-soft)] bg-white/[0.03] p-10 text-center">
      <p className="text-base text-[var(--pub-txt-soft)]">{text}</p>
    </div>
  );
}

