"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { getLifecycleStages, stateStyles, type ModuleWithState, type StageGuidance } from "@/lib/operations-data";
import type { EditableEvent } from "@/lib/site-config-schema";
import type { EventStage } from "@/lib/scheduling/stage";

interface AdminSidebarProps {
  event: EditableEvent;
  stage: EventStage;
  modules: ModuleWithState[];
  guidance: StageGuidance;
}

function StageStatusPanel({ stage, guidance, eventId }: { stage: EventStage; guidance: StageGuidance; eventId: string }) {
  const router = useRouter();
  const [transitioning, setTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState("");
  const lifecycle = getLifecycleStages(stage);
  const visibleBlockers = guidance.blockers.slice(0, 3);

  async function runStageTransition(action: NonNullable<StageGuidance["actionKind"]>) {
    const confirmations: Record<NonNullable<StageGuidance["actionKind"]>, string> = {
      "open-registration": "进入报名阶段后，玩家将按照当前报名时间与规则提交参赛信息。确认继续？",
      "close-registration": "结束报名后将停止新报名与名单调整，并进入分组抽签阶段。确认继续？",
      "complete-event": "结束赛事后，玩家侧将进入赛后状态。确认全部赛果已经核验？",
    };
    if (!window.confirm(confirmations[action])) return;
    setTransitioning(true);
    setTransitionError("");
    try {
      const response = await fetch("/api/admin/events/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, action }),
      });
      const result = await response.json() as { message?: string; event?: EditableEvent };
      if (!response.ok || !result.event) throw new Error(result.message || "阶段更新失败");
      if (action === "close-registration") {
        router.push(`/admin/events/${eventId}/schedule/draw`);
      } else if (action === "complete-event") {
        router.push(`/admin/events/${eventId}/schedule`);
      } else {
        router.refresh();
      }
    } catch (error) {
      setTransitionError(error instanceof Error ? error.message : "阶段更新失败");
      setTransitioning(false);
    }
  }

  const transitionLabels: Record<NonNullable<StageGuidance["actionKind"]>, string> = {
    "open-registration": "正在进入报名阶段…",
    "close-registration": "正在进入分组阶段…",
    "complete-event": "正在结束赛事…",
  };

  return (
    <section className="border border-black/15 bg-[#f2eee6]" aria-label="当前赛事阶段与下一步">
      <div className="flex min-h-11 items-center justify-between gap-2 border-b border-black/15 px-4 py-3">
        <p className="font-mono text-[0.5625rem] font-black tracking-[0.16em] text-[#34383e]">STAGE / 赛事阶段</p>
        <span className="bg-[#ff4655] px-2 py-1 text-[0.5625rem] font-black text-white">{guidance.label}</span>
      </div>
      <ol className="grid grid-cols-5 border-b border-black/15 bg-[#fffdf8]" aria-label="赛事生命周期">
        {lifecycle.map((item) => (
          <li key={item.label} className="min-w-0 border-r border-black/10 px-1 py-3 text-center last:border-r-0">
            <span className={`mx-auto mb-2 block h-1 w-7 max-w-full ${item.state === "active" ? "bg-[#ff4655]" : item.state === "done" ? "bg-[#171a1f]" : "bg-[#d8d1c6]"}`} aria-hidden />
            <span className={`block text-[0.5625rem] font-black ${item.state === "active" ? "text-[#d93746]" : item.state === "done" ? "text-[#34383e]" : "text-[#a39d94]"}`}>{item.label}</span>
          </li>
        ))}
      </ol>
      <div className="p-4">
        <p className="font-mono text-[0.5rem] font-black tracking-[0.14em] text-[#ff4655]">阶段目标</p>
        <p className="mt-2 text-xs font-black leading-5 text-[#171a1f]">{guidance.objective}</p>
        {visibleBlockers.length > 0 && (
          <div className="mt-4 border-t border-black/15 pt-3">
            <p className="text-[0.5625rem] font-black text-[#d93746]">待完成事项</p>
            <ul className="mt-2 space-y-1.5 text-[0.625rem] font-medium leading-4 text-[#34383e]">
              {visibleBlockers.map((blocker) => <li key={blocker} className="flex gap-2"><span className="text-[#ff4655]">—</span><span>{blocker}</span></li>)}
            </ul>
            {guidance.blockers.length > visibleBlockers.length && <p className="mt-2 text-[0.5625rem] font-bold text-[#575c62]">其余待处理事项：{guidance.blockers.length - visibleBlockers.length} 项</p>}
          </div>
        )}
        {guidance.actionKind ? (
          <button type="button" onClick={() => runStageTransition(guidance.actionKind!)} disabled={transitioning} className="mt-4 flex min-h-12 w-full items-center justify-between bg-[#ff4655] px-4 py-3 text-left text-xs font-black text-white transition hover:bg-[#d93746] disabled:cursor-wait disabled:opacity-60">
            <span>{transitioning ? transitionLabels[guidance.actionKind] : guidance.actionLabel}</span><span aria-hidden>→</span>
          </button>
        ) : (
          <Link href={guidance.actionHref} className="mt-4 flex min-h-12 items-center justify-between bg-[#ff4655] px-4 py-3 text-xs font-black text-white transition hover:bg-[#d93746]">
            <span>{guidance.actionLabel}</span><span aria-hidden>→</span>
          </Link>
        )}
        {transitionError && <p className="mt-2 text-[0.625rem] font-bold leading-4 text-red-700" role="alert">{transitionError}</p>}
      </div>
    </section>
  );
}

