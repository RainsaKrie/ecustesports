// =====================
// BP 会话接口
// GET 公开读取；POST 为公开写接口，但服务端按操作校验身份：
// - 双方队长（弱身份 playerId）可推进本方步骤、启动、掷硬币、回退本方上一步
// - 管理员（会话 cookie）可代任意操作、手动交换先手、重置
// =====================

import { readEventData, writeEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import type { NextRequest } from "next/server";
import {
  initialSchedule,
  type ScheduleState,
} from "@/lib/scheduling/schedule-data";
import {
  initialRegistration,
  type RegistrationState,
} from "@/lib/scheduling/registration-data";
import {
  startBP,
  advanceBP,
  undoBP,
  swapFirstBP,
  resetBP,
  stepTeam,
  sessionMatchesMatch,
  type BPStore,
  type BPSession,
} from "@/lib/scheduling/bp-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadStore(eventId: string): Promise<BPStore> {
  return readEventData<BPStore>(eventId, "bp", {});
}

/** 判定请求者身份：管理员（cookie）或选手所属队伍（playerId） */
async function resolveRequester(
  request: NextRequest,
  body: Record<string, unknown> | null,
  eventId: string,
): Promise<{ admin: boolean; playerId?: string; teamId?: string; isCaptain?: boolean }> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const admin = verifySessionToken(token);
  if (admin) return { admin };

  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  if (!playerId) return { admin: false };

  const reg = await readEventData<RegistrationState>(eventId, "registration", initialRegistration());
  const player = reg.players.find((p) => p.id === playerId);
  if (!player?.teamId) return { admin: false, playerId };
  const team = reg.teams.find((t) => t.id === player.teamId);
  return { admin: false, playerId, teamId: team?.id, isCaptain: team?.captainId === playerId };
}

