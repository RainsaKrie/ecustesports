import type { NextRequest } from "next/server";
import { readEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { initialRegistration, normalizeRegistrationState, type RegistrationState } from "@/lib/scheduling/registration-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId")?.trim() ?? "";
  const config = await getSiteConfig();
  const event = config.events.find((item) => item.id === eventId && item.status !== "draft");
  if (!event) return Response.json({ message: "赛事不存在或尚未公开。" }, { status: 404 });

  const state = normalizeRegistrationState(
    await readEventData<RegistrationState>(eventId, "registration", initialRegistration()),
  );
  return Response.json({
    playerCount: state.players.filter((item) => item.status !== "已退赛").length,
    teamCount: state.teams.filter((item) => item.status !== "已退赛").length,
    playerRegistrationClosed: state.playerRegistrationClosed,
    teamRegistrationClosed: state.teamRegistrationClosed,
  });
}
