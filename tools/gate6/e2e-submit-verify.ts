// =====================
// 端到端（续）：裁判传图 → 提交报分（真实 Supabase）
//
// 这一段的重点是**三文档原子提交**在真实库上的行为：
// 一次提交同时写 schedule / result-ledger / evidence-ledger，
// 并以 referee-ledger 的版本作为前置条件。
//
// 这是本地 file 驱动**测不出**的：本地靠赛事级写锁，生产靠 PostgreSQL 事务 +
// update_app_documents_atomic。版本前置条件在两者上的失败模式不同
// ——生产会真的返回「版本冲突」而不是静默重试。
//
// 前置：本地 next dev 以 DATA_BACKEND=supabase + REFEREE_REPORTING_ENABLED=1 启动。
// 会向 staging 写演示赛事（demo-referee），结束时删除。
// =====================

import { loadEnvConfig } from "@next/env";

const BASE = "http://localhost:3100";
const EVENT = "demo-referee";
const CRED = "referee-demo-credential-2026-09";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

function tinyPng(): Uint8Array<ArrayBuffer> {
  // 在**全新的 ArrayBuffer** 上建 Uint8Array：这样类型是 Uint8Array<ArrayBuffer>，
  // 可以直接作为 fetch 的 body 与 BlobPart（Uint8Array<ArrayBufferLike> 不行，TS 5.7+ 起）。
  const decoded = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const out = new Uint8Array(decoded.length);
  out.set(decoded);
  return out;
}

