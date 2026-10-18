"use client";

import StatusChip from "@/components/events/StatusChip";

import Link from "next/link";

import { useState } from "react";
import EventHandbook, { type HandbookEvent } from "@/components/events/EventHandbook";
import PublicSchedule from "@/components/events/PublicSchedule";
import ScheduleBracket from "@/components/events/ScheduleBracket";
import { usePublicRegistration, type PublicRegistrationSummary } from "@/lib/scheduling/usePublicRegistration";
import { STAGE_CONFIGS, type EventStage } from "@/lib/scheduling/stage";

const TABS = ["赛事手册", "选手名单", "队伍名单", "赛程", "对阵图"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  赛事手册: "竞赛规程",
  选手名单: "参赛选手",
  队伍名单: "参赛队伍",
  赛程: "赛事赛程",
  对阵图: "赛事对阵",
};

function PlayerList({ players }: { players: PublicRegistrationSummary["players"] }) {
  return (
    <section className="border border-black/10 bg-[#fffdf8]">
      <header className="flex items-center justify-between border-b border-black/10 px-5 py-3">
        <h2 className="text-base font-black text-[#171a1f]">参赛选手</h2>
        <span className="font-mono text-[0.625rem] font-black text-[#c83242]">{players.length} PLAYERS</span>
      </header>
      {players.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm font-bold text-[#5b626c]">暂无参赛选手</p>
      ) : (
        <div>
          <div className="hidden grid-cols-[2.5rem_minmax(0,1.3fr)_0.8fr_minmax(0,1fr)_0.7fr] gap-3 border-b border-black/10 bg-[#f2eee6] px-5 py-2 text-[0.625rem] font-black text-[#5b626c] md:grid">
            <span>#</span><span>游戏 ID</span><span>段位</span><span>队伍</span><span>状态</span>
          </div>
          {players.map((player, index) => (
            <div key={player.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-black/10 px-4 py-2 last:border-b-0 md:grid-cols-[2.5rem_minmax(0,1.3fr)_0.8fr_minmax(0,1fr)_0.7fr] md:px-5 md:gap-3">
              <span className="hidden font-mono text-[0.625rem] font-black text-[#8b929c] md:block">{String(index + 1).padStart(2, "0")}</span>
              <strong className="min-w-0 truncate text-xs text-[#171a1f]">{player.gameId}</strong>
              <span className="hidden text-xs font-semibold text-[#2b3038] md:block">{player.rank}</span>
              <span className="hidden text-xs font-semibold text-[#2b3038] md:block">{player.teamName ?? "—"}{player.role ? ` · ${player.role}` : ""}</span>
              <StatusChip tone="accent">{player.status}</StatusChip>
              <span className="col-span-2 min-w-0 truncate text-[0.6875rem] font-semibold text-[#5b626c] md:hidden">{player.rank} · {player.teamName ?? "未组队"}{player.role ? ` · ${player.role}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}


function TeamList({ teams, eventId }: { teams: PublicRegistrationSummary["teams"]; eventId: string }) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-4 border-b border-[#d8d1c6] pb-2">
        <div>
          <p className="font-mono text-[0.625rem] font-black uppercase tracking-[0.18em] text-[#c83242]">Teams</p>
          <h2 className="mt-1 text-[1.375rem] font-black tracking-[-0.01em] text-[#171a1f]">参赛队伍</h2>
        </div>
        <span className="font-mono text-[0.6875rem] font-black text-[#8b929c]">{teams.length} 支</span>
      </div>

      {teams.length === 0 ? (
        <p className="border border-dashed border-[#d8d1c6] px-5 py-12 text-center text-sm font-bold text-[#5b626c]">暂无参赛队伍</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {teams.map((team, index) => {
            const starters = team.members.filter((member) => member.role === "首发");
            const substitute = team.members.find((member) => member.role === "替补");
            const coach = team.members.find((member) => member.role === "教练");
            // 七个点位：5 首发 + 1 替补 + 1 教练 —— 有人的填实，缺的留空
            const slots = [
              ...Array.from({ length: 5 }, (_, i) => Boolean(starters[i])),
              Boolean(substitute),
              Boolean(coach),
            ];
            const complete = starters.length >= 5;
            return (
              <Link
                key={team.id}
                href={`/events/${eventId}/teams/${team.id}`}
                className="group relative block bg-[#fffdf8] p-4 ring-1 ring-[#d8d1c6] transition duration-150 hover:ring-[#171a1f]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-9 w-9 flex-none place-items-center bg-[#171a1f] font-mono text-sm font-black text-[#fffdf8]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[0.9375rem] font-black text-[#171a1f] group-hover:text-[#c83242]">{team.name}</p>
                      <p className="mt-0.5 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-[#8b929c]">
                        {complete ? "Roster complete" : `首发 ${starters.length}/5`}
                      </p>
                    </div>
                  </div>
                  <StatusChip tone={complete ? "neutral" : "accent"}>{team.status}</StatusChip>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1" aria-label={`阵容 ${starters.length + (substitute ? 1 : 0) + (coach ? 1 : 0)}/7`}>
                    {slots.map((filled, i) => (
                      <span
                        key={i}
                        className={`h-1.5 w-4 ${filled ? (i < 5 ? "bg-[#171a1f]" : "bg-[#8b929c]") : "bg-[#e7e1d7]"}`}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[0.625rem] font-black tracking-[0.06em] text-[#8b929c]">
                    {starters.length + (substitute ? 1 : 0) + (coach ? 1 : 0)} / 7
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function EventDetailTabs({
  eventId,
  stage,
  event,
  initialTab,
  preview = false,
}: {
  eventId: string;
  stage: EventStage;
  event: HandbookEvent;
  initialTab?: string;
  preview?: boolean;
}) {
  const config = STAGE_CONFIGS[stage];
  const validInitial = TABS.includes(initialTab as Tab) ? (initialTab as Tab) : undefined;
  const defaultTab = (config.defaultTab as Tab) ?? "赛程";
  const [tab, setTab] = useState<Tab>(validInitial ?? defaultTab);
  const { state } = usePublicRegistration(eventId, preview);

  return (
    <div id="event-content" className="scroll-mt-24">
      <div className="mb-0 overflow-hidden border-y border-black/10 bg-[#f2eee6] sm:overflow-x-auto">
        <div role="tablist" aria-label="赛事资料" className="mx-auto grid w-full grid-cols-5 sm:flex sm:min-w-max sm:justify-center">
          {TABS.map((item) => {
            const isActive = tab === item;
            return (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTab(item)}
                className={`relative min-h-14 min-w-0 border-b-[3px] px-1.5 py-4 text-[0.6875rem] font-black transition sm:shrink-0 sm:px-8 sm:text-xs ${
                  isActive
                    ? "border-[#ff4655] bg-[#fffdf8] text-[#171a1f]"
                    : "border-transparent text-[#5b626c] hover:bg-black/[0.04] hover:text-[#171a1f]"
                }`}
              >
                {TAB_LABELS[item]}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "赛事手册" && <EventHandbook event={event} />}
      {tab === "选手名单" && <PlayerList players={state.players} />}
      {tab === "队伍名单" && <TeamList teams={state.teams} eventId={eventId} />}
      {tab === "赛程" && <PublicSchedule eventId={eventId} preview={preview} />}
      {tab === "对阵图" && <ScheduleBracket eventId={eventId} preview={preview} />}
    </div>
  );
}
