import type { NextRequest } from "next/server";
import { isEventPublic } from "@/lib/configured-events";
import {
  getPublicRegistration,
  getPublicSiteConfig,
  PUBLIC_CACHE_CONTROL,
} from "@/lib/public-data-cache";
import { selectPublicRoster } from "@/lib/domains/schedule/public-roster";
import { withApiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId")?.trim() ?? "";
  const config = await getPublicSiteConfig();
  const event = config.events.find((item) => item.id === eventId && isEventPublic(item));
  if (!event) return Response.json({ message: "赛事不存在或尚未公开。" }, { status: 404 });

  const state = await getPublicRegistration(eventId);
  // 公开页面只给「可以对外公布」的那部分名单（规则集中在 public-roster.ts）：
  // 退赛的，以及正式名单公布后仍未满编的队伍与选手，不出现在公开数据里。
  // 数据本身一条未删 —— 后台仍完整可见。
  const { teams: activeTeams, players: activePlayers } = selectPublicRoster(state);
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

export const GET = withApiError(handleGET);
