import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileDataStore } from "./file-data-store";
import { supabaseDataStore } from "./supabase-data-store";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    passed += 1;
    console.log(`✓ ${label}`);
  } else {
    failed += 1;
    console.error(`✗ ${label}`);
  }
}

type BatchFixture = {
  left: { count: number };
  right: { count: number };
  guard: { revision: number };
};

const documents = {
  left: { name: "atomic-left", fallback: { count: 0 } },
  right: { name: "atomic-right", fallback: { count: 0 } },
  guard: { name: "atomic-guard", fallback: { revision: 7 } },
};

const eventId = `test-atomic-${process.pid}`;
const rollbackEventId = `test-atomic-rollback-${process.pid}`;

async function verifySupabaseBatchContract(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalSecret = process.env.SUPABASE_SECRET_KEY;
  let rpcAttempts = 0;
  let updaterCalls = 0;
  let lastRpcBody: Record<string, unknown> = {};

  process.env.SUPABASE_URL = "https://unit-test.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "unit-test-secret";
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname.endsWith("/rest/v1/app_documents")) {
      const name = (url.searchParams.get("name") ?? "").replace(/^eq\./, "");
      const fixtures: Record<string, { payload: unknown; version: number }> = {
        "atomic-left": { payload: { count: 5 }, version: 2 },
        "atomic-right": { payload: { count: 9 }, version: 4 },
        "atomic-guard": { payload: { revision: 7 }, version: 6 },
      };
      return Response.json(fixtures[name] ? [fixtures[name]] : []);
    }
    if (url.pathname.endsWith("/rest/v1/rpc/update_app_documents_atomic")) {
      rpcAttempts += 1;
      lastRpcBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (rpcAttempts === 1) {
        return Response.json(
          { code: "40001", message: "atomic document version conflict" },
          { status: 409 },
        );
      }
      return Response.json(true);
    }
    return new Response("unexpected request", { status: 500 });
  };

  try {
    const result = await supabaseDataStore.updateMany<BatchFixture>("event", "event-1", documents, (current) => {
      updaterCalls += 1;
      return {
        left: { count: current.left.count + 1 },
        right: { count: current.right.count + 1 },
      };
    });
    const expected = lastRpcBody.p_expected_versions as Record<string, number>;
    const updates = lastRpcBody.p_updates as Record<string, unknown>;
    check("Supabase 40001 冲突会重读并重试整组更新", rpcAttempts === 2 && updaterCalls === 2);
    check("Supabase 请求携带全部文档版本", expected["atomic-left"] === 2 && expected["atomic-right"] === 4 && expected["atomic-guard"] === 6);
    check("只读前置文档不会被无意义写回", !("atomic-guard" in updates));
    check("Supabase 返回提交后的合并快照", result.left.count === 6 && result.right.count === 10 && result.guard.revision === 7);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecret;
  }
}

async function main(): Promise<void> {
  try {
    console.log("== 多文档原子更新 ==");
    const first = await fileDataStore.updateMany<BatchFixture>("event", eventId, documents, (current) => ({
      left: { count: current.left.count + 1 },
      right: { count: current.right.count + 1 },
    }));
    check("一次更新同时写入两个文档", first.left.count === 1 && first.right.count === 1);
    check("只读前置文档保留在一致快照中", first.guard.revision === 7);

    await Promise.all(Array.from({ length: 20 }, () =>
      fileDataStore.updateMany<BatchFixture>("event", eventId, documents, (current) => ({
        left: { count: current.left.count + 1 },
        right: { count: current.right.count + 1 },
      })),
    ));
    const left = await fileDataStore.read("event", eventId, "atomic-left", { count: -1 });
    const right = await fileDataStore.read("event", eventId, "atomic-right", { count: -1 });
    check("20 个并发更新不丢失", left.count === 21 && right.count === 21);
    check("并发后两个文档保持一致", left.count === right.count);

    console.log("\n== 失败回滚 ==");
    const rollbackDocuments = {
      left: { name: "atomic-left", fallback: { count: 0 } },
      blocked: { name: "blocked", fallback: { count: 0 } },
    };
    await fileDataStore.write("event", rollbackEventId, "atomic-left", { count: 5 });
    await mkdir(path.join(process.cwd(), "data", "events", rollbackEventId, "blocked.json"), { recursive: true });
    let rejected = false;
    try {
      await fileDataStore.updateMany("event", rollbackEventId, rollbackDocuments, () => ({
        left: { count: 6 },
        blocked: { count: 1 },
      }));
    } catch {
      rejected = true;
    }
    const restored = await fileDataStore.read("event", rollbackEventId, "atomic-left", { count: -1 });
    check("任一文档写入失败会拒绝整次操作", rejected);
    check("失败后已写文档恢复原值", restored.count === 5);

    console.log("\n== Supabase 原子调用契约 ==");
    await verifySupabaseBatchContract();
  } finally {
    await fileDataStore.deleteEvent(eventId);
    await fileDataStore.deleteEvent(rollbackEventId);
  }

  console.log(`\n结果：通过 ${passed} / ${passed + failed}`);
  if (failed > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
