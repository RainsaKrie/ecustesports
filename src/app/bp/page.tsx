"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Container from "@/components/layout/Container";
import Button from "@/components/ui/Button";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import { useSchedule } from "@/lib/scheduling/useSchedule";
import type { BPSession } from "@/lib/scheduling/bp-ops";

function fmt(iso: string): string {
  if (!iso) return "待安排";
  return iso.slice(5, 16).replace("T", " ");
}

export default function BPEntryPage() {
  const event = useCurrentEventConfig();
  const { state } = useSchedule();
  const [sessions, setSessions] = useState<Record<string, BPSession>>({});

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/data/bp", { cache: "no-store" })
        .then((r) => r.json())
        .then((json: { sessions?: Record<string, BPSession> }) => {
          if (!cancelled) setSessions(json.sessions ?? {});
        })
        .catch(() => {
          // 忽略，保持旧数据
        });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const bpMatches = state.matches.filter((m) => m.status === "已排期" && m.teamAId !== "TBD" && m.teamBId !== "TBD");

  return (
    <Container className="py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">BP 工具</h1>
        <p className="text-sm text-gray-500 mt-1">{event.name} · 无畏契约地图 Ban/Pick 交互工具</p>
      </div>

      {/* How it works */}
      <div className="border border-gray-200 bg-white p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">BP 规则</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {["A禁", "B禁", "A禁", "B禁", "A选", "B选", "决胜图"].map((step, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span
                className={`px-3 py-1.5 text-xs font-medium ${
                  step.includes("禁")
                    ? "bg-red-100 text-red-700"
                    : step.includes("选")
                    ? "bg-green-100 text-green-700"
                    : "bg-yellow-100 text-yellow-700"
                }`}
              >
                {step}
              </span>
              {idx < 6 && <span className="text-gray-300">→</span>}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-400">
          BO1 双方各禁 3 张剩唯一图；BO3 各禁 2 张后各选 1 张，剩 1 张为决胜图；BO5 各禁 1 张后选满 5 张。先手方默认 A 侧，可掷硬币决定。
        </p>
      </div>

      {/* Available matches */}
      <h2 className="text-lg font-bold text-gray-900 mb-4">可 BP 的比赛</h2>
      {bpMatches.length === 0 ? (
        <div className="border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-400">暂无待 BP 的比赛</p>
          <p className="mt-2 text-xs text-gray-400">比赛排期后将在这里开放 BP 房间。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {bpMatches.map((match) => {
            const session = sessions[match.id];
            return (
              <Link
                key={match.id}
                href={`/bp/${match.id}`}
                className="border border-gray-200 bg-white p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">{match.phase} · {match.id} · {match.boType}</p>
                  {session?.status === "已完成" ? (
                    <span className="bg-emerald-50 px-2 py-1 text-[0.625rem] font-bold text-emerald-700">已完成</span>
                  ) : session?.status === "进行中" ? (
                    <span className="bg-[#fff1f2] px-2 py-1 text-[0.625rem] font-bold text-[#c83242]">
                      进行中 {session.actions.length}/{session.order.length}
                    </span>
                  ) : (
                    <span className="bg-slate-100 px-2 py-1 text-[0.625rem] font-bold text-slate-500">未开始</span>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3  bg-[#ff4655]" />
                    <span className="font-medium text-gray-900">{match.teamAName}</span>
                  </div>
                  <span className="text-gray-300 text-sm">vs</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{match.teamBName}</span>
                    <div className="h-3 w-3  bg-[#4f8ef7]" />
                  </div>
                </div>
                <p className="mt-3 text-xs text-gray-400">开赛时间：{fmt(match.startTime)}</p>
                {session?.status === "已完成" && session.finalMaps && (
                  <p className="mt-2 text-xs font-bold text-emerald-700">地图：{session.finalMaps.join("、")}</p>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* BP entrance */}
      <div className="mt-6 text-center">
        {bpMatches.length > 0 ? (
          <Button href={`/bp/${bpMatches[0].id}`} variant="outline">进入第一场 BP 房间 →</Button>
        ) : (
          <p className="text-sm text-gray-500">赛程排期后开放 BP 房间</p>
        )}
      </div>
    </Container>
  );
}
