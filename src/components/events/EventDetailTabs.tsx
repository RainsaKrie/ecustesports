"use client";

import { useState } from "react";
import { useRegistration } from "@/lib/scheduling/useRegistration";
import { STAGE_CONFIGS, type EventStage } from "@/lib/scheduling/stage";
import type { RegistrationPlayer, RegistrationTeam } from "@/lib/scheduling/registration-data";
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

function TeamList({ teams, players }: { teams: RegistrationTeam[]; players: RegistrationPlayer[] }) {
  const visible = teams.filter((t) => t.status !== "已退赛");
  if (visible.length === 0) return <Empty text="暂无队伍，报名后在这里查看参赛队伍。" />;
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {visible.map((team) => {
        const members = players.filter((p) => p.teamId === team.id);
        const starters = members.filter((p) => p.role === "首发").length;
        const subs = members.filter((p) => p.role === "替补").length;
        const coach = members.filter((p) => p.role === "教练").length;
        return (
          <div key={team.id} className="border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate text-base font-bold text-gray-900">{team.name}</h3>
              <span className="shrink-0 bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">{team.status}</span>
            </div>
            <p className="mt-2 text-sm text-gray-500">
              首发 {starters}/5 · 替补 {subs} · 教练 {coach}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function PlayerList({ players }: { players: RegistrationPlayer[] }) {
  const visible = players.filter((p) => p.status !== "已退赛");
  if (visible.length === 0) return <Empty text="暂无选手，报名后在这里查看选手列表。" />;
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {visible.map((p) => (
        <div key={p.id} className="flex items-center justify-between border border-gray-200 bg-white p-4">
          <div>
            <p className="text-sm font-bold text-gray-900">{p.gameId}</p>
            <p className="mt-1 text-xs text-gray-500">{p.rank}</p>
          </div>
          <span className="text-xs text-gray-400">{p.teamId ? "已入队" : "待组队"}</span>
        </div>
      ))}
    </div>
  );
}

export default function EventDetailTabs({ eventId, stage, initialTab }: { eventId: string; stage: EventStage; initialTab?: string }) {
  const config = STAGE_CONFIGS[stage];
  const validInitial = TABS.includes(initialTab as Tab) ? (initialTab as Tab) : undefined;
  const [tab, setTab] = useState<Tab>(validInitial ?? (config.defaultTab as Tab) ?? "赛程");
  const { state } = useRegistration(eventId);

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

      {tab === "选手名单" && <PlayerList players={state.players} />}

      {tab === "队伍名单" && <TeamList teams={state.teams} players={state.players} />}

      {tab === "赛程" && <PublicSchedule eventId={eventId} />}

      {tab === "对阵图" && <ScheduleBracket eventId={eventId} />}
    </div>
  );
}
