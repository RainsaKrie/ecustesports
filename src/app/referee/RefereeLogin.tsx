// =====================
// 裁判台 · 登录视图（2026-10-27 从 RefereeWorkbench.tsx 拆出）
// 只依赖 6 个显式 props：凭证、赛事 ID、错误文案、提交回调。
// 抽它的原因：三个视图里它耦合最浅（其余两个依赖大量表单状态与文件引用）。
// =====================

import type { FormEvent } from "react";
import Button from "@/components/ui/Button";

export function RefereeLogin({
  credential,
  setCredential,
  eventId,
  setEventId,
  error,
  onSubmit,
}: {
  credential: string;
  setCredential: (value: string) => void;
  eventId: string;
  setEventId: (value: string) => void;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <p className="mono-label text-[var(--pub-red)]">REFEREE GATE</p>
        <h1 className="display-type mt-2 text-[2.4rem] font-extrabold leading-none tracking-[-0.05em] text-[var(--pub-txt)]">
          裁判工作台
        </h1>
        <p className="mt-3 text-base text-[var(--pub-txt-soft)]">输入管理员发给你的裁判凭证，进入被分配的比赛。</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="mono-label text-[var(--pub-txt)]">裁判凭证</span>
          <input
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            placeholder="粘贴凭证"
            autoComplete="off"
            className="h-[48px] border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-4 text-base text-[var(--pub-txt)] outline-none focus:border-[#ff4655]"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="mono-label text-[var(--pub-txt)]">赛事 ID</span>
          <input
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            placeholder="例如 event-1"
            autoComplete="off"
            className="h-[48px] border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-4 text-base text-[var(--pub-txt)] outline-none focus:border-[#ff4655]"
          />
        </label>
        {error && <p className="text-sm text-[#ff4655]">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="mt-2 w-full">
          进入工作台
        </Button>
      </form>
      <p className="mt-6 text-xs leading-relaxed text-[var(--pub-txt-soft)]">凭证只保存在当前页面内存中，刷新或关闭页面后需要重新输入。</p>
    </div>
  );
}
