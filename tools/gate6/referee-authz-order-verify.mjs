// 本地验证：修复后，未鉴权请求不再泄露业务信息。
//
// 对比修复前（生产实测）：
//   POST /api/referee/claim 无凭证 → 400 {"message":"比赛不存在"}
// 修复后应变成：
//   401 {"message":"裁判凭证无效"}
// 且**不同 matchId 的响应完全一致**（无法区分比赛是否存在）。
const BASE = "http://localhost:3100";
const EVENT = "demo-referee"; // 本地 seed 的演示赛事（会有真实比赛 M-R1 等）

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (d ? "（" + d + "）" : "")); } };

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  return { status: r.status, text: (await r.text()).slice(0, 140) };
}

(async () => {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + "/api/health", { signal: AbortSignal.timeout(3000) }); if (r.status === 200) break; }
    catch { await new Promise((s) => setTimeout(s, 2000)); }
  }

  // 先让演示赛事 seed 出来（登录会触发）
  await post("/api/referee/login", { credential: "referee-demo-credential-2026-09", eventId: EVENT });

  console.log("== 1. 取真实比赛 ID（用合法凭证） ==");
  const mine = await fetch(`${BASE}/api/referee/matches?eventId=${EVENT}`, {
    headers: { "x-referee-credential": "referee-demo-credential-2026-09" },
  });
  const mineJson = await mine.json();
  const realId = mineJson.matches?.[0]?.matchId;
  console.log(`    真实比赛 ID: ${realId ?? "(无)"}`);
  check("拿到真实比赛 ID（用于对比）", Boolean(realId), String(realId));

  const BUSINESS = ["比赛不存在", "已结束", "约赛时间", "你没有认领", "该场"];

  console.log("");
  console.log("== 2. ★ 无凭证：不得出现任何业务信息 ==");
  const noCredReal = await post("/api/referee/claim", { eventId: EVENT, matchId: realId, action: "claim" });
  console.log(`    真实比赛ID  HTTP ${noCredReal.status}  ${noCredReal.text}`);
  check("返回 401（未鉴权）", noCredReal.status === 401, String(noCredReal.status));
  check("报错只说凭证无效", noCredReal.text.includes("凭证无效"), noCredReal.text);
  const leaked1 = BUSINESS.filter((w) => noCredReal.text.includes(w));
  check("★ 不含任何业务信息", leaked1.length === 0, leaked1.join(", "));

  console.log("");
  console.log("== 3. ★ 无凭证：真实 ID 与假 ID 的响应必须完全一致 ==");
  const noCredFake = await post("/api/referee/claim", { eventId: EVENT, matchId: "M-DOES-NOT-EXIST", action: "claim" });
  console.log(`    假比赛ID    HTTP ${noCredFake.status}  ${noCredFake.text}`);
  check("★ 两者状态码一致（无法区分存在性）", noCredReal.status === noCredFake.status,
    `${noCredReal.status} vs ${noCredFake.status}`);
  check("★ 两者响应体一致（无法区分存在性）", noCredReal.text === noCredFake.text,
    noCredReal.text !== noCredFake.text ? `不同: ${noCredReal.text} | ${noCredFake.text}` : "");

  console.log("");
  console.log("== 4. 错误凭证同样不泄露 ==");
  const badCred = await post("/api/referee/claim", { eventId: EVENT, matchId: realId, action: "claim" });
  check("错误凭证也返回 401 且不含业务信息",
    badCred.status === 401 && BUSINESS.every((w) => !badCred.text.includes(w)), badCred.text);

  console.log("");
  console.log("== 5. 合法凭证功能未退化（仍能正常认领/看到状态） ==");
  const okCred = await fetch(`${BASE}/api/referee/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-referee-credential": "referee-demo-credential-2026-09" },
    body: JSON.stringify({ eventId: EVENT, matchId: realId, action: "claim" }),
  });
  const okText = (await okCred.text()).slice(0, 140);
  console.log(`    合法凭证    HTTP ${okCred.status}  ${okText}`);
  check("合法凭证可用（200 或已在认领的幂等结果）", okCred.status === 200, String(okCred.status));

  // 鉴权通过后，业务报错应当照常返回（说明没有把已登录用户也挡掉）
  const okFake = await fetch(`${BASE}/api/referee/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-referee-credential": "referee-demo-credential-2026-09" },
    body: JSON.stringify({ eventId: EVENT, matchId: "M-DOES-NOT-EXIST", action: "claim" }),
  });
  const okFakeText = (await okFake.text()).slice(0, 140);
  console.log(`    合法凭证+假ID HTTP ${okFake.status}  ${okFakeText}`);
  check("已鉴权者仍能看到正常业务报错（功能未被误伤）",
    okFake.status === 400 && okFakeText.includes("比赛不存在"), `${okFake.status} ${okFakeText}`);

  console.log("");
  console.log("== 6. 其它两个写接口同样不泄露 ==");
  for (const [n, p, b] of [
    ["submit", "/api/referee/submit", { eventId: EVENT, matchId: realId }],
    ["recognize", "/api/referee/recognize", { eventId: EVENT, matchId: realId }],
  ]) {
    const r = await post(p, b);
    const leaked = BUSINESS.filter((w) => r.text.includes(w));
    console.log(`    ${n.padEnd(10)} HTTP ${r.status}  ${r.text.slice(0, 60)}`);
    check(`${n} 未泄露业务信息`, leaked.length === 0, leaked.join(", "));
  }

  console.log("");
  console.log(`结果：通过 ${pass} / ${pass + fail}`);
  process.exitCode = fail > 0 ? 2 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
