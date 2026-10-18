"use client";

// =====================
// 战队档案页（2026-10-18）
//
// 官方平台都有这一层；我们缺的是"从队伍名单点进去看这支队长什么样"。
// 数据全部来自两个既有公开源：报名摘要（队名/成员/角色）+ 赛程（该队的比赛与比分）。
// **不显示 QQ / 手机号 / 学号** —— 报名摘要里本来就没有这些字段。
// =====================

import Link from "next/link";
import { use, useMemo } from "react";
import Container from "@/components/layout/Container";
import { usePublicRegistration } from "@/lib/scheduling/usePublicRegistration";
import { useSchedule } from "@/lib/scheduling/useSchedule";

const ROLE_ORDER = ["首发", "替补", "教练"] as const;

export default function TeamProfilePage({ params }: { params: Promise<{ id: string; teamId: string }> }) {
  const { id: eventId, teamId } = use(params);
  const { state: registration } = usePublicRegistration(eventId);
  const { state: schedule } = useSchedule(eventId, "public");

  const team = registration.teams.find((item) => item.id === teamId);

  const matches = useMemo(
    () => schedule.matches.filter((match) => match.teamAId === teamId || match.teamBId === teamId),
    [schedule.matches, teamId],
  );
  const finished = matches.filter((match) => match.status === "已完成");
  const wins = finished.filter((match) => match.winnerTeamId === teamId).length;

  if (!team) {
    return (
      <Container className="py-16">
        <p className="border border-[#d8d1c6] bg-[#fffdf8] px-6 py-12 text-center text-sm font-bold text-[#5b626c]">
          找不到这支队伍，可能已退赛或尚未公布。
        </p>
        <p className="mt-4 text-center text-sm">
          <Link href={`/events/${eventId}?tab=${encodeURIComponent("队伍名单")}`} className="font-bold text-[#c83242] underline">
            返回队伍名单
          </Link>
        </p>
      </Container>
    );
  }

  return (
    <Container className="py-10">
      <p className="flex items-center gap-3 font-mono text-[0.6875rem] font-black uppercase tracking-[0.2em] text-[#c83242]">
        <span aria-hidden className="block h-0.5 w-7 bg-current" />
        Team profile
      </p>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-6 border-b border-[#d8d1c6] pb-6">
        <div className="min-w-0">
          <h1 className="text-4xl font-black leading-none tracking-[-0.03em] text-[#171a1f] sm:text-5xl">{team.name}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs tracking-[0.06em] text-[#4d5259]">
            <span>{team.status}</span>
            <span>首发 {team.starterCount} / 5</span>
            <span>{finished.length} 场已赛 · {wins} 胜</span>
          </p>
        </div>
        <Link
          href={`/events/${eventId}?tab=${encodeURIComponent("队伍名单")}`}
          className="border border-[#171a1f] px-4 py-2 text-xs font-black text-[#171a1f] transition hover:bg-[#171a1f] hover:text-white"
        >
          返回队伍名单
        </Link>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section>
          <h2 className="flex items-baseline justify-between border-b-2 border-[#171a1f] pb-2">
            <span className="text-lg font-black text-[#171a1f]">参赛阵容</span>
            <span className="font-mono text-[0.6875rem] tracking-[0.14em] text-[#5b626c]">ROSTER</span>
          </h2>
          <div className="mt-4 space-y-3">
            {ROLE_ORDER.map((role) => {
              const members = team.members.filter((member) => member.role === role);
              const slotText = { 首发: "01–05", 替补: "06", 教练: "07" }[role];
              return (
                <div key={role} className="flex items-baseline gap-4 border-b border-[#e7e1d7] pb-3">
                  <span className="w-10 shrink-0 font-mono text-[0.6875rem] font-black tracking-[0.1em] text-[#8b929c]">{slotText}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.6875rem] font-black tracking-[0.12em] text-[#5b626c]">{role}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm font-bold text-[#171a1f]">
                      {members.length > 0 ? members.map((member) => <span key={member.gameId}>{member.gameId}</span>) : <span className="text-[#8b929c]">未提交</span>}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[0.6875rem] text-[#8b929c]">{members.length} 人</span>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="flex items-baseline justify-between border-b-2 border-[#171a1f] pb-2">
            <span className="text-lg font-black text-[#171a1f]">比赛记录</span>
            <span className="font-mono text-[0.6875rem] tracking-[0.14em] text-[#5b626c]">MATCHES</span>
          </h2>
          {matches.length === 0 ? (
            <p className="mt-4 border border-dashed border-[#d8d1c6] px-5 py-10 text-center text-sm text-[#5b626c]">
              还没有安排到这支队伍的比赛
            </p>
          ) : (
            <div className="mt-4 border border-[#d8d1c6] bg-[#fffdf8]">
              {matches.map((match) => {
                const isHome = match.teamAId === teamId;
                const opponent = isHome ? match.teamBName : match.teamAName;
                const won = match.winnerTeamId === teamId;
                const done = match.status === "已完成";
                return (
                  <div key={match.id} className="flex items-center justify-between gap-4 border-b border-[#e7e1d7] px-4 py-3 last:border-b-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[#171a1f]">
                        <span className="font-mono text-[0.625rem] font-black text-[#8b929c]">{match.id}</span>
                        <span className="mx-2 text-[0.6875rem] font-normal text-[#8b929c]">VS</span>
                        {opponent}
                      </p>
                      <p className="mt-1 font-mono text-[0.6875rem] tracking-[0.04em] text-[#5b626c]">
                        {match.phase} · {match.boType} · {match.startTime ? match.startTime.slice(5, 16).replace("T", " ") : "待安排"}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 font-mono text-lg font-black ${done ? (won ? "text-[#c83242]" : "text-[#5b626c]") : "text-[#8b929c]"}`}
                    >
                      {done ? (won ? "胜" : "负") : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </Container>
  );
}
