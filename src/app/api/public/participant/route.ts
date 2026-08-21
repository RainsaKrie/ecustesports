import type { NextRequest } from "next/server";
import { readEventData, updateEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { findParticipant, readParticipantToken, withoutParticipantSecret } from "@/lib/participant-auth";
import { RANK_VALUE } from "@/lib/scheduling/format-data";
import { emptySchedule, type ScheduleState } from "@/lib/scheduling/schedule-data";
import {
  initialRegistration,
  normalizeRegistrationState,
  type RegistrationPlayer,
  type RegistrationState,
} from "@/lib/scheduling/registration-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

async function resolveEvent(eventId: string) {
  const config = await getSiteConfig();
  return config.events.find((event) => event.id === eventId && event.status !== "draft" && event.status !== "archived");
}

async function participantView(eventId: string, state: RegistrationState, player: RegistrationPlayer) {
  const team = player.teamId ? state.teams.find((item) => item.id === player.teamId) : undefined;
  const isCaptain = team?.captainId === player.id;
  const relevantRequests = (state.teamRequests ?? []).filter((request) =>
    request.playerId === player.id || (isCaptain && request.teamId === team?.id),
  );
  const requests = relevantRequests.map((request) => {
    const requestTeam = state.teams.find((candidate) => candidate.id === request.teamId);
    const requestPlayer = state.players.find((candidate) => candidate.id === request.playerId);
    const canResolve = request.type === "application"
      ? Boolean(isCaptain && request.teamId === team?.id)
      : request.playerId === player.id;
    return {
      ...request,
      canResolve,
      direction: canResolve ? "incoming" as const : "outgoing" as const,
      teamName: requestTeam?.name ?? "未知队伍",
      playerGameId: requestPlayer?.gameId ?? "未知选手",
    };
  });
  const schedule = await readEventData<ScheduleState>(eventId, "schedule", emptySchedule());
  const nextMatch = team
    ? [...schedule.matches]
        .filter((match) => match.status !== "已完成" && (match.teamAId === team.id || match.teamBId === team.id))
        .sort((a, b) => (a.startTime || "9999").localeCompare(b.startTime || "9999"))[0]
    : undefined;
  const myTeam = team ? {
    ...team,
    members: team.memberIds.map((id) => state.players.find((candidate) => candidate.id === id)).filter(Boolean).map((member) => ({
      id: member!.id,
      gameId: member!.gameId,
      rank: member!.rank,
      role: member!.role,
    })),
  } : undefined;

  return {
    player: withoutParticipantSecret(player),
    team: myTeam,
    isCaptain,
    requests,
    nextMatch,
    teams: state.teams.filter((item) => item.status !== "已退赛").map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      starterCount: item.memberIds.filter((id) => state.players.find((candidate) => candidate.id === id)?.role === "首发").length,
    })),
    teamRegistrationClosed: state.teamRegistrationClosed,
  };
}

export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId")?.trim() ?? "";
  if (!await resolveEvent(eventId)) return Response.json({ message: "赛事不存在或尚未公开。" }, { status: 404 });
  const token = readParticipantToken(request);
  const state = normalizeRegistrationState(
    await readEventData<RegistrationState>(eventId, "registration", initialRegistration()),
  );
  const player = findParticipant(state, token);
  if (!player) return Response.json({ message: "参赛管理码无效。" }, { status: 401 });
  return Response.json(await participantView(eventId, state, player));
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const eventId = text(body.eventId, 60) ?? "";
    if (!await resolveEvent(eventId)) return Response.json({ message: "赛事不存在或尚未公开。" }, { status: 404 });
    const token = readParticipantToken(request);
    let message = "";
    let updatedPlayer: RegistrationPlayer | undefined;
    const next = await updateEventData<RegistrationState>(eventId, "registration", initialRegistration(), (stored) => {
      const state = normalizeRegistrationState(stored);
      const player = findParticipant(state, token);
      if (!player) {
        message = "参赛管理码无效。";
        return state;
      }
      const gameId = text(body.gameId, 40);
      const rank = text(body.rank, 20);
      const qq = text(body.qq, 60);
      const wechat = text(body.wechat, 60);
      const phone = text(body.phone, 60);
      const college = text(body.college, 60);
      if (!gameId || !rank || !(rank in RANK_VALUE)) {
        message = "游戏 ID 和有效段位为必填项。";
        return state;
      }
      if (!qq && !wechat && !phone) {
        message = "请至少保留一种联系方式。";
        return state;
      }
      if (state.players.some((item) => item.id !== player.id && item.gameId.toLowerCase() === gameId.toLowerCase())) {
        message = "该游戏 ID 已被其他报名使用。";
        return state;
      }
      updatedPlayer = { ...player, gameId, rank, qq, wechat, phone, college };
      return { ...state, players: state.players.map((item) => item.id === player.id ? updatedPlayer! : item) };
    });
    if (message || !updatedPlayer) return Response.json({ message: message || "修改失败。" }, { status: message.includes("无效") ? 401 : 400 });
    return Response.json(await participantView(eventId, next, updatedPlayer));
  } catch {
    return Response.json({ message: "保存失败，请稍后重试。" }, { status: 400 });
  }
}
