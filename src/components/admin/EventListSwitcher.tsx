import Link from "next/link";
import type { EditableEvent } from "@/lib/site-config-schema";
import { getStatusInfo } from "@/lib/utils";

/** 赛事列表：并列同层次，整行点击进入工作区（赛程） */
export default function EventListSwitcher({ events }: { events: EditableEvent[] }) {
  const sorted = [...events].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return (
    <section className="border border-[var(--adm-line-soft)] bg-[var(--adm-surface)]">
      <div className="divide-y divide-[var(--adm-line-soft)]">
        {sorted.map((e) => {
          const statusLabel = getStatusInfo(e.status).label;
          return (
            <Link
              key={e.id}
              href={`/admin/events/${e.id}/schedule`}
              className="group flex min-h-20 items-center gap-4 px-5 py-4 transition hover:bg-[var(--adm-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--adm-red)]"
            >
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <span className="h-10 w-1.5 shrink-0" style={{ background: e.coverColor }} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[length:var(--adm-fs-lg)] font-bold text-[var(--adm-text)] group-hover:text-[var(--adm-red-text)]">{e.name}</p>
                    <span className="adm-chip" data-tone={e.visibility === "public" ? "done" : "active"}>{e.visibility === "public" ? "玩家可见" : "未公开"}</span>
                    {e.status === "archived" && <span className="adm-chip" data-tone="neutral">已归档</span>}
                  </div>
                  {/* 原来是 truncate 一行。实测内容 909px 而容器 809px —— 截掉的
                      正好是末尾的赛事状态（`· 已结束`），等于把「这届办完没有」藏了。
                      放开到两行就装得下，不必牺牲状态。 */}
                  <p className="mt-1 line-clamp-2 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">{e.game} · {e.stageSummary} · {statusLabel}</p>
                </div>
              </div>
              {/* py-3 是 rem，桌面 = 上下各 18px，把这个按钮撑到 61px，
                  上面设的 min-h-[44px] 从来没生效过（体检实测 44→61）。改 px 定值。 */}
              <span className="flex min-h-[44px] shrink-0 items-center gap-3 border border-[var(--adm-line-soft)] bg-[var(--adm-surface)] px-4 py-[8px] text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)] transition group-hover:border-[var(--adm-red)] group-hover:text-[var(--adm-red-text)] sm:min-w-40 sm:justify-between">
                <span className="hidden sm:inline">进入工作台</span>
                <span className="text-[length:var(--adm-fs-lg)] leading-none" aria-hidden="true">→</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
