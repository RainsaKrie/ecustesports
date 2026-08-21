"use client";

import { useState } from "react";
import { usePublicRegistration } from "@/lib/scheduling/usePublicRegistration";
import { STAGE_CONFIGS, type EventStage } from "@/lib/scheduling/stage";
import PublicSchedule from "@/components/events/PublicSchedule";
import ScheduleBracket from "@/components/events/ScheduleBracket";

const TABS = ["赛事手册", "选手名单", "队伍名单", "赛程", "对阵图"] as const;
type Tab = (typeof TABS)[number];

function Empty({ text }: { text: string }) {
  return (
    <div className="border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
      {text}
    </div>
  );
}

function RegistrationCount({ kind, count }: { kind: "player" | "team"; count: number }) {
  return (
    <div className="border border-gray-200 bg-white p-8 text-center">
      <p className="text-4xl font-black text-slate-950">{count}</p>
      <p className="mt-2 text-sm font-bold text-slate-700">{kind === "player" ? "名选手已报名" : "支队伍已申报"}</p>
      <p className="mt-3 text-xs leading-5 text-slate-400">完整名单将在赛事组审核确认后统一公开。报名信息不会直接对外展示。</p>
    </div>
  );
}

export default function EventDetailTabs({ eventId, stage, initialTab }: { eventId: string; stage: EventStage; initialTab?: string }) {
  const config = STAGE_CONFIGS[stage];
  const validInitial = TABS.includes(initialTab as Tab) ? (initialTab as Tab) : undefined;
  const [tab, setTab] = useState<Tab>(validInitial ?? (config.defaultTab as Tab) ?? "赛程");
  const { state } = usePublicRegistration(eventId);

  return (
    <div>
      {/* 红色 tab 栏：均分 */}
      <div className="mb-6 grid grid-cols-2 bg-[#ff4655] text-white md:grid-cols-5">
        {TABS.map((t, i) => {
          const isActive = tab === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex items-center justify-center gap-2 px-4 py-4 font-mono text-xs font-bold tracking-[0.12em] transition md:text-sm ${
                isActive ? "bg-black/25" : "hover:bg-black/10"
              } ${i > 0 ? "md:border-l md:border-white/20" : ""}`}
            >
              <span aria-hidden className="hidden rotate-45 border border-white/80 md:inline-block md:h-2 md:w-2" />
              {t}
            </button>
          );
        })}
      </div>

      {tab === "赛事手册" && <Empty text="赛事手册内容筹备中，敬请期待。" />}

      {tab === "选手名单" && <RegistrationCount kind="player" count={state.playerCount} />}

      {tab === "队伍名单" && <RegistrationCount kind="team" count={state.teamCount} />}

      {tab === "赛程" && <PublicSchedule eventId={eventId} />}

      {tab === "对阵图" && <ScheduleBracket eventId={eventId} />}
    </div>
  );
}
