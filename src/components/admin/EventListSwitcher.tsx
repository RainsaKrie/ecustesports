import Link from "next/link";
import type { EditableEvent } from "@/lib/site-config-schema";
import { getStatusInfo } from "@/lib/utils";

/** 赛事列表：并列同层次，整行点击进入工作区（赛程） */
export default function EventListSwitcher({ events }: { events: EditableEvent[] }) {
  const sorted = [...events].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return (
    <section className="border border-slate-200 bg-white">
      <div className="divide-y divide-slate-100">
        {sorted.map((e) => {
          const statusLabel = getStatusInfo(e.status).label;
          return (
            <div key={e.id} className="flex items-center gap-4 px-5 py-4">
              <Link href={`/admin/events/${e.id}/schedule`} className="group flex min-w-0 flex-1 items-center gap-4">
                <span className="h-10 w-1.5 shrink-0" style={{ background: e.coverColor }} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-bold text-slate-900 group-hover:text-[#c83242]">{e.name}</p>
                    {e.status === "draft" && <span className="border border-amber-200 bg-amber-50 px-2 py-0.5 text-[0.5625rem] font-bold text-amber-700">草稿 · 未公开</span>}
                    {e.status === "archived" && <span className="border border-slate-200 px-2 py-0.5 text-[0.5625rem] font-bold text-slate-500">已归档</span>}
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">{e.game} · {e.stageSummary} · {statusLabel}</p>
                </div>
              </Link>
              <div className="flex shrink-0 items-center gap-3">
                <span className="hidden text-[0.625rem] font-semibold text-slate-400 sm:inline">打开独立工作区</span>
                <Link href={`/admin/events/${e.id}/schedule`} className="font-mono text-xs font-bold text-slate-300 transition group-hover:text-[#ff4655] hover:text-[#ff4655]">
                  →
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
