"use client";

import Link from "next/link";
import Image from "next/image";
import { use, useCallback, useEffect, useState } from "react";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import { useSchedule } from "@/lib/scheduling/useSchedule";
import { useRegistration } from "@/lib/scheduling/useRegistration";
import { currentStep, type BPAction } from "@/lib/scheduling/bp";
import type { BPSession } from "@/lib/scheduling/bp-ops";
import { mapImageOf } from "@/lib/maps";
import Badge from "@/components/ui/Badge";

interface BPPageProps {
  params: Promise<{ id: string }>;
}

const POLL_MS = 3000;

export default function BPPage({ params }: BPPageProps) {
  const { id: matchId } = use(params);
  const event = useCurrentEventConfig();
  const { state: schedule } = useSchedule();
  const { state: registration, currentPlayerId } = useRegistration();
  const match = schedule.matches.find((m) => m.id === matchId);
  const pool = event.mapPool.map((m) => m.name);

  const [session, setSession] = useState<BPSession | null>(null);
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [coinResult, setCoinResult] = useState<{ swapped: boolean; firstName: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/data/bp?matchId=${encodeURIComponent(matchId)}`, { cache: "no-store" })
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
  }, [matchId]);

  const shouldPoll = session?.status === "进行中";
  useEffect(() => {
    if (!shouldPoll) return;
    const timer = setInterval(() => {
      fetch(`/api/data/bp?matchId=${encodeURIComponent(matchId)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((json: { session?: BPSession | null }) => setSession(json.session ?? null))
        .catch(() => {
          // 忽略轮询失败，下个周期重试
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [shouldPoll, matchId]);

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<{ ok: boolean; message?: string; session?: BPSession; swapped?: boolean }> => {
      setBusy(true);
      setMessage("");
      try {
        const res = await fetch("/api/data/bp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, matchId, ...(currentPlayerId ? { playerId: currentPlayerId } : {}) }),
        });
        const json = (await res.json()) as { ok: boolean; message?: string; session?: BPSession; swapped?: boolean };
        if (!res.ok || !json.ok) {
          setMessage(json.message ?? "操作失败");
          return { ok: false, message: json.message };
        }
        if (json.session) setSession(json.session);
        return { ok: true, session: json.session, swapped: json.swapped };
      } catch {
        setMessage("网络异常，请稍后重试");
        return { ok: false };
      } finally {
        setBusy(false);
      }
    },
    [matchId, currentPlayerId],
  );

  // 当前身份
  const me = registration.players.find((p) => p.id === currentPlayerId);
  const myTeamId = me?.teamId;
  const myTeam = myTeamId ? registration.teams.find((t) => t.id === myTeamId) : undefined;
  const isCaptain = myTeam?.captainId === me?.id;
  const inMatch =
    myTeamId === match?.teamAId || myTeamId === match?.teamBId;

  if (!match) {
    return (
      <div className="min-h-screen bg-[#0f1923] text-white">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <p className="text-lg font-bold">未找到比赛 {matchId}</p>
          <p className="mt-2 text-sm text-gray-400">请从「比赛执行」或 BP 列表进入。</p>
          <Link href="/bp" className="mt-6 inline-block border border-gray-600 px-5 py-2.5 text-sm font-bold text-gray-300 hover:bg-gray-800">返回 BP 列表</Link>
        </div>
      </div>
    );
  }

  const poolForBO = pool.length;

  const handleStart = () => void post({ action: "start" });
  const handleMapClick = (mapName: string) => void post({ action: "advance", mapId: mapName });
  const handleUndo = () => void post({ action: "undo" });
  const handleReset = () => void post({ action: "reset" });
  const handleSwap = () => void post({ action: "swap" });

  const handleCoinflip = async () => {
    const r = await post({ action: "coinflip" });
    if (r.ok && r.session) {
      setCoinResult({ swapped: Boolean(r.swapped), firstName: r.session.firstTeamName });
      setTimeout(() => setCoinResult(null), 4000);
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

  return (
    <div className="min-h-screen bg-[#0f1923] text-white">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* 顶栏 */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">BP 房间 · {match.id}</h1>
            <p className="mt-1 text-sm text-gray-400">
              {match.phase} · {match.round} · {match.boType} · 地图池 {poolForBO} 张
            </p>
          </div>
          <div className="flex items-center gap-3">
            {admin && <Badge className="bg-[#ff4655] text-white">裁判模式</Badge>}
            <Link href="/bp" className="border border-gray-600 px-4 py-2 text-xs font-bold text-gray-300 hover:bg-gray-800">← BP 列表</Link>
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
          <div className="mb-4 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-400">{message}</div>
        )}

        {coinResult && (
          <div className="mb-4 border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm font-bold text-yellow-300">
            掷硬币结果：{coinResult.swapped ? `先手交换！现在由 ${coinResult.firstName} 先手` : "保持不变，先手不变"}
          </div>
        )}

        {/* 队伍条 */}
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div className={`border-2 p-4 transition-colors ${session && session.firstTeamSide === "A" ? "border-[#ff4655] bg-[#ff4655]/10" : "border-gray-700 bg-gray-800/50"}`}>
            <div className="flex items-center gap-2">
              <div className={`h-3 w-3  ${session?.firstTeamSide === "A" ? "bg-[#ff4655]" : "bg-[#4f8ef7]"}`} />
              <span className="font-bold">{match.teamAName}</span>
              {session && session.firstTeamId === match.teamAId && <Badge className="bg-yellow-500 text-black">先手</Badge>}
            </div>
            <p className="mt-1 text-xs text-gray-400">A 侧</p>
          </div>
          <div className={`border-2 p-4 transition-colors ${session && session.firstTeamSide === "B" ? "border-[#4f8ef7] bg-[#4f8ef7]/10" : "border-gray-700 bg-gray-800/50"}`}>
            <div className="flex items-center gap-2">
              <div className={`h-3 w-3  ${session?.firstTeamSide === "B" ? "bg-[#4f8ef7]" : "bg-[#ff4655]"}`} />
              <span className="font-bold">{match.teamBName}</span>
              {session && session.firstTeamId === match.teamBId && <Badge className="bg-yellow-500 text-black">先手</Badge>}
            </div>
            <p className="mt-1 text-xs text-gray-400">B 侧</p>
          </div>
        </div>

        {/* 未开始 / 进行中 / 已完成 */}
        {!session && (
          <div className="bg-gray-800/50 p-10 text-center">
            <p className="text-sm text-gray-400">BP 尚未开始</p>
            <p className="mt-2 text-xs text-gray-500">先手方默认 A 侧队伍，可先掷硬币决定先手</p>
            <div className="mt-6 flex justify-center gap-3">
              {((isCaptain && inMatch) || admin) && (
                <button onClick={handleStart} disabled={busy} className="bg-[#ff4655] px-6 py-3 text-sm font-bold text-white hover:bg-[#d83b48] disabled:opacity-50">
                  开始 BP
                </button>
              )}
              {((isCaptain && inMatch) || admin) && (
                <button onClick={handleCoinflip} disabled={busy} className="border border-yellow-500 px-6 py-3 text-sm font-bold text-yellow-400 hover:bg-yellow-500/10 disabled:opacity-50">
                  掷硬币决定先手
                </button>
              )}
            </div>
          </div>
        )}

        {session && session.status === "已完成" && (
          <div className="bg-green-500/10 p-6 text-center">
            <p className="text-green-400 font-bold">BP 完成！</p>
            <p className="mt-3 text-xl font-black">
              比赛地图：{session.finalMaps?.join("、") ?? "—"}
            </p>
            <p className="mt-2 text-xs text-gray-400">结果已写入赛程并生成通知草稿，可开始比赛。</p>
          </div>
        )}

        {session && session.status === "进行中" && (
          <>
            {/* 当前提示 */}
            <div className="mb-6 text-center">
              {step ? (
                <div className="inline-flex items-center gap-2 bg-[#ff4655]/20 px-5 py-2.5">
                  <span className="font-bold text-[#ff6572]">
                    {stepLabel(step.side, step.action)} 一张地图
                  </span>
                  <span className="text-sm text-gray-400">（第 {session.actions.length + 1}/{session.order.length} 步）</span>
                </div>
              ) : null}
              {session.boType !== "BO5" && session.order.length - session.actions.length === 1 && (
                <p className="mt-2 text-xs text-yellow-400">
                  最后一步完成后，{session.boType === "BO1" ? "唯一图" : "决胜图"}由剩余地图自动产生
                </p>
              )}
            </div>

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
                        ? "border-red-500/50 opacity-40"
                        : isPicked
                          ? "border-green-500"
                          : clickable
                            ? "border-gray-600 hover:border-[#ff4655] hover:bg-[#ff4655]/10 cursor-pointer"
                            : "border-gray-700"
                    }`}
                  >
                    <div className="relative flex h-full items-center justify-center overflow-hidden bg-gray-800">
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
                      <div className="absolute bottom-1 right-1 text-xs text-gray-400">
                        {record.side === "first" ? session.firstTeamName : session.secondTeamName}
                        {record.operatorRole === "referee" ? "（裁判）" : ""}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 流程条 */}
            <div className="mb-6 overflow-x-auto bg-gray-800/50 p-4">
              <p className="mb-3 text-xs font-bold text-gray-400">BP 流程（先手方为 {session.firstTeamName}）</p>
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
                                ? "bg-red-500/25 text-red-400"
                                : "bg-green-500/25 text-green-400"
                              : "bg-gray-700 text-gray-500"
                        }`}
                        title={act ? act.mapId : undefined}
                      >
                        {done ? (s.action === "ban" ? "✕ " : "✓ ") + (act?.mapId ?? "") : stepLabel(s.side, s.action)}
                      </span>
                      {i < session.order.length - 1 && <span className="text-gray-600">→</span>}
                    </div>
                  );
                })}
                {session.boType !== "BO5" && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-600">→</span>
                    <span className={`px-3 py-1.5 text-xs font-bold ${session.finalMaps ? "bg-yellow-500/25 text-yellow-400" : "bg-gray-700 text-gray-500"}`}>
                      {session.boType === "BO1" ? "唯一图" : "决胜图"}{session.finalMaps ? `（${session.finalMaps[session.finalMaps.length - 1]}）` : ""}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 操作记录 + 裁判工具 */}
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <div className="bg-gray-800/50 p-4">
                <p className="mb-3 text-xs font-bold text-gray-400">BP 记录</p>
                {session.actions.length === 0 ? (
                  <p className="text-sm text-gray-500">暂无操作</p>
                ) : (
                  <div className="space-y-1.5">
                    {session.actions.map((a: BPAction, idx: number) => (
                      <div key={idx} className="flex items-center gap-3 text-sm">
                        <span className="w-6 text-gray-500">{idx + 1}.</span>
                        <span className="font-medium">{(a.side === "first" ? session.firstTeamName : session.secondTeamName)}</span>
                        <span className="text-gray-400">{a.action === "ban" ? "禁用" : "选择"}</span>
                        <span className={`font-bold ${a.action === "ban" ? "text-red-400" : "text-green-400"}`}>{a.mapId}</span>
                        {a.operatorRole === "referee" && <span className="text-xs text-yellow-500">裁判代操作</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {(admin || canUndoLast) && (
                  <button onClick={handleUndo} disabled={busy} className="border border-gray-600 px-5 py-2.5 text-xs font-bold text-gray-300 hover:bg-gray-800 disabled:opacity-50">回退上一步</button>
                )}
                {(admin || (isCaptain && inMatch && session.actions.length === 0)) && (
                  <button onClick={handleCoinflip} disabled={busy} className="border border-yellow-600 px-5 py-2.5 text-xs font-bold text-yellow-400 hover:bg-yellow-500/10 disabled:opacity-50">掷硬币</button>
                )}
                {admin && (
                  <>
                    <button onClick={handleSwap} disabled={busy} className="border border-gray-600 px-5 py-2.5 text-xs font-bold text-gray-300 hover:bg-gray-800 disabled:opacity-50">手动交换先手</button>
                    <button onClick={handleReset} disabled={busy} className="border border-red-600 px-5 py-2.5 text-xs font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-50">重置 BP</button>
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {/* 投屏提示 */}
        <p className="mt-8 text-center text-xs text-gray-500">
          双方队长在不同设备操作时，本页每 {POLL_MS / 1000} 秒自动同步一次状态
        </p>
      </div>
    </div>
  );
}
