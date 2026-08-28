import { isHostedRuntime } from "@/lib/deployment";
import { readData } from "@/lib/data-store";
import { normalizeSupabaseProjectUrl } from "@/lib/supabase-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function storageAvailable(): Promise<boolean> {
  if (!isHostedRuntime()) return true;
  const url = normalizeSupabaseProjectUrl(process.env.SUPABASE_URL);
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return false;
  const response = await fetch(`${url}/storage/v1/bucket/event-assets`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
    cache: "no-store",
  });
  return response.ok;
}

export async function GET() {
  try {
    await readData("__health__", null);
    if (!(await storageAvailable())) throw new Error("storage unavailable");
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("health check failed", error);
    return Response.json(
      { ok: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
