"use client";

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
        <p className="px-5 py-10 text-center text-sm font-bold text-[#60656d]">暂无参赛选手</p>
      ) : (
        <div>
          <div className="hidden grid-cols-[2.5rem_minmax(0,1.3fr)_0.8fr_minmax(0,1fr)_0.7fr] gap-3 border-b border-black/10 bg-[#f2eee6] px-5 py-2 text-[0.625rem] font-black text-[#60656d] md:grid">
            <span>#</span><span>游戏 ID</span><span>段位</span><span>队伍</span><span>状态</span>
          </div>
          {players.map((player, index) => (
            <div key={player.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-black/10 px-4 py-2 last:border-b-0 md:grid-cols-[2.5rem_minmax(0,1.3fr)_0.8fr_minmax(0,1fr)_0.7fr] md:px-5 md:gap-3">
              <span className="hidden font-mono text-[0.625rem] font-black text-[#96918a] md:block">{String(index + 1).padStart(2, "0")}</span>
              <strong className="min-w-0 truncate text-xs text-[#171a1f]">{player.gameId}</strong>
              <span className="hidden text-xs font-semibold text-[#34383f] md:block">{player.rank}</span>
              <span className="hidden text-xs font-semibold text-[#34383f] md:block">{player.teamName ?? "—"}{player.role ? ` · ${player.role}` : ""}</span>
              <span className="w-fit border border-[#ff4655]/40 px-1.5 py-0.5 text-[0.625rem] font-black text-[#c83242]">{player.status}</span>
              <span className="col-span-2 min-w-0 truncate text-[0.6875rem] font-semibold text-[#60656d] md:hidden">{player.rank} · {player.teamName ?? "未组队"}{player.role ? ` · ${player.role}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RosterLine({ role, members, limit }: { role: string; members: Array<{ gameId: string }>; limit: number }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-8 shrink-0 pt-[3px] text-[0.625rem] font-black text-[#60656d]">{role}</span>
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: limit }, (_, index) => {
          const member = members[index];
          return member ? (
            <span key={member.gameId} className="max-w-[10rem] truncate whitespace-nowrap border border-black/10 bg-white px-1.5 py-[3px] text-[0.625rem] font-semibold leading-none text-[#34383f]">{member.gameId}</span>
          ) : (
            <span key={`${role}-空缺-${index}`} className="whitespace-nowrap border border-dashed border-black/15 px-1.5 py-[3px] text-[0.625rem] leading-none text-[#96918a]">空缺</span>
          );
        })}
      </div>
    </div>
  );
}

function TeamList({ teams }: { teams: PublicRegistrationSummary["teams"] }) {
  return (
    <section className="border border-black/10 bg-[#fffdf8]">
      <header className="flex items-center justify-between border-b border-black/10 px-5 py-3">
        <h2 className="text-base font-black text-[#171a1f]">参赛队伍</h2>
        <span className="font-mono text-[0.625rem] font-black text-[#c83242]">{teams.length} TEAMS</span>
      </header>
      {teams.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm font-bold text-[#60656d]">暂无参赛队伍</p>
      ) : (
        <div>
          <div className="hidden grid-cols-[2.5rem_minmax(0,0.9fr)_minmax(0,3.4fr)_0.6fr] gap-3 border-b border-black/10 bg-[#f2eee6] px-5 py-2 text-[0.625rem] font-black text-[#60656d] md:grid">
            <span>#</span><span>队伍</span><span>参赛阵容</span><span>状态</span>
          </div>
          {teams.map((team, index) => {
            const starters = team.members.filter((member) => member.role === "首发");
            const substitute = team.members.find((member) => member.role === "替补");
            const coach = team.members.find((member) => member.role === "教练");
            return (
              <div key={team.id} className="border-b border-black/10 last:border-b-0">
                <details className="group md:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
                    <div className="min-w-0">
                      <strong className="block truncate text-xs text-[#171a1f]">{team.name}</strong>
                      <p className="mt-1 text-[0.6875rem] font-semibold text-[#60656d]">首发 {starters.length}/5 · 替补 {substitute ? "1/1" : "0/1"} · 教练 {coach ? "1/1" : "0/1"}</p>
                    </div>
                    <span className="shrink-0 border border-[#ff4655]/40 px-1.5 py-0.5 text-[0.625rem] font-black text-[#c83242]">{team.status}</span>
                  </summary>
                  <div className="space-y-1.5 border-t border-black/5 bg-black/[0.02] px-4 py-2.5">
                    <RosterLine role="首发" members={starters} limit={5} />
                    <RosterLine role="替补" members={substitute ? [substitute] : []} limit={1} />
                    <RosterLine role="教练" members={coach ? [coach] : []} limit={1} />
                  </div>
                </details>
                <div className="hidden gap-1.5 px-5 py-2.5 md:grid md:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,3.4fr)_0.6fr] md:items-start md:gap-3">
                  <span className="font-mono text-[0.625rem] font-black text-[#96918a]">{String(index + 1).padStart(2, "0")}</span>
                  <strong className="pt-[3px] text-xs text-[#171a1f]">{team.name}</strong>
                  <div className="space-y-1.5">
                    <RosterLine role="首发" members={starters} limit={5} />
                    <RosterLine role="替补" members={substitute ? [substitute] : []} limit={1} />
                    <RosterLine role="教练" members={coach ? [coach] : []} limit={1} />
                  </div>
                  <span className="w-fit border border-[#ff4655]/40 px-1.5 py-0.5 text-[0.625rem] font-black text-[#c83242]">{team.status}</span>
                </div>
              </div>
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
                    : "border-transparent text-[#60656d] hover:bg-black/[0.04] hover:text-[#171a1f]"
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
      {tab === "队伍名单" && <TeamList teams={state.teams} />}
      {tab === "赛程" && <PublicSchedule eventId={eventId} preview={preview} />}
      {tab === "对阵图" && <ScheduleBracket eventId={eventId} preview={preview} />}
    </div>
  );
}
