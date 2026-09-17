import type { NextRequest } from "next/server";
import { readEventData, updateEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { findParticipant, readParticipantToken, withoutParticipantSecret } from "@/lib/participant-auth";
import { RANK_VALUE } from "@/lib/scheduling/format-data";
import { emptySchedule, normalizeScheduleState, type ScheduleState } from "@/lib/scheduling/schedule-data";
import {
  initialRegistration,
  normalizeRegistrationState,
  POSITIONS,
  type Position,
  type RegistrationPlayer,
  type RegistrationState,
} from "@/lib/scheduling/registration-data";
import { isEventPublic } from "@/lib/configured-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/** 规范化擅长位置：去重、只保留合法位置、保持给定顺序。 */
function normalizePositions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || !POSITIONS.includes(trimmed as Position)) continue;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

async function resolveEvent(eventId: string) {
  const config = await getSiteConfig();
  return config.events.find((event) => event.id === eventId && isEventPublic(event) && event.status !== "archived");
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
  const schedule = normalizeScheduleState(await readEventData<ScheduleState>(eventId, "schedule", emptySchedule()));
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
  const scheduleRequests = team
    ? schedule.requests
        .filter((request) => {
          const match = schedule.matches.find((candidate) => candidate.id === request.matchId);
          return match?.teamAId === team.id || match?.teamBId === team.id;
        })
        .map((request) => {
          const match = schedule.matches.find((candidate) => candidate.id === request.matchId)!;
          return {
            ...request,
            teamAName: match.teamAName,
            teamBName: match.teamBName,
            boType: match.boType,
            phase: match.phase,
            canConfirm: Boolean(isCaptain && request.status === "待对手确认" && request.proposedByTeamId !== team.id),
            initiatedByMyTeam: request.proposedByTeamId === team.id,
          };
        })
    : [];

  return {
    player: withoutParticipantSecret(player),
    team: myTeam,
    isCaptain,
    requests,
    nextMatch,
    scheduleRequests,
    scheduleConfig: schedule.config,
    scheduleConfigConfirmed: schedule.configConfirmed,
    scheduleVersion: schedule.version,
    teams: state.teams.filter((item) => item.status !== "已退赛").map((item) => {
      const members = item.memberIds
        .map((id) => state.players.find((candidate) => candidate.id === id))
        .filter((candidate) => candidate !== undefined);
      return {
        id: item.id,
        name: item.name,
        status: item.status,
        starterCount: members.filter((candidate) => candidate.role === "首发").length,
        substituteCount: members.filter((candidate) => candidate.role === "替补").length,
        coachCount: members.filter((candidate) => candidate.role === "教练").length,
      };
    }),
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
      const phone = text(body.phone, 60);
      const positions = normalizePositions(body.positions);
      const intro = text(body.intro, 500);
      if (!gameId || !rank || !(rank in RANK_VALUE)) {
        message = "游戏 ID 和有效段位为必填项。";
        return state;
      }
      if (!qq || !phone) {
        message = "QQ 号和手机号为必填项。";
        return state;
      }
      if (positions.length === 0) {
        message = "请至少选择一个擅长位置。";
        return state;
      }
      if (state.players.some((item) => item.id !== player.id && item.gameId.toLowerCase() === gameId.toLowerCase())) {
        message = "该游戏 ID 已被其他报名使用。";
        return state;
      }
      // 选手自己更正资料后自动回到「已通过」：标记「需修改」的目的就是让他改，
      // 改完不该再由负责人手动点一次通过。
      updatedPlayer = { ...player, gameId, rank, qq, phone, positions, intro, reviewStatus: "已通过" as const };
      return { ...state, players: state.players.map((item) => item.id === player.id ? updatedPlayer! : item) };
    });
    if (message || !updatedPlayer) return Response.json({ message: message || "修改失败。" }, { status: message.includes("无效") ? 401 : 400 });
    return Response.json(await participantView(eventId, next, updatedPlayer));
  } catch {
    return Response.json({ message: "保存失败，请稍后重试。" }, { status: 400 });
  }
}
