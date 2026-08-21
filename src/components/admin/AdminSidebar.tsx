"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getLifecycleStages, stateStyles, type ModuleWithState } from "@/lib/operations-data";
import type { EditableEvent } from "@/lib/site-config-schema";
import type { EventStage } from "@/lib/scheduling/stage";

interface AdminSidebarProps {
  event: EditableEvent;
  stage: EventStage;
  modules: ModuleWithState[];
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

export default function AdminSidebar({ event, stage, modules }: AdminSidebarProps) {
  const lifecycle = getLifecycleStages(stage);
  // 生命周期 5 段 → 对应模块跳转
  const stageModuleHref: Record<string, string> = {
    筹备: `/admin/events/${event.id}/planning`,
    报名: `/admin/events/${event.id}/registration`,
    分组: `/admin/events/${event.id}/schedule`,
    比赛: `/admin/events/${event.id}/schedule`,
    赛后: `/admin/events/${event.id}/schedule`,
  };

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

          {/* 生命周期条（阶段指示，点击跳对应模块） */}
          <div className="mb-5 flex items-center gap-0 border border-slate-200 bg-white">
            {lifecycle.map((item) => (
              <Link
                key={item.label}
                href={stageModuleHref[item.label]}
                title={item.label}
                className={`flex flex-1 flex-col items-center gap-1 border-r border-slate-100 px-1 py-2 transition last:border-r-0 ${item.state === "active" ? "bg-[#fff1f2]" : item.state === "done" ? "hover:bg-slate-50" : "opacity-40 hover:opacity-70"}`}
              >
                <span className={`h-1.5 w-1.5 rotate-45 ${item.state === "active" ? "bg-[#ff4655]" : item.state === "done" ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden />
                <span className={`text-[0.5625rem] font-bold ${item.state === "active" ? "text-[#c83242]" : "text-slate-500"}`}>{item.label}</span>
              </Link>
            ))}
          </div>

          <p className="mb-2 px-3 font-mono text-[0.5625rem] font-bold tracking-[0.14em] text-slate-400">赛事工作区</p>
          <NavLinks eventId={event.id} modules={modules} />

        </div>
      </aside>

      <div className="border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <details>
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-slate-900">
            <span>{event.name} · 工作区导航</span>
            <span className="text-[#ff4655]">MENU</span>
          </summary>
          <div className="mt-3 border-t border-slate-200 pt-3"><NavLinks eventId={event.id} modules={modules} /></div>
        </details>
      </div>
    </>
  );
}