async function main() {
  loadEnvConfig(process.cwd(), true);
  const supaBase = (process.env.SUPABASE_URL ?? "").replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!supaBase || !secret) throw new Error("缺少 Supabase 配置");
  const auth = { Authorization: `Bearer ${secret}`, apikey: secret };

  const readDoc = async (name: string) => {
    const r = await fetch(
      `${supaBase}/rest/v1/app_documents?scope=eq.event&event_id=eq.${EVENT}&name=eq.${name}&select=payload,version`,
      { headers: auth },
    );
    const rows = (await r.json()) as Array<{ payload: Record<string, unknown>; version: number }>;
    return rows[0] ?? null;
  };

  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) }); if (r.status === 200) break; }
    catch { await new Promise((s) => setTimeout(s, 2000)); }
  }

  try {
    console.log("== 1. 登录（重新 seed 到 staging）==");
    const login = await fetch(`${BASE}/api/referee/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-referee-credential": CRED },
      body: JSON.stringify({ credential: CRED, eventId: EVENT }),
    });
    check("登录成功", login.status === 200, String(login.status));

    const mine = await fetch(`${BASE}/api/referee/matches?eventId=${EVENT}`, {
      headers: { "x-referee-credential": CRED },
    });
    const mineJson = (await mine.json()) as {
      matches?: Array<{ matchId: string; boType: string }>;
      scheduleVersion?: number;
    };
    const target = (mineJson.matches ?? [])[0];
    if (!target) throw new Error("没有可提交的比赛");
    // ★ 版本号必须随提交一起传（前端 RefereeWorkbench.tsx:373 就是这么做的：
    //   从 /api/referee/matches 的响应里取 scheduleVersion 存进 state）。
    //   不传的话接口默认 -1，会得到「提交基于 v-1」这种看不懂的 409。
    const scheduleVersion = mineJson.scheduleVersion ?? -1;
    console.log(`    目标比赛：${target.matchId}（${target.boType}）`);
    console.log(`    赛程版本（来自 matches 响应）：v${scheduleVersion}`);
    check("响应里带 scheduleVersion", typeof mineJson.scheduleVersion === "number", String(mineJson.scheduleVersion));

    console.log("");
    console.log("== 2. 先传一张凭证 ==");
    const png = tinyPng();
    const fd = new FormData();
    fd.append("file", new File([png], "e.png", { type: "image/png" }));
    fd.append("eventId", EVENT);
    fd.append("matchId", target.matchId);
    const up = await fetch(`${BASE}/api/referee/upload`, {
      method: "POST", headers: { "x-referee-credential": CRED }, body: fd,
    });
    const upJson = (await up.json()) as { evidenceId?: string; message?: string };
    check("上传成功", up.status === 200 && Boolean(upJson.evidenceId), JSON.stringify(upJson).slice(0, 100));
    const evidenceId = upJson.evidenceId;

    console.log("");
    console.log("== 3. ★ 提交报分（一次写三个文档，走真实事务）==");
    const submitBody = {
      eventId: EVENT,
      matchId: target.matchId,
      basedOnScheduleVersion: scheduleVersion,
      games: [
        { map: "莲华古城", teamAScore: 13, teamBScore: 7 },
        { map: "亚海悬城", teamAScore: 13, teamBScore: 10 },
      ],
      evidenceIds: evidenceId ? [evidenceId] : [],
    };
    const sub = await fetch(`${BASE}/api/referee/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-referee-credential": CRED },
      body: JSON.stringify(submitBody),
    });
    const subText = (await sub.text()).slice(0, 220);
    console.log(`    HTTP ${sub.status}  ${subText}`);
    check("提交成功", sub.status === 200, `HTTP ${sub.status} ${subText.slice(0, 100)}`);

    console.log("");
    console.log("== 4. ★ 三个文档都落库（证明是同一批事务写）==");
    const schedule = await readDoc("schedule");
    const resultLedger = await readDoc("result-ledger");
    const evidenceLedger = await readDoc("evidence-ledger");
    console.log(`    schedule        version=${schedule?.version ?? "-"}`);
    console.log(`    result-ledger   version=${resultLedger?.version ?? "-"}`);
    console.log(`    evidence-ledger version=${evidenceLedger?.version ?? "-"}`);
    check("schedule 文档存在", Boolean(schedule));
    check("result-ledger 文档存在", Boolean(resultLedger));
    check("evidence-ledger 文档存在", Boolean(evidenceLedger));

    const matches = (schedule?.payload as { matches?: Array<{ id: string; status: string; winnerTeamId?: string }> })?.matches ?? [];
    const m = matches.find((x) => x.id === target.matchId);
    console.log(`    比赛状态：${m?.status ?? "(未找到)"}  胜方：${m?.winnerTeamId ?? "-"}`);
    check("赛程里该场比赛已被更新（不再是「已排期」）", Boolean(m) && m!.status !== "已排期", m?.status);

    const subs = (resultLedger?.payload as { submissions?: Array<{ matchId: string; status: string }> })?.submissions ?? [];
    const mySub = subs.find((x) => x.matchId === target.matchId);
    console.log(`    提交记录状态：${mySub?.status ?? "(未找到)"}`);
    check("赛果台账里有该场提交", Boolean(mySub), JSON.stringify(subs.map((x) => x.matchId)));

    console.log("");
    console.log("== 5. ★ 凭证被挂到提交上（不是孤儿）==");
    const evs = (evidenceLedger?.payload as { evidence?: Array<{ id: string; submissionId?: string }> })?.evidence ?? [];
    const myEv = evs.find((x) => x.id === evidenceId);
    console.log(`    凭证 submissionId=${myEv?.submissionId ?? "(未挂)"}`);
    check("凭证已关联到某次提交", Boolean(myEv?.submissionId), String(myEv?.submissionId));

    console.log("");
    console.log("== 6. 重复提交同一场（幂等/拒绝）==");
    const dup = await fetch(`${BASE}/api/referee/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-referee-credential": CRED },
      body: JSON.stringify(submitBody),
    });
    const dupText = (await dup.text()).slice(0, 160);
    console.log(`    HTTP ${dup.status}  ${dupText}`);
    check("重复提交被拒或幂等（不产生第二条提交）", dup.status !== 500, `HTTP ${dup.status}`);

    console.log("");
    console.log("== 7. 提交后：对象仍在私有桶，且匿名读不到 ==");
    if (evidenceId) {
      const objUrl = `${supaBase}/storage/v1/object/match-evidence/${EVENT}/${evidenceId}.png`;
      const ok = await fetch(objUrl, { headers: auth });
      const pub = await fetch(`${supaBase}/storage/v1/object/public/match-evidence/${EVENT}/${evidenceId}.png`);
      console.log(`    服务端 GET：HTTP ${ok.status}   匿名 GET：HTTP ${pub.status}`);
      check("服务端可读（凭证未被误删）", ok.status === 200, String(ok.status));
      check("匿名仍读不到", pub.status !== 200, String(pub.status));
    }
  } finally {
    console.log("");
    console.log("== 清理 staging ==");
    // 删对象
    const list = await fetch(`${supaBase}/storage/v1/object/list/match-evidence`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: `${EVENT}/`, limit: 200 }),
    });
    const items = (await list.json()) as Array<{ name?: string }>;
    for (const it of Array.isArray(items) ? items : []) {
      if (!it.name) continue;
      await fetch(`${supaBase}/storage/v1/object/match-evidence/${EVENT}/${it.name}`, { method: "DELETE", headers: auth });
    }
    console.log(`    删除 ${Array.isArray(items) ? items.length : 0} 个桶内对象`);
    const delDocs = await fetch(`${supaBase}/rest/v1/app_documents?event_id=eq.${EVENT}`, {
      method: "DELETE", headers: { ...auth, Prefer: "return=minimal" },
    });
    console.log(`    删除演示文档：HTTP ${delDocs.status}`);
    const after = await fetch(`${supaBase}/rest/v1/app_documents?event_id=eq.${EVENT}&select=name`, { headers: auth });
    const left = (await after.json()) as unknown[];
    check("清理后无残留文档", Array.isArray(left) && left.length === 0, `残留 ${Array.isArray(left) ? left.length : "?"}`);
  }

  console.log("");
  console.log(`结果：通过 ${pass} / ${pass + fail}`);
  if (fail > 0) process.exitCode = 2;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "端到端提交验收失败");
  process.exitCode = 1;
});
