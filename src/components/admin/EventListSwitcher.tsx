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
            <Link
              key={e.id}
              href={`/admin/events/${e.id}/schedule`}
              className="group flex min-h-20 items-center gap-4 px-5 py-4 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#ff4655]"
            >
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <span className="h-10 w-1.5 shrink-0" style={{ background: e.coverColor }} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-bold text-slate-900 group-hover:text-[#c83242]">{e.name}</p>
                    <span className={`border px-2 py-0.5 text-[0.5625rem] font-bold ${e.visibility === "public" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{e.visibility === "public" ? "玩家可见" : "未公开"}</span>
                    {e.status === "archived" && <span className="border border-slate-200 px-2 py-0.5 text-[0.5625rem] font-bold text-slate-500">已归档</span>}
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">{e.game} · {e.stageSummary} · {statusLabel}</p>
                </div>
              </div>
              <span className="flex min-h-12 shrink-0 items-center gap-3 border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-600 transition group-hover:border-[#ff4655] group-hover:text-[#c83242] sm:min-w-40 sm:justify-between">
                <span className="hidden sm:inline">进入工作台</span>
                <span className="font-mono text-base leading-none" aria-hidden="true">→</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
