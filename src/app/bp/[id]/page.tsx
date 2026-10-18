"use client";

import StatusChip from "@/components/events/StatusChip";
import Link from "next/link";
import Image from "next/image";
import { use, useCallback, useEffect, useState } from "react";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import { useSchedule } from "@/lib/scheduling/useSchedule";
import { useParticipant } from "@/lib/scheduling/useParticipant";
import { currentStep, type BPAction } from "@/lib/scheduling/bp";
import type { BPSession, BPDiceRoll } from "@/lib/scheduling/bp-ops";
import { mapImageOf } from "@/lib/games";
import Badge from "@/components/ui/Badge";
import { useAdminConfirm } from "@/components/admin/ui";

interface BPPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ eventId?: string }>;
}

const POLL_MS = 3000;

export default function BPPage({ params, searchParams }: BPPageProps) {
  const { id: matchId } = use(params);
  const { eventId: requestedEventId } = use(searchParams);
  const event = useCurrentEventConfig(requestedEventId);
  const eventId = requestedEventId || event.id;
  const { state: schedule } = useSchedule(eventId);
  const participant = useParticipant(eventId);
  const confirm = useAdminConfirm();
  const match = schedule.matches.find((m) => m.id === matchId);
  const pool = event.mapPool.map((m) => m.name);

  const [session, setSession] = useState<BPSession | null>(null);
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  /** 刚掷出的点数（用于高亮提示；会话里也存了一份，刷新后仍可见） */
  const [rolledNow, setRolledNow] = useState<{ roll: BPDiceRoll; attempts: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/data/bp?eventId=${encodeURIComponent(eventId)}&matchId=${encodeURIComponent(matchId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: { session?: BPSession | null }) => {
        if (!cancelled) setSession(json.session ?? null);
      })
      .catch(() => {
        // 读取失败保持空会话
      });
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((json: { authed?: boolean }) => {
        if (!cancelled) setAdmin(Boolean(json.authed));
      })
      .catch(() => {
        if (!cancelled) setAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, matchId]);

  const shouldPoll = session?.status === "进行中";
  useEffect(() => {
    if (!shouldPoll) return;
    const timer = setInterval(() => {
      fetch(`/api/data/bp?eventId=${encodeURIComponent(eventId)}&matchId=${encodeURIComponent(matchId)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((json: { session?: BPSession | null }) => setSession(json.session ?? null))
        .catch(() => {
          // 忽略轮询失败，下个周期重试
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [shouldPoll, eventId, matchId]);

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<{ ok: boolean; message?: string; session?: BPSession; diceRoll?: BPDiceRoll; attempts?: number }> => {
      setBusy(true);
      setMessage("");
      try {
        const res = await fetch("/api/data/bp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(participant.token ? { Authorization: `Bearer ${participant.token}` } : {}),
          },
          body: JSON.stringify({ ...body, eventId, matchId }),
        });
        const json = (await res.json()) as { ok: boolean; message?: string; session?: BPSession; diceRoll?: BPDiceRoll; attempts?: number };
        if (!res.ok || !json.ok) {
          setMessage(json.message ?? "操作失败");
          return { ok: false, message: json.message };
        }
        if (json.session) setSession(json.session);
        return { ok: true, session: json.session, diceRoll: json.diceRoll, attempts: json.attempts };
      } catch {
        setMessage("网络异常，请稍后重试");
        return { ok: false };
      } finally {
        setBusy(false);
      }
    },
    [eventId, matchId, participant.token],
  );

  // 当前身份
  const me = participant.data?.player;
  const myTeam = participant.data?.team;
  const myTeamId = myTeam?.id;
  const isCaptain = participant.data?.isCaptain === true;
  const inMatch =
    myTeamId === match?.teamAId || myTeamId === match?.teamBId;

  if (!match) {
    return (
      <div className="min-h-screen bg-[#0f1923] text-white">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <p className="text-lg font-bold">未找到比赛 {matchId}</p>
          <p className="mt-2 text-sm text-[#c3c9d2]">请从「比赛执行」或 BP 列表进入。</p>
          <Link href={`/bp?eventId=${encodeURIComponent(eventId)}`} className="mt-6 inline-block border border-[#3a4048] px-5 py-2.5 text-sm font-bold text-[#e2e6ec] hover:bg-[#1e2228]">返回 BP 列表</Link>
        </div>
      </div>
    );
  }

  const poolForBO = pool.length;

  const handleStart = () => void post({ action: "start" });
  const handleMapClick = (mapName: string) => void post({ action: "advance", mapId: mapName });
  const handleUndo = () => void post({ action: "undo" });
  const handleReset = () => {
    // 重置会连先手一起清掉，先说清楚再执行 —— 这一步不可撤销
    void confirm({
      title: "重置本局 BP？",
      body: "会清空本局 BP 的全部操作，并取消已掷出的先手结果。这一步不可撤销。",
      confirmLabel: "重置",
      tone: "danger",
    }).then((ok) => {
      if (!ok) return;
      setRolledNow(null);
      void post({ action: "reset" });
    });
  };
  const handleSwap = () => void post({ action: "swap" });

  const handleRoll = async () => {
    const r = await post({ action: "roll" });
    if (r.ok && r.session && r.diceRoll) {
      setRolledNow({ roll: r.diceRoll, attempts: r.attempts ?? 1 });
    }
  };

  // 会话内的身份与步骤
  const step = session ? currentStep(session.order, session.actions) : null;
  const mySideInSession =
    session && myTeamId ? (session.firstTeamId === myTeamId ? "first" : session.secondTeamId === myTeamId ? "second" : null) : null;
  const myTurn = Boolean(session && step && mySideInSession && step.side === mySideInSession && isCaptain);
  const canOperate = admin || myTurn;
  const lastAction = session?.actions[session.actions.length - 1];
  const canUndoLast =
    Boolean(session && lastAction && session.status === "进行中") &&
    (admin || (mySideInSession !== null && isCaptain && lastAction!.side === mySideInSession));

  const stepLabel = (side: "first" | "second", action: "ban" | "pick") =>
    `${side === "first" ? session?.firstTeamName : session?.secondTeamName} ${action === "ban" ? "Ban" : "Pick"}`;

  /**
   * 副标题片段去重：入围赛比赛的 `phase` 与 `round` 值相同（都是「入围赛」），
   * 直接拼会显示成「入围赛 · 入围赛」。16 场入围赛都受影响。
   */
  const matchMeta = [match.phase, match.round, match.boType].filter(
    (value, index, all) => Boolean(value) && all.indexOf(value) === index,
  );

  return (
    <div className="min-h-screen bg-[#0f1923] text-white">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* 顶栏 */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">BP 房间 · {match.id}</h1>
              <p className="mt-1 text-sm text-[#c3c9d2]">
                {matchMeta.join(" · ")} · 地图池 {poolForBO} 张
              </p>
          </div>
          <div className="flex items-center gap-3">
            {admin && <StatusChip tone="accent">裁判模式</StatusChip>}
            <Link href={`/bp?eventId=${encodeURIComponent(eventId)}`} className="border border-[#3a4048] px-4 py-2 text-xs font-bold text-[#e2e6ec] hover:bg-[#1e2228]">← BP 列表</Link>
          </div>
        </div>

        {/* 身份提示条 */}
        {!admin && (
          <div className={`mb-4 px-4 py-3 text-sm font-bold ${isCaptain && inMatch ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
            {isCaptain && inMatch
              ? `你是 ${myTeam?.name} 的队长${myTurn ? "，现在轮到本方操作" : "，等待本方回合"}` 
              : me && inMatch
                ? "你是队伍成员，仅队长可以操作 BP"
                : "当前为游客只读模式；操作 BP 需以双方队长身份报名，或由裁判在后台登录后代操作"}
          </div>
        )}

        {message && (
          <div className="mb-4 border border-[#ff4655]/40 bg-[#ff4655]/10 px-4 py-3 text-sm font-bold text-[#ff8177]">{message}</div>
        )}

        {/* 掷骰子结果：两个点数都摆出来，谁先手当场可验算 */}
        {(rolledNow || session?.diceRoll) && (() => {
          const roll = rolledNow?.roll ?? session!.diceRoll!;
          const attempts = rolledNow?.attempts ?? 1;
          const aFirst = roll.teamA > roll.teamB;
          const firstName = aFirst ? match.teamAName : match.teamBName;
          const tie = roll.teamA === roll.teamB;
          return (
            <div className="mb-4 border border-[#f5b544]/40 bg-[#f5b544]/10 px-4 py-3">
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-xs font-bold text-[#f5b544]">掷骰子定先手</span>
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-[#e2e6ec]">A 侧 {match.teamAName}</span>
                  <span className={`text-xl font-semibold ${aFirst && !tie ? "text-[#f5b544]" : "text-[#c3c9d2]"}`}>{roll.teamA}</span>
                </span>
                <span className="text-xs text-[#98a1ad]">比</span>
                <span className="flex items-center gap-2 text-sm">
                  <span className={`text-xl font-semibold ${!aFirst && !tie ? "text-[#f5b544]" : "text-[#c3c9d2]"}`}>{roll.teamB}</span>
                  <span className="text-[#e2e6ec]">B 侧 {match.teamBName}</span>
                </span>
                <span className="text-sm font-bold text-[#f5b544]">
                  {tie ? "点数相同，先手保持不变" : `${roll.teamA > roll.teamB ? "A" : "B"} 侧点数大，由 ${firstName} 先手`}
                </span>
                {attempts > 1 && <span className="text-xs text-[#c3c9d2]">（平局重掷 {attempts} 轮）</span>}
              </div>
            </div>
          );
        })()}

        {/* 队伍条
            点位色表示**队伍身份**（A=品牌红 / B=深墨），与 BP 列表页一致；
            卡片高亮表示**先手**（统一品牌红）。
            此前点位色表示先手且两处判定互相矛盾 —— 导致两点永远同色、
            且「先手」在 A 侧是红、在 B 侧是蓝。同时蓝色不在设计令牌内。 */}
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div className={`border-2 p-4 transition-colors ${session && session.firstTeamSide === "A" ? "border-[#ff4655] bg-[#ff4655]/10" : "border-[#3a4048] bg-[#1e2228]/50"}`}>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 bg-[#ff4655]" />
              <span className="font-bold">{match.teamAName}</span>
              {session && session.firstTeamId === match.teamAId && <StatusChip tone="accent">先手</StatusChip>}
            </div>
            <p className="mt-1 text-xs text-[#c3c9d2]">A 侧</p>
          </div>
          <div className={`border-2 p-4 transition-colors ${session && session.firstTeamSide === "B" ? "border-[#ff4655] bg-[#ff4655]/10" : "border-[#3a4048] bg-[#1e2228]/50"}`}>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 bg-[#25313b]" />
              <span className="font-bold">{match.teamBName}</span>
              {session && session.firstTeamId === match.teamBId && <StatusChip tone="accent">先手</StatusChip>}
            </div>
            <p className="mt-1 text-xs text-[#c3c9d2]">B 侧</p>
          </div>
        </div>

        {/* 未开始 / 进行中 / 已完成 */}
        {!session && (
          <div className="bg-[#1e2228]/50 p-10 text-center">
            <p className="text-sm text-[#c3c9d2]">BP 尚未开始</p>
            <p className="mt-2 text-xs text-[#98a1ad]">
              默认先手：A 侧（{match.teamAName}）；双方也可各掷一颗骰子比大小决定
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {((isCaptain && inMatch) || admin) && (
                <button onClick={handleStart} disabled={busy} className="bg-[#ff4655] px-6 py-3 text-sm font-bold text-white hover:bg-[#d83b48] disabled:opacity-50">
                  开始 BP（A 侧先手）
                </button>
              )}
              {((isCaptain && inMatch) || admin) && (
                <button onClick={handleRoll} disabled={busy} className="border border-[#f5b544] px-6 py-3 text-sm font-bold text-[#f5b544] hover:bg-[#f5b544]/10 disabled:opacity-50">
                  掷骰子比大小决定先手
                </button>
              )}
            </div>
          </div>
        )}

        {session && session.status === "已完成" && (
          <div className="bg-[#22a06b]/10 p-6 text-center">
            <p className="text-[#4ade80] font-bold">BP 完成！</p>
            <p className="mt-3 text-xl font-semibold">
              比赛地图：{session.finalMaps?.join("、") ?? "—"}
            </p>
          </div>
        )}

        {/*
          已完成与进行中共用同一套展示（地图网格 / 流程条 / BP 记录），
          只把「当前提示」和「操作按钮」限制为进行中 —— 设计文档 §2.5 要求
          完成后「下方保留完整记录供回溯」，所以记录不能在完成时消失。
        */}
        {session && (
          <>
            {/* 当前提示（仅进行中） */}
            {session.status === "进行中" && (
              <div className="mb-6 text-center">
                {step ? (
                  <div className="inline-flex items-center gap-2 bg-[#ff4655]/20 px-5 py-2.5">
                    <span className="font-bold text-[#ff6572]">
                      {stepLabel(step.side, step.action)} 一张地图
                    </span>
                    <span className="text-sm text-[#c3c9d2]">（第 {session.actions.length + 1}/{session.order.length} 步）</span>
                  </div>
                ) : null}
                {session.boType !== "BO5" && session.order.length - session.actions.length === 1 && (
                  <p className="mt-2 text-xs text-[#f5b544]">剩余地图为{session.boType === "BO1" ? "比赛地图" : "决胜图"}</p>
                )}
              </div>
            )}

            {/* 地图网格 */}
            <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {pool.map((mapName) => {
                const record = session.actions.find((a) => a.mapId === mapName);
                const isBanned = record?.action === "ban";
                const isPicked = record?.action === "pick";
                const pickIndex = session.actions.filter((a) => a.action === "pick").findIndex((a) => a.mapId === mapName);
                const clickable = canOperate && !record && session.status === "进行中";
                return (
                  <button
                    key={mapName}
                    onClick={() => clickable && handleMapClick(mapName)}
                    disabled={!clickable}
                    className={`relative aspect-video overflow-hidden border-2 transition-all ${
                      isBanned
                        ? "border-[#ff4655]/50 opacity-40"
                        : isPicked
                          ? "border-green-500"
                          : clickable
                            ? "border-[#3a4048] hover:border-[#ff4655] hover:bg-[#ff4655]/10 cursor-pointer"
                            : "border-[#3a4048]"
                    }`}
                  >
                    <div className="relative flex h-full items-center justify-center overflow-hidden bg-[#1e2228]">
                      {mapImageOf({ name: mapName }) && (
                        <Image
                          src={mapImageOf({ name: mapName })!}
                          alt={mapName}
                          fill
                          sizes="(max-width: 768px) 50vw, 25vw"
                          className="object-cover opacity-90"
                        />
                      )}
                      <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-black/25" />
                      <span className="relative z-10 px-1 text-center text-base font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                        {mapName}
                      </span>
                    </div>
                    {isBanned && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-2xl font-bold text-red-500">✕ BAN</span>
                      </div>
                    )}
                    {isPicked && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xl font-bold text-green-500">✓ PICK{pickIndex >= 0 ? ` #${pickIndex + 1}` : ""}</span>
                      </div>
                    )}
                    {record && (
                      <div className="absolute bottom-1 right-1 text-xs text-[#c3c9d2]">
                        {record.side === "first" ? session.firstTeamName : session.secondTeamName}
                        {record.operatorRole === "referee" ? "（裁判）" : ""}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 流程条 */}
            <div className="mb-6 overflow-x-auto bg-[#1e2228]/50 p-4">
              <p className="mb-3 text-xs font-bold text-[#c3c9d2]">BP 流程（先手方为 {session.firstTeamName}）</p>
              <div className="flex items-center gap-2 min-w-max">
                {session.order.map((s, i) => {
                  const done = i < session.actions.length;
                  const act = session.actions[i];
                  const isCurrent = i === session.actions.length;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span
                        className={`px-3 py-1.5 text-xs font-bold ${
                          isCurrent
                            ? "bg-[#ff4655] text-white"
                            : done
                              ? s.action === "ban"
                                ? "bg-[#ff4655]/25 text-[#ff8177]"
                                : "bg-[#22a06b]/25 text-[#4ade80]"
                              : "bg-[#2a2f36] text-[#98a1ad]"
                        }`}
                        title={act ? act.mapId : undefined}
                      >
                        {done ? (s.action === "ban" ? "✕ " : "✓ ") + (act?.mapId ?? "") : stepLabel(s.side, s.action)}
                      </span>
                      {i < session.order.length - 1 && <span className="text-[#98a1ad]">→</span>}
                    </div>
                  );
                })}
                {session.boType !== "BO5" && (
                  <div className="flex items-center gap-2">
                    <span className="text-[#98a1ad]">→</span>
                    <span className={`px-3 py-1.5 text-xs font-bold ${session.finalMaps ? "bg-[#f5b544]/25 text-[#f5b544]" : "bg-[#2a2f36] text-[#98a1ad]"}`}>
                      {session.boType === "BO1" ? "唯一图" : "决胜图"}{session.finalMaps ? `（${session.finalMaps[session.finalMaps.length - 1]}）` : ""}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 操作记录；工具按钮仅进行中可见（完成态只读回溯） */}
            <div className={`grid gap-4 ${session.status === "进行中" ? "md:grid-cols-[1fr_auto]" : ""}`}>
              <div className="bg-[#1e2228]/50 p-4">
                <p className="mb-3 text-xs font-bold text-[#c3c9d2]">BP 记录</p>
                {session.actions.length === 0 ? (
                  <p className="text-sm text-[#98a1ad]">暂无操作</p>
                ) : (
                  <div className="space-y-1.5">
                    {session.actions.map((a: BPAction, idx: number) => (
                      <div key={idx} className="flex items-center gap-3 text-sm">
                        <span className="w-6 text-[#98a1ad]">{idx + 1}.</span>
                        <span className="font-medium">{(a.side === "first" ? session.firstTeamName : session.secondTeamName)}</span>
                        <span className="text-[#c3c9d2]">{a.action === "ban" ? "禁用" : "选择"}</span>
                        <span className={`font-bold ${a.action === "ban" ? "text-[#ff8177]" : "text-[#4ade80]"}`}>{a.mapId}</span>
                        {a.operatorRole === "referee" && <span className="text-xs text-[#f5b544]">裁判代操作</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {session.status === "进行中" && (
                <div className="flex flex-col gap-2">
                  {(admin || canUndoLast) && (
                    <button onClick={handleUndo} disabled={busy} className="border border-[#3a4048] px-5 py-2.5 text-xs font-bold text-[#e2e6ec] hover:bg-[#1e2228] disabled:opacity-50">回退上一步</button>
                  )}
                  {(admin || (isCaptain && inMatch && session.actions.length === 0)) && (
                    <button onClick={handleRoll} disabled={busy} className="border border-yellow-600 px-5 py-2.5 text-xs font-bold text-[#f5b544] hover:bg-[#f5b544]/10 disabled:opacity-50">掷骰子比大小</button>
                  )}
                  {admin && (
                    <>
                      <button onClick={handleSwap} disabled={busy} className="border border-[#3a4048] px-5 py-2.5 text-xs font-bold text-[#e2e6ec] hover:bg-[#1e2228] disabled:opacity-50">手动交换先手</button>
                      <button onClick={handleReset} disabled={busy} className="border border-red-600 px-5 py-2.5 text-xs font-bold text-[#ff8177] hover:bg-[#ff4655]/10 disabled:opacity-50">重置 BP（含先手结果）</button>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
