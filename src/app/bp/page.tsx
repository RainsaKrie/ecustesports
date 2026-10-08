"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import Container from "@/components/layout/Container";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import { useSchedule } from "@/lib/scheduling/useSchedule";
import { buildBPOrder } from "@/lib/scheduling/bp";
import type { BPSession } from "@/lib/scheduling/bp-ops";

function fmt(iso: string): string {
  if (!iso) return "待安排";
  return iso.slice(5, 16).replace("T", " ");
}

/** 展示顺序用的 BO 列表 */
const BO_TYPES = ["BO1", "BO3", "BO5"] as const;

/**
 * 各 BO 需要的最终地图数，用于提示地图池是否够。
 * 与 `lib/scheduling/bp.ts` 的 `MAPS_NEEDED` 保持一致（BO1 剩 1 / BO3 剩 3 / BO5 选满 5）。
 */
const MIN_POOL: Record<(typeof BO_TYPES)[number], number> = { BO1: 1, BO3: 3, BO5: 5 };

interface BPEntryPageProps {
  searchParams: Promise<{ eventId?: string }>;
}

export default function BPEntryPage({ searchParams }: BPEntryPageProps) {
  const { eventId: requestedEventId } = use(searchParams);
  const event = useCurrentEventConfig(requestedEventId);
  const eventId = requestedEventId || event.id;
  const { state } = useSchedule(eventId);
  const [sessions, setSessions] = useState<Record<string, BPSession>>({});

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`/api/data/bp?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" })
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
  }, [eventId]);

  /**
   * 显示「已排期可 BP」与「已有 BP 会话」两类比赛。
   *
   * 原来只筛「已排期」，导致比赛一旦打完（状态变为「已完成」），
   * 它的 BP 记录就从列表里消失 —— 现场争议时无法回溯。现在已完成的一并列出。
   */
  const bpMatches = state.matches.filter(
    (m) => m.teamAId !== "TBD" && m.teamBId !== "TBD" && (m.status === "已排期" || Boolean(sessions[m.id])),
  );
  const pendingCount = bpMatches.filter((m) => !sessions[m.id]).length;
  const doneCount = bpMatches.filter((m) => sessions[m.id]).length;
  const poolSize = (event.mapPool ?? []).length;

  return (
    <Container className="py-8">
      <div className="mb-6">
        <h1 className="text-[length:var(--adm-fs-xl)] font-bold text-[var(--adm-text)]">BP 工具</h1>
        <p className="mt-1 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">{event.name}</p>
      </div>

      {/* BP 规则 */}
      <div className="mb-6 border border-[var(--adm-line-soft)] bg-[var(--adm-surface)] p-6">
        <h2 className="mb-3 text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text)]">BP 规则</h2>
        {/*
          顺序由 `buildBPOrder` 生成，与 BP 房间实际使用的逻辑同源 ——
          原先这里写死了 BO3 的七步顺序却冠以「BP 规则」，
          对 BO1（6 个禁步）和 BO5（2 禁 + 5 选）都是错的，会误导用户。
        */}
        <div className="space-y-2">
          {BO_TYPES.map((bo) => {
            const steps = buildBPOrder(bo, poolSize);
            return (
              <div key={bo} className="flex flex-wrap items-center gap-2">
                <span className="w-12 shrink-0 text-[length:var(--adm-fs-sm)] font-semibold tabular-nums text-[var(--adm-text)]">{bo}</span>
                {steps.length === 0 ? (
                  <span className="adm-chip" data-tone="attention">
                    地图池不足（需至少 {MIN_POOL[bo]} 张，当前 {poolSize} 张）
                  </span>
                ) : (
                  <>
                    {steps.map((s, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="adm-chip" data-tone={s.action === "ban" ? "attention" : "done"}>
                          {idx % 2 === 0 ? "A" : "B"}
                          {s.action === "ban" ? "禁" : "选"}
                        </span>
                        {idx < steps.length - 1 && <span className="text-[length:var(--adm-fs-sm)] text-[var(--adm-text-mute)]">→</span>}
                      </div>
                    ))}
                    {bo !== "BO5" && (
                      <div className="flex items-center gap-2">
                        <span className="text-[length:var(--adm-fs-sm)] text-[var(--adm-text-mute)]">→</span>
                        <span className="adm-chip" data-dot="off">
                          {bo === "BO1" ? "唯一图" : "决胜图"}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[length:var(--adm-fs-sm)] leading-[1.7] text-[var(--adm-text-mute)]">
          A 为先手方。BO1 剩最后一张即比赛地图；BO3 剩余那张为决胜图；BO5 全部由 Pick 决定，无决胜图。
        </p>
      </div>

      {/* 比赛 */}
      <h2 className="mb-1 text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">BP 比赛</h2>
      <p className="mb-4 text-[length:var(--adm-fs-sm)] text-[var(--adm-text-soft)]">
        待 BP {pendingCount} 场 · 已有记录 {doneCount} 场（已完成的可点进去回溯选图过程）
      </p>
      {bpMatches.length === 0 ? (
        <div className="border border-dashed border-[var(--adm-line)] bg-[var(--adm-surface-2)] p-8 text-center text-[length:var(--adm-fs-md)] text-[var(--adm-text-mute)]">
          暂无待 BP 的比赛
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {bpMatches.map((match) => {
            const session = sessions[match.id];
            return (
              <Link
                key={match.id}
                href={`/bp/${match.id}?eventId=${encodeURIComponent(eventId)}`}
                className="border border-[var(--adm-line-soft)] bg-[var(--adm-surface)] p-5 transition hover:border-[var(--adm-text)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-[length:var(--adm-fs-sm)] tabular-nums text-[var(--adm-text-mute)]">
                    {match.phase} · {match.id} · {match.boType}
                  </p>
                  {session?.status === "已完成" ? (
                    <span className="adm-chip" data-tone="done">已完成</span>
                  ) : session?.status === "进行中" ? (
                    <span className="adm-chip" data-tone="active">
                      进行中 {session.actions.length}/{session.order.length}
                    </span>
                  ) : (
                    <span className="adm-chip" data-tone="neutral">待定先手</span>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="h-3 w-3 shrink-0 bg-[var(--adm-red)]" />
                    <span className="truncate text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text)]">{match.teamAName}</span>
                  </div>
                  <span className="shrink-0 px-2 text-[length:var(--adm-fs-sm)] text-[var(--adm-text-mute)]">vs</span>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text)]">{match.teamBName}</span>
                    {/* B 侧用 --ink-soft（深墨）而非令牌外的蓝色，与房间页点位一致 */}
                    <span aria-hidden className="h-3 w-3 shrink-0 bg-[var(--ink-soft)]" />
                  </div>
                </div>
                <p className="mt-3 text-[length:var(--adm-fs-sm)] tabular-nums text-[var(--adm-text-mute)]">开赛时间：{fmt(match.startTime)}</p>
                {session?.status === "已完成" && session.finalMaps && (
                  <p className="mt-2 text-[length:var(--adm-fs-sm)] text-[var(--adm-text-soft)]">地图：{session.finalMaps.join("、")}</p>
                )}
              </Link>
            );
          })}
        </div>
      )}

    </Container>
  );
}
