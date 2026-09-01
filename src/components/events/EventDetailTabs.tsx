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
            <div key={player.id} className="grid gap-1.5 border-b border-black/10 px-5 py-2 last:border-b-0 md:grid-cols-[2.5rem_minmax(0,1.3fr)_0.8fr_minmax(0,1fr)_0.7fr] md:items-center md:gap-3">
              <span className="hidden font-mono text-[0.625rem] font-black text-[#96918a] md:block">{String(index + 1).padStart(2, "0")}</span>
              <strong className="text-xs text-[#171a1f]">{player.gameId}</strong>
              <span className="text-xs font-semibold text-[#34383f]">{player.rank}</span>
              <span className="text-xs font-semibold text-[#34383f]">{player.teamName ?? "—"}{player.role ? ` · ${player.role}` : ""}</span>
              <span className="w-fit border border-[#ff4655]/40 px-1.5 py-0.5 text-[0.625rem] font-black text-[#c83242]">{player.status}</span>
            </div>
          ))}
        </div>
      )}
    </section>
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
              <div key={team.id} className="grid gap-1.5 border-b border-black/10 px-5 py-2 last:border-b-0 md:grid-cols-[2.5rem_minmax(0,0.9fr)_minmax(0,3.4fr)_0.6fr] md:items-center md:gap-3">
                <span className="hidden font-mono text-[0.625rem] font-black text-[#96918a] md:block">{String(index + 1).padStart(2, "0")}</span>
                <strong className="text-xs text-[#171a1f]">{team.name}</strong>
                <div className="grid gap-1 text-[0.6875rem] leading-4 text-[#34383f] lg:grid-cols-[minmax(0,3fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] lg:gap-3">
                  <p className="font-semibold"><span className="mr-1.5 font-black text-[#60656d]">首发 {starters.length}/5</span>{starters.map((member) => member.gameId).join("、") || "空缺"}</p>
                  <p className="font-semibold"><span className="mr-1.5 font-black text-[#60656d]">替补 {substitute ? "1/1" : "0/1"}</span>{substitute?.gameId ?? "空缺"}</p>
                  <p className="font-semibold"><span className="mr-1.5 font-black text-[#60656d]">教练 {coach ? "1/1" : "0/1"}</span>{coach?.gameId ?? "空缺"}</p>
                </div>
                <span className="w-fit border border-[#ff4655]/40 px-1.5 py-0.5 text-[0.625rem] font-black text-[#c83242]">{team.status}</span>
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
