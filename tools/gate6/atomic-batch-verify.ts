// =====================
// RPT-08 批量原子写在真实 Supabase 上的验收
//
// 为什么本地测不出来：本地 `file` 驱动用「赛事级写锁」模拟原子性，
// 而生产用 PostgreSQL 事务 + `update_app_documents_atomic`。
// 两者的失败模式不同——本地永远不会遇到「函数不存在」「40001 冲突码」
// 「advisory lock 行为」这些只有真库才有的东西。
//
// 本脚本只写**探针赛事**（`rpt08probe-xxxx`），结束时删除，不碰任何真实数据。
// 运行：node node_modules/tsx/dist/cli.mjs tools/gate6/atomic-batch-verify.ts
// =====================

import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { supabaseDataStore } from "../../src/lib/supabase-data-store";

interface Doc {
  runId: string;
  hits: string[];
  note: string;
}

const DOC_A = { name: "atomic-a", fallback: { runId: "", hits: [], note: "" } as Doc };
const DOC_B = { name: "atomic-b", fallback: { runId: "", hits: [], note: "" } as Doc };
const DOC_C = { name: "atomic-c", fallback: { runId: "", hits: [], note: "" } as Doc };

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

async function main() {
  loadEnvConfig(process.cwd(), true);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error("缺少 Supabase 配置（本脚本需要真实库，不能用本地 file 驱动）");
  }
  if (process.env.DATA_BACKEND !== "supabase") {
    // 不强制，但要说清楚：下文的 supabaseDataStore 是直接调用的，不经 DATA_BACKEND 分流。
    console.log(`  提示：DATA_BACKEND=${process.env.DATA_BACKEND ?? "(未设)"}，本脚本直接使用 supabaseDataStore。`);
  }

  const runId = randomUUID();
  const eventId = `rpt08probe-${runId.slice(0, 8)}`;
  const writeDoc = (name: string, value: Doc) => supabaseDataStore.write("event", eventId, name, value);

  console.log(`探针赛事：${eventId}`);
  console.log(`目标项目：${(process.env.SUPABASE_URL ?? "").replace(/\/rest\/v1\/?$/, "")}`);
  console.log("");

  try {
    // ---------- 1. 函数存在性 + 一次写多文档 ----------
    console.log("== 1. 批量原子写：一次提交两个文档 ==");
    await writeDoc(DOC_A.name, { runId, hits: [], note: "init" });

    const afterFirst = await supabaseDataStore.updateMany<Record<"a" | "b", Doc>>(
      "event",
      eventId,
      { a: DOC_A, b: DOC_B },
      (current) => ({
        a: { ...current.a, hits: [...current.a.hits, "first"] },
        b: { ...current.b, hits: [...current.b.hits, "first"] },
      }),
    );
    check("返回合并后的新状态", afterFirst.b.hits.length === 1, JSON.stringify(afterFirst.b.hits));

    const readB = await supabaseDataStore.read<Doc>("event", eventId, DOC_B.name, DOC_B.fallback);
    check("新文档 b 被创建（之前不存在 → version 0 → insert）", readB.hits.length === 1, JSON.stringify(readB.hits));
    const readA = await supabaseDataStore.read<Doc>("event", eventId, DOC_A.name, DOC_A.fallback);
    check("已有文档 a 被更新", readA.hits.join(",") === "first", readA.hits.join(","));

    // ---------- 2. 全或无：一个文档版本冲突，全部回滚 ----------
    console.log("");
    console.log("== 2. ★ 全或无：一个文档版本不匹配时，另一个也不能被写入 ==");
    // 人为制造「期望版本过期」：先直接改 b，使 b 的真实版本前进，
    // 然后调用 updateMany（它会重新读版本）——这条路测不出回滚。
    // 所以改为直接调 CAS 层：用一个过期的期望版本调函数。
    const { url } = (() => {
      const raw = (process.env.SUPABASE_URL ?? "").replace(/\/rest\/v1\/?$/, "");
      return { url: raw };
    })();
    const key = process.env.SUPABASE_SECRET_KEY ?? "";

    const staleVersions = { [DOC_A.name]: 0, [DOC_B.name]: 9999 }; // b 故意给个不可能的值
    const r = await fetch(`${url}/rest/v1/rpc/update_app_documents_atomic`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_scope: "event",
        p_event_id: eventId,
        p_expected_versions: staleVersions,
        p_updates: {
          [DOC_A.name]: { runId, hits: ["SHOULD-NOT-BE-WRITTEN"], note: "rollback-probe" },
          [DOC_B.name]: { runId, hits: ["SHOULD-NOT-BE-WRITTEN"], note: "rollback-probe" },
        },
      }),
    });
    const body = await r.text();
    check("版本不匹配时函数返回 false（HTTP 200 + body false）", r.status === 200 && body.trim() === "false",
      `HTTP ${r.status} body=${body.slice(0, 60)}`);

    const afterRollbackA = await supabaseDataStore.read<Doc>("event", eventId, DOC_A.name, DOC_A.fallback);
    check("★ a 未被写入（回滚生效）", !afterRollbackA.hits.includes("SHOULD-NOT-BE-WRITTEN"), afterRollbackA.hits.join(","));
    const afterRollbackB = await supabaseDataStore.read<Doc>("event", eventId, DOC_B.name, DOC_B.fallback);
    check("★ b 未被写入（回滚生效）", !afterRollbackB.hits.includes("SHOULD-NOT-BE-WRITTEN"), afterRollbackB.hits.join(","));

    // ---------- 3. 并发：30 个批量写不丢更新 ----------
    console.log("");
    console.log("== 3. ★ 并发 30 个批量写，验证重试收敛且不丢更新 ==");

    // 用「版本增量」而不是绝对值来判断——绝对版本受前面步骤影响，容易写出假断言。
    const versionOf = async (name: string) => {
      const res = await fetch(
        `${url}/rest/v1/app_documents?scope=eq.event&event_id=eq.${eventId}&name=eq.${name}&select=version`,
        { headers: { Authorization: `Bearer ${key}`, apikey: key } },
      );
      const rows = (await res.json()) as Array<{ version: number }>;
      return rows[0]?.version ?? -1;
    };
    const verBeforeA = await versionOf(DOC_A.name);
    const verBeforeB = await versionOf(DOC_B.name);

    const CONCURRENCY = 30;
    // 显式标注 string[]：randomUUID() 返回模板字面量类型，
    // 与字面量 "first" 比较时 TS 会判为「无重叠」而报错。
    const ids: string[] = Array.from({ length: CONCURRENCY }, () => randomUUID());
    const started = performance.now();
    const results = await Promise.allSettled(
      ids.map((id) =>
        supabaseDataStore.updateMany<Record<"a" | "b", Doc>>(
          "event",
          eventId,
          { a: DOC_A, b: DOC_B },
          (current) => ({
            a: { ...current.a, hits: current.a.hits.includes(id) ? current.a.hits : [...current.a.hits, id] },
            b: { ...current.b, hits: current.b.hits.includes(id) ? current.b.hits : [...current.b.hits, id] },
          }),
        ),
      ),
    );
    const elapsed = Math.round(performance.now() - started);
    const rejected = results.filter((x) => x.status === "rejected");
    const errs = [...new Set(rejected.map((x) => (x.status === "rejected" && x.reason instanceof Error ? x.reason.message : "unknown")))];
    console.log(`    耗时 ${elapsed}ms，成功 ${results.length - rejected.length}，失败 ${rejected.length}`);
    if (errs.length) console.log(`    错误: ${errs.slice(0, 3).join(" | ")}`);
    check("全部成功（无 40001 逃逸、无重试耗尽）", rejected.length === 0, errs.join(" | "));

    const finA = await supabaseDataStore.read<Doc>("event", eventId, DOC_A.name, DOC_A.fallback);
    const finB = await supabaseDataStore.read<Doc>("event", eventId, DOC_B.name, DOC_B.fallback);
    const uniqA = new Set(finA.hits);
    const uniqB = new Set(finB.hits);
    const missingA = ids.filter((x) => !uniqA.has(x) && x !== "first");
    check("文档 a 无丢更新", uniqA.size === finA.hits.length && missingA.length === 0,
      `hits=${finA.hits.length} uniq=${uniqA.size} 缺=${missingA.length}`);
    check("文档 b 无丢更新", uniqB.size === finB.hits.length && ids.filter((x) => !uniqB.has(x)).length === 0,
      `hits=${finB.hits.length} uniq=${uniqB.size}`);
    check("a 与 b 的命中集合一致（同一次批量写要么都生效要么都不生效）",
      uniqA.size === uniqB.size, `a=${uniqA.size} b=${uniqB.size}`);

    // ---------- 4. 版本递增次数 = 成功写入次数 ----------
    console.log("");
    console.log("== 4. 版本增量恰好等于成功次数（不重复 +1、不倒退）==");
    const verAfterA = await versionOf(DOC_A.name);
    const verAfterB = await versionOf(DOC_B.name);
    const deltaA = verAfterA - verBeforeA;
    const deltaB = verAfterB - verBeforeB;
    console.log(`    a: ${verBeforeA} → ${verAfterA}（+${deltaA}）`);
    console.log(`    b: ${verBeforeB} → ${verAfterB}（+${deltaB}）`);
    check("a 的版本增量 = 并发数", deltaA === CONCURRENCY, `+${deltaA} vs ${CONCURRENCY}`);
    check("b 的版本增量 = 并发数", deltaB === CONCURRENCY, `+${deltaB} vs ${CONCURRENCY}`);
    check("两个文档的递增次数相同", deltaA === deltaB, `a+${deltaA} b+${deltaB}`);

    // ---------- 5. 三文档同批（更接近裁判报分的真实形状）----------
    console.log("");
    console.log("== 5. 三文档同批写（接近裁判报分：赛程 + 赛果 + 证据）==");
    const three = await supabaseDataStore.updateMany<Record<"a" | "b" | "c", Doc>>(
      "event",
      eventId,
      { a: DOC_A, b: DOC_B, c: DOC_C },
      (current) => ({
        a: { ...current.a, note: "three-way" },
        b: { ...current.b, note: "three-way" },
        c: { ...current.c, hits: ["three"], note: "three-way" },
      }),
    );
    check("三文档一次性提交成功", three.c.note === "three-way" && three.a.note === "three-way");
    const readC = await supabaseDataStore.read<Doc>("event", eventId, DOC_C.name, DOC_C.fallback);
    check("第三个文档 c 已落库", readC.note === "three-way", readC.note);

    // ---------- 6. 真实并发度下的耗时（供判断比赛日是否够快）----------
    // 30 并发是压力上限，比赛日同时报分的场次远少于此。
    // 这个数字比「30 并发 15 秒」更能回答「实际用起来会不会卡」。
    console.log("");
    console.log("== 6. 真实并发度耗时（5 并发，接近比赛日同时报分）==");
    for (const n of [1, 5]) {
      const batch = Array.from({ length: n }, () => randomUUID());
      const t0 = performance.now();
      const rs = await Promise.allSettled(
        batch.map((id) =>
          supabaseDataStore.updateMany<Record<"a" | "b", Doc>>(
            "event",
            eventId,
            { a: DOC_A, b: DOC_B },
            (cur) => ({ a: { ...cur.a, hits: [...cur.a.hits, id] }, b: { ...cur.b, hits: [...cur.b.hits, id] } }),
          ),
        ),
      );
      const ms = Math.round(performance.now() - t0);
      const bad = rs.filter((x) => x.status === "rejected").length;
      const verdict = ms < 3000 ? "✓ 可接受" : "!! 偏慢，值得关注";
      console.log(`    ${n} 个并发写：${ms}ms，失败 ${bad}  ${verdict}`);
      check(`${n} 并发全部成功`, bad === 0, `失败 ${bad}`);
      if (n === 5) check("5 并发耗时 < 3 秒（比赛日可接受）", ms < 3000, `${ms}ms`);
    }
  } finally {
    await supabaseDataStore.deleteEvent(eventId);
    console.log("");
    console.log(`已清理探针赛事 ${eventId}`);
  }

  console.log("");
  console.log(`结果：通过 ${pass} / ${pass + fail}`);
  if (fail > 0) process.exitCode = 2;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "RPT-08 批量原子写验收失败");
  process.exitCode = 1;
});
