import { readEventData, writeEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { initialRegistration, normalizeRegistrationState } from "@/lib/scheduling/registration-data";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveEventId(request: NextRequest): Promise<string> {
  const fromQuery = request.nextUrl.searchParams.get("eventId");
  if (fromQuery) return fromQuery;
  const config = await getSiteConfig();
  return config.currentEventId;
}

export async function GET(request: NextRequest) {
  const eventId = await resolveEventId(request);
  const stored = await readEventData(eventId, "registration", initialRegistration());
  return Response.json(normalizeRegistrationState(stored));
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 2_000_000) {
      return Response.json({ message: "数据过大" }, { status: 413 });
    }
    const eventId = await resolveEventId(request);
    await writeEventData(eventId, "registration", normalizeRegistrationState(await request.json()));
    return Response.json({ message: "saved" });
  } catch {
    return Response.json({ message: "保存失败" }, { status: 400 });
  }
}
