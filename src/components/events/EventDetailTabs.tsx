"use client";

import StatusChip from "@/components/events/StatusChip";
import TeamModal from "@/components/events/TeamModal";


import { useState } from "react";
import EventHandbook, { type HandbookEvent } from "@/components/events/EventHandbook";
import PublicSchedule from "@/components/events/PublicSchedule";
import ScheduleBracket from "@/components/events/ScheduleBracket";
import { usePublicRegistration, type PublicRegistrationSummary } from "@/hooks/usePublicRegistration";
import { STAGE_CONFIGS, type EventStage } from "@/lib/domains/schedule/stage";

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
    <section className="border border-[var(--pub-line-soft)] bg-[var(--pub-card)]">
      <header className="flex items-center justify-between border-b border-[var(--pub-line-soft)] px-5 py-3">
        <h2 className="text-base font-black text-[var(--pub-txt)]">参赛选手</h2>
        <span className="font-mono text-[length:var(--pub-fs-xs)] font-black text-[var(--pub-red)]">{players.length} PLAYERS</span>
      </header>
      {players.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm font-bold text-[var(--pub-txt-soft)]">暂无参赛选手</p>
      ) : (
        <div>
          <div className="hidden grid-cols-[2.5rem_minmax(0,1.3fr)_0.8fr_minmax(0,1fr)_0.7fr] gap-3 border-b border-[var(--pub-line-soft)] bg-white/[0.06] px-5 py-2 text-[length:var(--pub-fs-xs)] font-black text-[var(--pub-txt-soft)] md:grid">
            <span>#</span><span>游戏 ID</span><span>段位</span><span>队伍</span><span>状态</span>
          </div>
          {players.map((player, index) => (
            <div key={player.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-[var(--pub-line-soft)] px-4 py-2 last:border-b-0 md:grid-cols-[2.5rem_minmax(0,1.3fr)_0.8fr_minmax(0,1fr)_0.7fr] md:px-5 md:gap-3">
              <span className="hidden font-mono text-[length:var(--pub-fs-xs)] font-black text-[var(--pub-txt-mute)] md:block">{String(index + 1).padStart(2, "0")}</span>
              <strong className="min-w-0 truncate text-xs text-[var(--pub-txt)]">{player.gameId}</strong>
              <span className="hidden text-xs font-semibold text-[var(--pub-txt-soft)] md:block">{player.rank}</span>
              <span className="hidden text-xs font-semibold text-[var(--pub-txt-soft)] md:block">{player.teamName ?? "—"}{player.role ? ` · ${player.role}` : ""}</span>
              <StatusChip tone="accent">{player.status}</StatusChip>
              <span className="col-span-2 min-w-0 truncate text-[length:var(--pub-fs-xs)] font-semibold text-[var(--pub-txt-soft)] md:hidden">{player.rank} · {player.teamName ?? "未组队"}{player.role ? ` · ${player.role}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}


function TeamList({ teams, eventId }: { teams: PublicRegistrationSummary["teams"]; eventId: string }) {
  const [picked, setPicked] = useState<PublicRegistrationSummary["teams"][number] | null>(null);
  return (
    <section>
      <div className="ui-sec ui-sec--tight">
        <h2>参赛队伍</h2>
        <span>{teams.length} 支</span>
      </div>

      {teams.length === 0 ? (
        <p className="border border-dashed border-[var(--pub-line)] px-5 py-12 text-center text-sm font-bold text-[var(--pub-txt-soft)]">暂无参赛队伍</p>
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
              <button
                key={team.id}
                type="button"
                onClick={() => setPicked(team)}
                className="group relative block bg-[var(--pub-card)] p-4 ring-1 ring-[var(--pub-line)] transition duration-150 hover:ring-[var(--pub-txt)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-9 w-9 flex-none place-items-center bg-white/[0.12] font-mono text-sm font-black text-[var(--pub-txt)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[length:var(--pub-fs-md)] font-black text-[var(--pub-txt)] group-hover:text-[var(--pub-red)]">{team.name}</p>
                      <p className="mt-0.5 font-mono text-[length:var(--pub-fs-xs)] uppercase tracking-[0.12em] text-[var(--pub-txt-mute)]">
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
                        className={`h-1.5 w-4 ${filled ? (i < 5 ? "bg-[var(--pub-txt)]" : "bg-[var(--pub-txt-mute)]") : "bg-[var(--pub-line-soft)]"}`}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[length:var(--pub-fs-xs)] font-black tracking-[0.06em] text-[var(--pub-txt-mute)]">
                    {starters.length + (substitute ? 1 : 0) + (coach ? 1 : 0)} / 7
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {picked && <TeamModal team={picked} eventId={eventId} onClose={() => setPicked(null)} />}
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
      <div className="overflow-x-auto">
        <div role="tablist" aria-label="赛事资料" className="ui-toggle ui-toggle--full min-w-max">
          {TABS.map((item) => {
            const isActive = tab === item;
            return (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTab(item)}
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