function NavLinks({ eventId, modules }: { eventId: string; modules: ModuleWithState[] }) {
  const pathname = usePathname();
  const links = [
    ...modules.map((m) => ({
      number: m.number,
      label: m.label,
      href: m.href.replace("event-1", eventId),
      core: m.core,
      state: m.state,
      stateLabel: m.stateLabel,
    })),
  ];

  return (
    <nav className="space-y-1" aria-label="赛事工作区导航">
      {links.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`group flex items-center gap-3 border-l-2 px-3 py-2.5 text-sm transition ${active ? "border-l-[#ff4655] bg-[#fff1f2] font-bold text-slate-950" : "border-l-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}
          >
            <span className={`font-mono text-[0.5625rem] font-bold tracking-[0.08em] ${active ? "text-[#ff4655]" : "text-slate-400"}`}>{item.number}</span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className={`shrink-0 border px-1.5 py-0.5 text-[0.5rem] font-bold ${stateStyles[item.state]}`}>{item.stateLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default function AdminSidebar({ event, stage, modules, guidance }: AdminSidebarProps) {
  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto px-4 py-5">
          {/* 返回赛事列表（明显入口） */}
          <Link href="/admin" className="mb-4 flex items-center gap-2 text-xs font-bold text-slate-500 transition hover:text-[#c83242]">
            <span className="border border-slate-300 px-1.5 py-0.5 font-mono text-[0.625rem]">←</span>
            返回赛事列表
          </Link>

          {/* 当前赛事 */}
          <div className="mb-4">
            <p className="text-sm font-black text-slate-950">{event.name}</p>
            <p className="mt-1 text-[0.625rem] text-slate-400">{event.game}</p>
          </div>

          <div className="mb-5"><StageStatusPanel stage={stage} guidance={guidance} eventId={event.id} /></div>

          <p className="mb-2 px-3 font-mono text-[0.5625rem] font-bold tracking-[0.14em] text-slate-400">赛事工作区</p>
          <NavLinks eventId={event.id} modules={modules} />

        </div>
      </aside>

      <div className="border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <details>
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-slate-900">
            <span>{event.name} · {guidance.label}</span>
            <span className="text-[#ff4655]">MENU</span>
          </summary>
          <div className="mt-3 space-y-3 border-t border-slate-200 pt-3"><StageStatusPanel stage={stage} guidance={guidance} eventId={event.id} /><NavLinks eventId={event.id} modules={modules} /></div>
        </details>
      </div>
    </>
  );
}
