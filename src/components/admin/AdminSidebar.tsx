"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { getLifecycleStages, stateTones, type ModuleWithState, type StageGuidance } from "@/lib/operations-data";
import type { EditableEvent } from "@/lib/site-config-schema";
import type { EventStage } from "@/lib/scheduling/stage";
import { useAdminConfirm } from "@/components/admin/ui";

interface AdminSidebarProps {
  event: EditableEvent;
  stage: EventStage;
  modules: ModuleWithState[];
  guidance: StageGuidance;
}

function StageStatusPanel({ stage, guidance, eventId }: { stage: EventStage; guidance: StageGuidance; eventId: string }) {
  const router = useRouter();
  const confirm = useAdminConfirm();
  const [transitioning, setTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState("");
  const lifecycle = getLifecycleStages(stage);
  const visibleBlockers = guidance.blockers.slice(0, 3);

  async function runStageTransition(action: NonNullable<StageGuidance["actionKind"]>) {
    const copy: Record<NonNullable<StageGuidance["actionKind"]>, { title: string; body: string; label: string; tone: "default" | "danger" }> = {
      "open-registration": {
        title: "进入报名阶段？",
        body: "进入报名阶段后，玩家将按照当前报名时间与规则提交参赛信息。",
        label: "进入报名阶段",
        tone: "default",
      },
      "close-registration": {
        title: "结束报名并进入分组？",
        body: "结束后将停止新报名与名单调整，并进入分组抽签阶段。这一步会影响所有未确认的队伍。",
        label: "结束报名",
        tone: "danger",
      },
      "complete-event": {
        title: "结束赛事？",
        body: "结束后玩家侧将进入赛后状态。请在确认全部赛果已经核验后再继续。",
        label: "结束赛事",
        tone: "danger",
      },
    };
    const confirmed = await confirm({
      title: copy[action].title,
      body: copy[action].body,
      confirmLabel: copy[action].label,
      tone: copy[action].tone,
    });
    if (!confirmed) return;
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
    <section className="border border-[var(--adm-line)] bg-[var(--adm-surface-3)]" aria-label="当前赛事阶段与下一步">
      {/* py-3 是 rem，桌面根字号下 = 上下各 18px，把这一条撑到 67px ——
          上一行刚设的 min-h-[44px] 根本没机会起作用（实测 67px）。
          改成 px 定值后高度由 min-h 兜底，实测落到 44px。 */}
      <div className="flex min-h-[44px] items-center justify-between gap-2 border-b border-[var(--adm-line)] px-4 py-[6px]">
        <p className="text-[length:var(--adm-fs-xs)] font-medium tracking-[0.16em] text-[var(--adm-text-soft)]">赛事阶段</p>
        <span className="bg-[var(--adm-red)] px-2 py-1 text-[length:var(--adm-fs-xs)] font-semibold text-white">{guidance.label}</span>
      </div>
      <ol className="grid grid-cols-5 border-b border-[var(--adm-line)] bg-[var(--adm-surface)]" aria-label="赛事生命周期">
        {lifecycle.map((item) => (
          <li key={item.label} className="min-w-0 border-r border-[var(--adm-line-soft)] px-1 py-3 text-center last:border-r-0">
            <span className={`mx-auto mb-2 block h-1 w-7 max-w-full ${item.state === "active" ? "bg-[var(--adm-red)]" : item.state === "done" ? "bg-[var(--adm-text)]" : "bg-[var(--adm-line)]"}`} aria-hidden />
            <span className={`block text-[length:var(--adm-fs-xs)] font-semibold ${item.state === "active" ? "text-[var(--adm-red-text)]" : item.state === "done" ? "text-[var(--adm-text-soft)]" : "text-[var(--adm-text-mute)]"}`}>{item.label}</span>
          </li>
        ))}
      </ol>
      <div className="p-4">
        <p className="text-[length:var(--adm-fs-xs)] font-medium tracking-[0.14em] text-[var(--adm-text-mute)]">阶段目标</p>
        <p className="mt-2 text-[length:var(--adm-fs-sm)] font-semibold leading-relaxed text-[var(--adm-text)]">{guidance.objective}</p>
        {visibleBlockers.length > 0 && (
          <div className="mt-4 border-t border-[var(--adm-line)] pt-3">
            <p className="text-[length:var(--adm-fs-xs)] font-semibold text-[var(--adm-red-text)]">待完成事项</p>
            <ul className="mt-2 space-y-1.5 text-[length:var(--adm-fs-xs)] font-medium leading-relaxed text-[var(--adm-text-soft)]">
              {visibleBlockers.map((blocker) => <li key={blocker} className="flex gap-2"><span className="text-[var(--adm-red)]">—</span><span>{blocker}</span></li>)}
            </ul>
            {guidance.blockers.length > visibleBlockers.length && <p className="mt-2 text-[length:var(--adm-fs-xs)] font-bold text-[var(--adm-text-soft)]">其余待处理事项：{guidance.blockers.length - visibleBlockers.length} 项</p>}
          </div>
        )}
        {guidance.actionKind ? (
          <button type="button" onClick={() => runStageTransition(guidance.actionKind!)} disabled={transitioning} className="adm-btn adm-btn--primary adm-btn--md mt-4 w-full justify-between text-left hover:bg-[var(--adm-red-hover)]">
            <span>{transitioning ? transitionLabels[guidance.actionKind] : guidance.actionLabel}</span><span aria-hidden>→</span>
          </button>
        ) : (
          <Link href={guidance.actionHref} className="adm-btn adm-btn--primary adm-btn--md mt-4 justify-between hover:bg-[var(--adm-red-hover)]">
            <span>{guidance.actionLabel}</span><span aria-hidden>→</span>
          </Link>
        )}
        {transitionError && <p className="mt-2 text-[length:var(--adm-fs-xs)] font-bold leading-relaxed text-[var(--adm-red-text)]" role="alert">{transitionError}</p>}
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
        // 间距全部用 px 定值：原来 px-3 / gap-3 在桌面根字号下是 18px，两个 gap 加两侧
        // padding 吃掉 72px，把「报名与队伍」压到只剩 4px 宽（实测 clientWidth=4）。
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`group flex items-center gap-[6px] border-l-2 px-[10px] py-2.5 text-[length:var(--adm-fs-sm)] transition ${active ? "border-l-[var(--adm-red)] bg-[var(--adm-red-soft)] font-semibold text-[var(--adm-text)]" : "border-l-transparent text-[var(--adm-text-soft)] hover:bg-[var(--adm-surface-2)] hover:text-[var(--adm-text)]"}`}
          >
            <span className={`shrink-0 text-[length:var(--adm-fs-xs)] font-semibold tabular-nums tracking-[0.08em] ${active ? "text-[var(--adm-red-text)]" : "text-[var(--adm-text-mute)]"}`}>{item.number}</span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="adm-chip" data-tone={stateTones[item.state]}>{item.stateLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default function AdminSidebar({ event, stage, modules, guidance }: AdminSidebarProps) {
  return (
    <>
      <aside className="hidden w-[240px] shrink-0 border-r border-[var(--adm-line-soft)] bg-white lg:block">
        {/* top-16 是 rem，桌面 = 96px；而顶栏上一批已改成 64px 定值 —— 用 rem 会让侧边栏
            比顶栏矮 32px，顶部空一条。max-h 里的 4rem 同理。两处都改 px 定值。 */}
        <div className="sticky top-[64px] max-h-[calc(100vh-64px)] overflow-y-auto px-[12px] py-5">
          {/* 返回赛事列表（明显入口） */}
          <Link href="/admin" className="adm-btn adm-btn--ghost adm-btn--sm mb-4 hover:text-[var(--adm-red-text)]">
            <span className="border border-[var(--adm-line)] px-1.5 py-0.5 text-[length:var(--adm-fs-xs)]" aria-hidden="true">←</span>
            返回赛事列表
          </Link>

          {/* 当前赛事 */}
          <div className="mb-4">
            <p className="text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text)]">{event.name}</p>
            <p className="mt-1 text-[length:var(--adm-fs-xs)] text-[var(--adm-text-mute)]">{event.game}</p>
          </div>

          <div className="mb-5"><StageStatusPanel stage={stage} guidance={guidance} eventId={event.id} /></div>

          <p className="mb-2 px-3 text-[length:var(--adm-fs-xs)] font-medium tracking-[0.14em] text-[var(--adm-text-mute)]">赛事工作区</p>
          <NavLinks eventId={event.id} modules={modules} />

        </div>
      </aside>

      <div className="border-b border-[var(--adm-line-soft)] bg-white px-4 py-3 lg:hidden">
        <details>
          <summary className="flex cursor-pointer list-none items-center justify-between text-[length:var(--adm-fs-sm)] font-bold text-[var(--adm-text)]">
            <span>{event.name} · {guidance.label}</span>
            <span className="text-[var(--adm-red)]">菜单</span>
          </summary>
          <div className="mt-3 space-y-3 border-t border-[var(--adm-line-soft)] pt-3"><StageStatusPanel stage={stage} guidance={guidance} eventId={event.id} /><NavLinks eventId={event.id} modules={modules} /></div>
        </details>
      </div>
    </>
  );
}
