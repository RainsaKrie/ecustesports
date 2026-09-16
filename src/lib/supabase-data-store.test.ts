// Supabase 读取层对「时钟偏差故障」的重试行为。
//
// 背景（2026-09-16 生产构建失败根因）：
// Supabase 平台在请求时现场铸造 token，其 `iat` 可能比 PostgREST 的验证时钟快 30 秒以上。
// PostgREST 只容忍 30 秒偏差，于是返回 `401 {"code":"PGRST303","message":"JWT issued at future"}`。
// 这是平台侧故障（status.supabase.com 有专门的 incident），**同一 token 等一两秒即可通过**。
//
// 因此读取层必须：① 对 PGRST303 等待后重试；② 对其它 401 立即失败（否则会把
// 「凭证配错」伪装成「偶发网络抖动」，排查难度大幅上升）。
//
// 本测试用 mock fetch 驱动，不发真实请求。
import { supabaseDataStore } from "./supabase-data-store";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`✓ ${label}`);
  } else {
    failed += 1;
    console.error(`✗ ${label}${detail ? `（${detail}）` : ""}`);
  }
}

const GOOD_PAYLOAD = { hello: "world" };
const GOOD_ROW = [{ payload: GOOD_PAYLOAD, version: 3 }];
const DOC_NAME = "site-config";
const FALLBACK = { hello: "fallback" };

// —— 预设响应 ——
const clockSkew = () =>
  Response.json({ code: "PGRST303", message: "JWT issued at future" }, { status: 401 });
const unknownSigningKey = () =>
  Response.json({ code: "PGRST301", message: "JWSError" }, { status: 401 });
const plainUnauthorized = () => Response.json({ message: "invalid api key" }, { status: 401 });
const rateLimited = () => Response.json({ message: "rate limited" }, { status: 429 });
const serverError = () => new Response("boom", { status: 500 });
const ok = () => Response.json(GOOD_ROW);

interface ReadOutcome {
  calls: number;
  elapsedMs: number;
  value?: { hello: string };
  error?: Error;
}

/**
 * 用一串预设响应驱动一次 supabaseDataStore.read。
 * steps 会按调用次数依次取用，用尽后重复最后一个 —— 这样「一直失败」只需给一个 step。
 */
async function runRead(steps: Array<() => Response>): Promise<ReadOutcome> {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalSecret = process.env.SUPABASE_SECRET_KEY;

  process.env.SUPABASE_URL = "https://clock-skew-test.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "unit-test-secret";

  let calls = 0;
  globalThis.fetch = async () => {
    const step = steps[Math.min(calls, steps.length - 1)];
    calls += 1;
    return step();
  };

  const started = Date.now();
  try {
    const value = await supabaseDataStore.read("site", "__site__", DOC_NAME, FALLBACK);
    return { calls, elapsedMs: Date.now() - started, value };
  } catch (error) {
    return { calls, elapsedMs: Date.now() - started, error: error as Error };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecret;
  }
}

async function main(): Promise<void> {
  console.log("== 时钟偏差（PGRST303）：必须等待后重试 ==");

  const retried = await runRead([clockSkew, ok]);
  check("PGRST303 会被重试并最终成功", retried.calls === 2 && retried.error === undefined,
    `calls=${retried.calls} err=${retried.error?.message ?? "-"}`);
  check("成功时返回真实数据而非兜底值",
    JSON.stringify(retried.value) === JSON.stringify(GOOD_PAYLOAD), JSON.stringify(retried.value));
  // 普通重试是 80/180ms，跨不过时钟偏差窗口 —— 这里断言等待明显更长。
  check("重试等待明显长于普通重试（≥900ms）", retried.elapsedMs >= 900, `${retried.elapsedMs}ms`);

  const exhausted = await runRead([clockSkew]);
  check("PGRST303 持续存在时最终抛错（不会无限重试）", exhausted.error !== undefined);
  check("抛错前尝试次数超过普通上限 3（说明切换到了更宽的策略）", exhausted.calls === 4,
    `calls=${exhausted.calls}`);

  console.log("");
  console.log("== 其它 401：必须立即失败（不能掩盖真实配置错误）==");

  const wrongKey = await runRead([unknownSigningKey, ok]);
  check("PGRST301（签名密钥不对）立即抛错、不重试", wrongKey.calls === 1 && wrongKey.error !== undefined,
    `calls=${wrongKey.calls}`);

  const plain = await runRead([plainUnauthorized, ok]);
  check("无错误码的 401 立即抛错、不重试", plain.calls === 1 && plain.error !== undefined,
    `calls=${plain.calls}`);
  check("错误消息带 HTTP 状态码，便于定位",
    /HTTP 401/.test(plain.error?.message ?? ""), plain.error?.message?.slice(0, 60));

  console.log("");
  console.log("== 原有重试行为未被改坏 ==");

  const limited = await runRead([rateLimited, ok]);
  check("429 仍然重试", limited.calls === 2 && limited.error === undefined, `calls=${limited.calls}`);

  const boom = await runRead([serverError, ok]);
  check("5xx 仍然重试", boom.calls === 2 && boom.error === undefined, `calls=${boom.calls}`);

  console.log(`\n结果：通过 ${passed} / ${passed + failed}`);
  if (failed > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
