import { isHostedRuntime } from "@/lib/deployment";
import { readData } from "@/lib/data-store";
import { normalizeSupabaseProjectUrl } from "@/lib/supabase-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 健康接口的能力边界（SYS-02 §1）：
 *
 * 这个接口只回答「服务端能不能读到数据、能不能访问对象存储」，
 * 不证明业务逻辑正确，也不证明前端可用、域名解析正常或网络通畅。
 * 200 只代表后端依赖可用，不代表赛事功能正常。
 *
 * 输出只保留能力级别的状态（database / storage），
 * 不含 URL、密钥、表名、bucket 名、错误信息或堆栈。
 */
type CheckState = "ok" | "down";

async function checkDatabase(): Promise<CheckState> {
  try {
    await readData("__health__", null);
    return "ok";
  } catch {
    return "down";
  }
}

async function checkStorage(): Promise<CheckState> {
  if (!isHostedRuntime()) return "ok";
  try {
    const url = normalizeSupabaseProjectUrl(process.env.SUPABASE_URL);
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secret) return "down";
    const response = await fetch(`${url}/storage/v1/bucket/event-assets`, {
      headers: { apikey: secret, Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    return response.ok ? "ok" : "down";
  } catch {
    return "down";
  }
}

export async function GET() {
  const checks = {
    database: await checkDatabase(),
    storage: await checkStorage(),
  };
  const ok = checks.database === "ok" && checks.storage === "ok";
  return Response.json(
    { ok, checks },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
