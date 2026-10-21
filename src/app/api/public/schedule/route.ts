import type { NextRequest } from "next/server";
import { isEventPublic } from "@/lib/configured-events";
import { withApiError } from "@/lib/api-error";
import {
  getPublicSchedule,
  getPublicSiteConfig,
  PUBLIC_CACHE_CONTROL,
} from "@/lib/public-data-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId")?.trim() ?? "";
  const config = await getPublicSiteConfig();
  const event = config.events.find((item) => item.id === eventId && isEventPublic(item));
  if (!event) return Response.json({ message: "赛事不存在或尚未公开。" }, { status: 404 });
  const state = await getPublicSchedule(eventId);
  return Response.json(
    { version: state.version, matches: state.matches },
    { headers: { "Cache-Control": PUBLIC_CACHE_CONTROL } },
  );
}

export const GET = withApiError(handleGET);
