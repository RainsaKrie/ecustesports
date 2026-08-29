import type { NextRequest } from "next/server";
import { isEventPublic } from "@/lib/configured-events";
import {
  getPublicRegistration,
  getPublicSiteConfig,
  PUBLIC_CACHE_CONTROL,
} from "@/lib/public-data-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId")?.trim() ?? "";
  const config = await getPublicSiteConfig();
  const event = config.events.find((item) => item.id === eventId && isEventPublic(item));
  if (!event) return Response.json({ message: "赛事不存在或尚未公开。" }, { status: 404 });

  const state = await getPublicRegistration(eventId);
  const activePlayers = state.players.filter((item) => item.status !== "已退赛");
  const activeTeams = state.teams.filter((item) => item.status !== "已退赛");
  const playerById = new Map(activePlayers.map((player) => [player.id, player]));
  const teamById = new Map(activeTeams.map((team) => [team.id, team]));

  return Response.json(
    {
      playerCount: activePlayers.length,
      teamCount: activeTeams.length,
      players: activePlayers.map((player) => ({
        id: player.id,
        gameId: player.gameId,
        rank: player.rank,
        teamName: player.teamId ? teamById.get(player.teamId)?.name : undefined,
        role: player.role,
        status: player.teamId ? "已入队" : "待组队",
      })),
      teams: activeTeams.map((team) => {
        const members = team.memberIds
          .map((playerId) => playerById.get(playerId))
          .filter((player): player is NonNullable<typeof player> => Boolean(player));
        return {
          id: team.id,
          name: team.name,
          status: team.status,
          starterCount: members.filter((player) => player.role === "首发").length,
          members: members.map((player) => ({
            gameId: player.gameId,
            role: player.role ?? "首发",
          })),
        };
      }),
      playerRegistrationClosed: state.playerRegistrationClosed,
      teamRegistrationClosed: state.teamRegistrationClosed,
    },
    { headers: { "Cache-Control": PUBLIC_CACHE_CONTROL } },
  );
}
