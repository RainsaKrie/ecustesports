// =====================
// BP 会话接口
// GET 公开读取；POST 为公开写接口，但服务端按操作校验身份：
// - 双方队长（参赛管理码鉴权）可推进本方步骤、启动、掷硬币、回退本方上一步
// - 管理员（会话 cookie）可代任意操作、手动交换先手、重置
// =====================

import { readEventData, updateEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { findParticipant, readParticipantToken } from "@/lib/participant-auth";
import type { NextRequest } from "next/server";
import {
  emptySchedule,
  normalizeScheduleState,
  type ScheduleState,
} from "@/lib/scheduling/schedule-data";
import {
  initialRegistration,
  normalizeRegistrationState,
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

/** 判定请求者身份：管理员（cookie）或参赛管理码所属队伍。 */
async function resolveRequester(
  request: NextRequest,
  eventId: string,
): Promise<{ admin: boolean; playerId?: string; teamId?: string; isCaptain?: boolean }> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const admin = verifySessionToken(token);
  if (admin) return { admin };

  const reg = normalizeRegistrationState(
    await readEventData<RegistrationState>(eventId, "registration", initialRegistration()),
  );
  const player = findParticipant(reg, readParticipantToken(request));
  if (!player?.teamId) return { admin: false, playerId: player?.id };
  const team = reg.teams.find((t) => t.id === player.teamId);
  return { admin: false, playerId: player.id, teamId: team?.id, isCaptain: team?.captainId === player.id };
}

/** 完成 BP 后：把选图写入比赛记录 + 生成通知草稿 */
async function commitBPMaps(session: BPSession, eventId: string) {
  if (!session.finalMaps || session.finalMaps.length === 0) return;
  await updateEventData<ScheduleState>(eventId, "schedule", emptySchedule(), (raw) => {
    const schedule = normalizeScheduleState(raw);
    const match = schedule.matches.find((m) => m.id === session.matchId);
    if (!match) return schedule;
    const alreadyCommitted = Array.isArray(match.bpMaps)
      && match.bpMaps.length === session.finalMaps!.length
      && match.bpMaps.every((map, index) => map === session.finalMaps![index]);
    if (alreadyCommitted) return schedule;
    const notification = {
      id: `NT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      version: schedule.version,
      content: `【BP 完成】${match.id} ${match.teamAName} vs ${match.teamBName} 比赛地图：${session.finalMaps!.join("、")}。请裁判与双方确认后开赛。`,
      status: "草稿" as const,
      createdAt: new Date().toISOString(),
    };
    return {
      ...schedule,
      matches: schedule.matches.map((candidate) => candidate.id === session.matchId
        ? { ...candidate, bpMaps: session.finalMaps }
        : candidate),
      notifications: [notification, ...schedule.notifications],
    };
  });
}

class BPRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function fail(message: string, status = 400): never {
  throw new BPRequestError(message, status);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const matchId = url.searchParams.get("matchId")?.trim() ?? "";
  const eventId = url.searchParams.get("eventId")?.trim() ?? "";
  const config = await getSiteConfig();
  if (!eventId || !config.events.some((event) => event.id === eventId)) {
    return Response.json({ message: "赛事不存在或缺少赛事 ID。" }, { status: 404 });
  }
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
    const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";

    const config = await getSiteConfig();
    const event = config.events.find((candidate) => candidate.id === eventId);
    if (!eventId || !event) {
      return Response.json({ ok: false, message: "赛事不存在或缺少赛事 ID" }, { status: 400 });
    }
    const requester = await resolveRequester(request, eventId);
    const pool = event.mapPool.map((m) => m.name);
    const schedule = await readEventData<ScheduleState>(eventId, "schedule", emptySchedule());
    const match = schedule.matches.find((m) => m.id === matchId);

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

    let outputSession: BPSession | undefined;
    let outputFinalMaps: string[] | undefined;
    let outputSwapped: boolean | undefined;

    await updateEventData<BPStore>(eventId, "bp", {}, (latestStore) => {
      const store = { ...latestStore };
      const session = store[matchId];

      switch (action) {
        case "start": {
          if (session && !sessionMatchesMatch(session, match)) delete store[matchId];
          const result = startBP(store, { match, pool });
          if (!result.ok || !result.session) fail(result.message ?? "启动失败");
          outputSession = result.session;
          return { ...store, [matchId]: result.session };
        }
        case "advance": {
          if (!session || session.status !== "进行中") fail("BP 会话不存在或已结束");
          if (!sessionMatchesMatch(session, match)) fail("对阵已变更，请重新开始 BP", 409);
          if (!isAdmin && stepTeam(session) !== teamId) fail("当前轮到对方队伍操作", 403);
          const result = advanceBP(session, { mapId, operatorRole: isAdmin ? "referee" : "team" }, pool);
          if (!result.ok || !result.session) fail(result.message ?? "操作失败");
          outputSession = result.session;
          outputFinalMaps = result.finalMaps;
          return { ...store, [matchId]: result.session };
        }
        case "undo": {
          if (!session || session.status !== "进行中") fail("BP 会话不存在或已结束");
          if (!sessionMatchesMatch(session, match)) fail("对阵已变更，请重新开始 BP", 409);
          const last = session.actions[session.actions.length - 1];
          if (!last) fail("没有可回退的操作");
          const lastTeam = last.side === "first" ? session.firstTeamId : session.secondTeamId;
          if (!isAdmin && lastTeam !== teamId) fail("上一步不是本方操作，无法回退", 403);
          const result = undoBP(session);
          if (!result.ok || !result.session) fail(result.message ?? "回退失败");
          outputSession = result.session;
          return { ...store, [matchId]: result.session };
        }
        case "coinflip": {
          let active: BPSession | undefined = session;
          if (active && !sessionMatchesMatch(active, match)) {
            delete store[matchId];
            active = undefined;
          }
          if (!active) {
            const started = startBP(store, { match, pool });
            if (!started.ok || !started.session) fail(started.message ?? "启动失败");
            active = started.session;
          }
          if (active.status !== "进行中") fail("BP 已结束，不能交换先手");
          outputSwapped = Math.random() < 0.5;
          const result = outputSwapped ? swapFirstBP(active) : { ok: true, session: active };
          if (!result.ok || !result.session) fail(result.message ?? "掷硬币失败");
          outputSession = result.session;
          return { ...store, [matchId]: result.session };
        }
        case "swap": {
          if (!isAdmin) fail("只有裁判可以手动交换先手", 403);
          if (!session || session.status !== "进行中") fail("BP 会话不存在或已结束");
          if (!sessionMatchesMatch(session, match)) fail("对阵已变更，请重新开始 BP", 409);
          const result = swapFirstBP(session);
          if (!result.ok || !result.session) fail(result.message ?? "交换失败");
          outputSession = result.session;
          return { ...store, [matchId]: result.session };
        }
        case "reset": {
          if (!isAdmin) fail("只有裁判可以重置 BP", 403);
          if (!session || session.status !== "进行中") fail("BP 会话不存在或已结束");
          if (!sessionMatchesMatch(session, match)) fail("对阵已变更，请重新开始 BP", 409);
          const result = resetBP(session);
          if (!result.ok || !result.session) fail(result.message ?? "重置失败");
          outputSession = result.session;
          return { ...store, [matchId]: result.session };
        }
        default:
          fail("未知操作");
      }
    });

    if (!outputSession) fail("操作未产生有效状态", 500);
    if (action === "advance" && outputSession.status === "已完成") {
      await commitBPMaps(outputSession, eventId);
    }
    return Response.json({
      ok: true,
      session: outputSession,
      ...(outputFinalMaps ? { finalMaps: outputFinalMaps } : {}),
      ...(outputSwapped !== undefined ? { swapped: outputSwapped } : {}),
    });
  } catch (error) {
    if (error instanceof BPRequestError) {
      return Response.json({ ok: false, message: error.message }, { status: error.status });
    }
    return Response.json({ ok: false, message: "操作失败，请稍后重试" }, { status: 500 });
  }
}