/** 完成 BP 后：把选图写入比赛记录 + 生成通知草稿 */
async function commitBPMaps(session: BPSession, eventId: string) {
  if (!session.finalMaps || session.finalMaps.length === 0) return;
  const schedule = await readEventData<ScheduleState>(eventId, "schedule", initialSchedule());
  const match = schedule.matches.find((m) => m.id === session.matchId);
  if (!match) return;
  const matches = schedule.matches.map((m) =>
    m.id === session.matchId ? { ...m, bpMaps: session.finalMaps } : m,
  );
  const notification = {
    id: `NT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: schedule.version,
    content: `【BP 完成】${match.id} ${match.teamAName} vs ${match.teamBName} 比赛地图：${session.finalMaps.join("、")}。请裁判与双方确认后开赛。`,
    status: "草稿" as const,
    createdAt: new Date().toISOString(),
  };
  await writeEventData(eventId, "schedule", {
    ...schedule,
    matches,
    notifications: [notification, ...schedule.notifications],
  });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const matchId = url.searchParams.get("matchId");
  const config = await getSiteConfig();
  const eventId = config.currentEventId;
  const store = await loadStore(eventId);
  if (matchId) {
    return Response.json({ session: store[matchId] ?? null });
  }
  return Response.json({ sessions: store });
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 50_000) {
      return Response.json({ ok: false, message: "请求内容过长" }, { status: 413 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = typeof body?.action === "string" ? body.action : "";
    const matchId = typeof body?.matchId === "string" ? body.matchId : "";
    const mapId = typeof body?.mapId === "string" ? body.mapId : "";

    const config = await getSiteConfig();
    const eventId = config.currentEventId;
    const requester = await resolveRequester(request, body, eventId);
    const pool = config.events.find((e) => e.id === eventId)?.mapPool.map((m) => m.name) ?? [];
    const schedule = await readEventData<ScheduleState>(eventId, "schedule", initialSchedule());
    const match = schedule.matches.find((m) => m.id === matchId);
    const store = await loadStore(eventId);
    const session = store[matchId];

    if (!match) {
      return Response.json({ ok: false, message: "比赛不存在" }, { status: 400 });
    }

    const isAdmin = requester.admin;
    const teamId = requester.teamId;
    if (!isAdmin) {
      if (!teamId || !requester.isCaptain) {
        return Response.json({ ok: false, message: "只有双方队长或裁判可以操作 BP" }, { status: 403 });
      }
      if (teamId !== match.teamAId && teamId !== match.teamBId) {
        return Response.json({ ok: false, message: "你不是本场比赛的队伍" }, { status: 403 });
      }
    }

    switch (action) {
      case "start": {
        // 赛程重置后旧会话对阵已失效：删除孤儿会话后重建
        let baseStore = store;
        if (session && !sessionMatchesMatch(session, match)) {
          const next = { ...store };
          delete next[matchId];
          baseStore = next;
        }
        const result = startBP(baseStore, { match, pool });
        if (!result.ok || !result.session) {
          return Response.json({ ok: false, message: result.message ?? "启动失败" }, { status: 400 });
        }
        await writeEventData(eventId, "bp", { ...baseStore, [matchId]: result.session });
        return Response.json({ ok: true, session: result.session });
      }

      case "advance": {
        if (!session || session.status !== "进行中") {
          return Response.json({ ok: false, message: "BP 会话不存在或已结束" }, { status: 400 });
        }
        if (!sessionMatchesMatch(session, match)) {
          return Response.json({ ok: false, message: "对阵已变更，请重新开始 BP" }, { status: 409 });
        }
        const operatorTeam = stepTeam(session);
        if (!isAdmin && operatorTeam !== teamId) {
          return Response.json({ ok: false, message: "当前轮到对方队伍操作" }, { status: 403 });
        }
        const result = advanceBP(session, { mapId, operatorRole: isAdmin ? "referee" : "team" }, pool);
        if (!result.ok || !result.session) {
          return Response.json({ ok: false, message: result.message ?? "操作失败" }, { status: 400 });
        }
        await writeEventData(eventId, "bp", { ...store, [matchId]: result.session });
        if (result.session.status === "已完成") {
          await commitBPMaps(result.session, eventId);
        }
        return Response.json({ ok: true, session: result.session, finalMaps: result.finalMaps });
      }

      case "undo": {
        if (!session || session.status !== "进行中") {
          return Response.json({ ok: false, message: "BP 会话不存在或已结束" }, { status: 400 });
        }
        if (!sessionMatchesMatch(session, match)) {
          return Response.json({ ok: false, message: "对阵已变更，请重新开始 BP" }, { status: 409 });
        }
        const last = session.actions[session.actions.length - 1];
        if (!last) {
          return Response.json({ ok: false, message: "没有可回退的操作" }, { status: 400 });
        }
        const lastTeam = last.side === "first" ? session.firstTeamId : session.secondTeamId;
        if (!isAdmin && lastTeam !== teamId) {
          return Response.json({ ok: false, message: "上一步不是本方操作，无法回退" }, { status: 403 });
        }
        const result = undoBP(session);
        if (!result.ok || !result.session) {
          return Response.json({ ok: false, message: result.message ?? "回退失败" }, { status: 400 });
        }
        await writeEventData(eventId, "bp", { ...store, [matchId]: result.session });
        return Response.json({ ok: true, session: result.session });
      }

      case "coinflip": {
        // 未建会话时先自动建会话再掷（队长/裁判均可发起）
        let active = session;
        let baseStore = store;
        if (!active) {
          const stale = baseStore[matchId];
          if (stale && !sessionMatchesMatch(stale, match)) {
            const next = { ...baseStore };
            delete next[matchId];
            baseStore = next;
          }
          const started = startBP(baseStore, { match, pool });
          if (!started.ok || !started.session) {
            return Response.json({ ok: false, message: started.message ?? "启动失败" }, { status: 400 });
          }
          active = started.session;
        } else if (!sessionMatchesMatch(active, match)) {
          return Response.json({ ok: false, message: "对阵已变更，请重新开始 BP" }, { status: 409 });
        }
        if (active.status !== "进行中") {
          return Response.json({ ok: false, message: "BP 已结束，不能交换先手" }, { status: 400 });
        }
        const swapped = Math.random() < 0.5;
        const result = swapped ? swapFirstBP(active) : { ok: true, session: active };
        if (!result.ok || !result.session) {
          return Response.json({ ok: false, message: result.message ?? "掷硬币失败" }, { status: 400 });
        }
        await writeEventData(eventId, "bp", { ...baseStore, [matchId]: result.session });
        return Response.json({ ok: true, session: result.session, swapped });
      }

      case "swap": {
        if (!isAdmin) {
          return Response.json({ ok: false, message: "只有裁判可以手动交换先手" }, { status: 403 });
        }
        if (!session || session.status !== "进行中") {
          return Response.json({ ok: false, message: "BP 会话不存在或已结束" }, { status: 400 });
        }
        if (!sessionMatchesMatch(session, match)) {
          return Response.json({ ok: false, message: "对阵已变更，请重新开始 BP" }, { status: 409 });
        }
        const result = swapFirstBP(session);
        if (!result.ok || !result.session) {
          return Response.json({ ok: false, message: result.message ?? "交换失败" }, { status: 400 });
        }
        await writeEventData(eventId, "bp", { ...store, [matchId]: result.session });
        return Response.json({ ok: true, session: result.session });
      }

      case "reset": {
        if (!isAdmin) {
          return Response.json({ ok: false, message: "只有裁判可以重置 BP" }, { status: 403 });
        }
        if (!session || session.status !== "进行中") {
          return Response.json({ ok: false, message: "BP 会话不存在或已结束" }, { status: 400 });
        }
        if (!sessionMatchesMatch(session, match)) {
          return Response.json({ ok: false, message: "对阵已变更，请重新开始 BP" }, { status: 409 });
        }
        const result = resetBP(session);
        if (!result.ok || !result.session) {
          return Response.json({ ok: false, message: result.message ?? "重置失败" }, { status: 400 });
        }
        await writeEventData(eventId, "bp", { ...store, [matchId]: result.session });
        return Response.json({ ok: true, session: result.session });
      }

      default:
        return Response.json({ ok: false, message: "未知操作" }, { status: 400 });
    }
  } catch {
    return Response.json({ ok: false, message: "操作失败，请稍后重试" }, { status: 400 });
  }
}
