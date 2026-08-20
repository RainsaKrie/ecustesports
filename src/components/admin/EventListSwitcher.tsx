"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EditableEvent } from "@/lib/site-config-schema";
import { getStatusInfo } from "@/lib/utils";

/** 赛事列表：并列同层次，整行点击进入工作区（赛程） */
export default function EventListSwitcher({ events, currentEventId }: { events: EditableEvent[]; currentEventId: string }) {
  const router = useRouter();
  const [switching, setSwitching] = useState<string | null>(null);

  const handleSwitch = async (eventId: string) => {
    if (eventId === currentEventId || switching) return;
    setSwitching(eventId);
    try {
      const response = await fetch("/api/admin/events/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      if (!response.ok) throw new Error();
      router.refresh();
    } catch {
      setSwitching(null);
    }
  };

  const sorted = [...events].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return (
    <section className="border border-slate-200 bg-white">
      <div className="divide-y divide-slate-100">
        {sorted.map((e) => {
          const isCurrent = e.id === currentEventId;
          const statusLabel = getStatusInfo(e.status).label;
          return (
            <div key={e.id} className="flex items-center gap-4 px-5 py-4">
              <Link href={`/admin/events/${e.id}/schedule`} className="group flex min-w-0 flex-1 items-center gap-4">
                <span className="h-10 w-1.5 shrink-0" style={{ background: e.coverColor }} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-bold text-slate-900 group-hover:text-[#c83242]">{e.name}</p>
                    {isCurrent && <span className="bg-[#ff4655] px-2 py-0.5 text-[0.5625rem] font-black text-white">当前</span>}
                    {e.status === "archived" && <span className="border border-slate-200 px-2 py-0.5 text-[0.5625rem] font-bold text-slate-500">已归档</span>}
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">{e.game} · {e.stageSummary} · {statusLabel}</p>
                </div>
              </Link>
              <div className="flex shrink-0 items-center gap-3">
                {!isCurrent && (
                  <button
                    type="button"
                    onClick={() => handleSwitch(e.id)}
                    disabled={switching !== null}
                    className="text-xs font-bold text-slate-400 transition hover:text-[#c83242] disabled:opacity-50"
                  >
                    {switching === e.id ? "切换中…" : "设为当前"}
                  </button>
                )}
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
