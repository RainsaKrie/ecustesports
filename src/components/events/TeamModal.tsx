"use client";

// =====================
// 队伍信息弹窗（2026-10-18）
//
// 原先是独立页面 `/events/{id}/teams/{teamId}` —— 负责人反馈"太重"：
// 为了这点信息开一个二级页面不值得。改成弹窗，从队伍卡直接浮出，页面不跳转。
//
// 公开面没有现成的弹窗组件（AdminModal 是管理端语言），所以这里做一个最小的：
// 遮罩 + 面板 + Esc 关闭 + 点遮罩关闭 + 打开时锁滚动。
// =====================

import { useEffect } from "react";
import { useSchedule } from "@/hooks/useSchedule";
import StatusChip from "@/components/events/StatusChip";

type Team = {
  id: string;
  name: string;
  status: "报名中" | "已冻结";
  starterCount: number;
  members: Array<{ gameId: string; role: "首发" | "替补" | "教练" }>;
};

const ROLE_ROWS = [
  { role: "首发" as const, label: "首发", range: "01–05" },
  { role: "替补" as const, label: "替补", range: "06" },
  { role: "教练" as const, label: "教练", range: "07" },
];

export default function TeamModal({ team, eventId, onClose }: { team: Team; eventId: string; onClose: () => void }) {
  const { state: schedule } = useSchedule(eventId, "public");

  const matches = schedule.matches.filter((m) => m.teamAId === team.id || m.teamBId === team.id);
  const finished = matches.filter((m) => m.status === "已完成");
  // 选手最常问的是"我下一场什么时候、打谁" —— 未完成的比赛里按时间取最早一场。
  // 没有时间的（待约期）排在有时间的后面，而不是排在最前。
  const next = matches
    .filter((m) => m.status !== "已完成")
    .slice()
    .sort((a, b) => {
      const ta = a.startTime ? new Date(a.startTime).getTime() : Number.MAX_SAFE_INTEGER;
      const tb = b.startTime ? new Date(b.startTime).getTime() : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    })[0];
  const wins = finished.filter((m) => m.winnerTeamId === team.id).length;
  const complete = team.starterCount >= 5;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(15,25,35,0.55)] p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${team.name} 的队伍信息`}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden bg-[#fffdf8] ring-1 ring-[#171a1f]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头：编号方块 + 队名 + 状态 */}
        <div className="flex items-start justify-between gap-4 border-b border-[#d8d1c6] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center bg-[#171a1f] font-mono text-sm font-black text-[#fffdf8]">
              {team.name.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[1.375rem] font-black leading-tight tracking-[-0.01em] text-[#171a1f]">{team.name}</h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.6875rem] tracking-[0.06em] text-[#5b626c]">
                <span>首发 {team.starterCount}/5</span>
                <span>{finished.length} 场 · {wins} 胜</span>
              </p>
            </div>
          </div>
          <div className="flex flex-none items-center gap-2">
            <StatusChip tone={complete ? "neutral" : "accent"}>{team.status}</StatusChip>
            <button type="button" onClick={onClose} aria-label="关闭" className="grid h-8 w-8 place-items-center text-lg leading-none text-[#5b626c] hover:text-[#171a1f]">×</button>
          </div>
        </div>

        <div className="overflow-y-auto">
          {/* 阵容：一行一个角色，名字连排不换行堆砌 */}
          <div className="px-5 pt-4">
            <p className="font-mono text-[0.625rem] font-black uppercase tracking-[0.18em] text-[#c83242]">Roster</p>
            {ROLE_ROWS.map(({ role, label, range }) => {
              const members = team.members.filter((m) => m.role === role);
              return (
                <div key={role} className="mt-2 flex items-baseline gap-3 border-b border-[#e7e1d7] pb-2">
                  <span className="w-11 flex-none font-mono text-[0.625rem] font-black text-[#8b929c]">{range}</span>
                  <span className="w-8 flex-none text-[0.6875rem] font-black text-[#8b929c]">{label}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-[0.8125rem] font-bold text-[#171a1f]">
                    {members.length > 0 ? members.map((m) => <span key={m.gameId}>{m.gameId}</span>) : <span className="font-normal text-[#8b929c]">未提交</span>}
                  </span>
                  <span className="flex-none font-mono text-[0.625rem] text-[#8b929c]">{members.length}</span>
                </div>
              );
            })}
          </div>

          {/* 比赛记录：紧凑行 */}
          <div className="px-5 pb-5 pt-4">
            <p className="font-mono text-[0.625rem] font-black uppercase tracking-[0.18em] text-[#c83242]">Matches</p>
            {next && (
              <div className="mt-2 border-l-2 border-[#ff4655] bg-[#fff1f2] px-2.5 py-2">
                <p className="font-mono text-[0.5625rem] font-black tracking-[0.12em] text-[#c83242]">NEXT</p>
                <p className="mt-0.5 text-[0.8125rem] font-bold text-[#171a1f]">
                  <span className="mr-1.5 text-[0.6875rem] font-normal text-[#8b929c]">VS</span>
                  {next.teamAId === team.id ? next.teamBName : next.teamAName}
                </p>
                <p className="mt-0.5 font-mono text-[0.625rem] tracking-[0.06em] text-[#5b626c]">
                  {next.startTime ? next.startTime.slice(5, 16).replace("T", " ") : next.status}
                  <span className="ml-2">{next.phase} · {next.boType}</span>
                </p>
              </div>
            )}
            {matches.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-[#8b929c]">还没有安排到这支队伍的比赛</p>
            ) : (
              <div className="mt-2">
                {matches.map((m) => {
                  const opponent = m.teamAId === team.id ? m.teamBName : m.teamAName;
                  const won = m.winnerTeamId === team.id;
                  const done = m.status === "已完成";
                  return (
                    <div key={m.id} className="flex items-center justify-between gap-3 border-b border-[#e7e1d7] py-2 last:border-b-0">
                      <span className="w-10 flex-none font-mono text-[0.625rem] text-[#8b929c]">{m.id}</span>
                      <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-bold text-[#171a1f]">
                        <span className="mr-1.5 text-[0.6875rem] font-normal text-[#8b929c]">VS</span>
                        {opponent}
                      </span>
                      <span className="flex-none font-mono text-[0.625rem] text-[#8b929c]">
                        {m.startTime ? m.startTime.slice(5, 16).replace("T", " ") : "待安排"}
                      </span>
                      <span className={`w-6 flex-none text-right font-mono text-[0.8125rem] font-black ${done ? (won ? "text-[#c83242]" : "text-[#8b929c]") : "text-[#8b929c]"}`}>
                        {done ? (won ? "胜" : "负") : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
