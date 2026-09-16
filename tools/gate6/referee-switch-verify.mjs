// 生产开关生效后的验收（只读 + 无凭证探测，不写任何数据）
const O = "https://ecustesports.top";

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (d ? "（" + d + "）" : "")); } };

async function post(path, body) {
  const r = await fetch(O + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: O, Referer: O + "/" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  return { status: r.status, text: (await r.text()).slice(0, 120) };
}

(async () => {
  console.log("== 1. 功能开关：三个写接口都不再返回「暂未开放」 ==");
  const endpoints = [
    ["claim 认领", "/api/referee/claim", { eventId: "event-1", matchId: "probe", action: "claim" }],
    ["submit 提交", "/api/referee/submit", { eventId: "event-1", matchId: "probe" }],
    ["upload 上传", "/api/referee/upload", null],
    ["recognize 识别", "/api/referee/recognize", { eventId: "event-1", matchId: "probe" }],
  ];
  for (const [name, path, body] of endpoints) {
    let r;
    if (path.endsWith("upload")) {
      // upload 是 multipart，不带 file 时应返回「请选择凭证图片」而不是「暂未开放」
      const fd = new FormData();
      fd.append("eventId", "event-1");
      fd.append("matchId", "probe");
      const res = await fetch(O + path, { method: "POST", headers: { Origin: O, Referer: O + "/" }, body: fd, signal: AbortSignal.timeout(20000) });
      r = { status: res.status, text: (await res.text()).slice(0, 120) };
    } else {
      r = await post(path, body);
    }
    const open = !r.text.includes("暂未开放");
    console.log(`  ${name.padEnd(14)} HTTP ${r.status}  ${r.text.slice(0, 56)}`);
    check(`${name} 已放行（不再是「暂未开放」）`, open, r.text.slice(0, 60));
  }

  console.log("");
  console.log("== 2. ★ 未鉴权时不得泄露业务信息（鉴权必须在资源查询之前） ==");
  // 判据：不带凭证去问各种 matchId，报错**只能**是「凭证无效」这类，
  // 不能出现「比赛不存在 / 已结束 / 没有约赛时间」——那些说明走到了资源查询，
  // 未登录者可据此枚举比赛（matchId 是 M01/M02… 连续可猜）。
  const BUSINESS_WORDS = ["比赛不存在", "已结束", "约赛时间", "你没有认领", "该场"];
  const probes = [
    ["claim 认领", "/api/referee/claim", { eventId: "event-1", matchId: "probe", action: "claim" }],
    ["submit 提交", "/api/referee/submit", { eventId: "event-1", matchId: "probe" }],
    ["recognize 识别", "/api/referee/recognize", { eventId: "event-1", matchId: "probe" }],
  ];
  for (const [name, path, body] of probes) {
    const r = await post(path, body);
    const leaked = BUSINESS_WORDS.filter((w) => r.text.includes(w));
    console.log(`  ${name.padEnd(14)} HTTP ${r.status}  ${r.text.slice(0, 56)}`);
    check(`${name} 未泄露业务信息`, leaked.length === 0, leaked.length ? `泄露词: ${leaked.join(", ")}` : "");
  }

  // 同一个 matchId 问两种「可能不同」的答案，若响应有差异说明能区分（=泄露）
  const a = await post("/api/referee/claim", { eventId: "event-1", matchId: "M01", action: "claim" });
  const b = await post("/api/referee/claim", { eventId: "event-1", matchId: "M99", action: "claim" });
  console.log(`  M01 vs M99 → ${a.status}${a.text} | ${b.status}${b.text}`);
  check("不同 matchId 的未鉴权响应无法区分（不泄露存在性）",
    a.status === b.status && a.text === b.text,
    a.text !== b.text ? "两者响应不同 → 可枚举比赛" : "");

  console.log("");
  console.log("== 3. 无凭证被合理拒绝（不是 500，也不是放行） ==");
  const s = await post("/api/referee/submit", { eventId: "event-1", matchId: "probe" });
  check("无效凭证被拒（4xx，非 5xx）", s.status >= 400 && s.status < 500, `HTTP ${s.status}`);

  console.log("");
  console.log("== 4. 读取类接口不受开关影响（登录页要能用） ==");
  const loginPage = await fetch(O + "/referee?eventId=event-1", { signal: AbortSignal.timeout(20000) });
  const pageHtml = await loginPage.text();
  check("裁判登录页可打开", loginPage.status === 200, `HTTP ${loginPage.status}`);
  check("页面是裁判工作台而非报错页", pageHtml.includes("裁判") || pageHtml.includes("凭证"), pageHtml.slice(0, 60));

  // 登录是读取类接口，开关不该拦它
  const login = await post("/api/referee/login", { credential: "definitely-not-a-valid-credential-xyz", eventId: "event-1" });
  console.log(`  login POST HTTP ${login.status}  ${login.text.slice(0, 60)}`);
  check("登录接口未被开关拦（不返回「暂未开放」）", !login.text.includes("暂未开放"), login.text.slice(0, 60));

  console.log("");
  console.log("== 5. 报名主流程不受影响 ==");
  for (const [n, u] of [["首页", "/"], ["赛事列表", "/events"], ["赛事页", "/events/event-1"], ["报名页", "/events/event-1/register"]]) {
    try {
      const r = await fetch(O + u, { signal: AbortSignal.timeout(20000) });
      console.log(`  ${n.padEnd(8)} HTTP ${r.status}`);
      check(`${n} 正常`, r.status === 200, String(r.status));
    } catch (e) {
      check(`${n} 正常`, false, e.message.slice(0, 40));
    }
  }

  console.log("");
  console.log("== 6. 管理端不受影响 ==");
  const admin = await fetch(O + "/login", { signal: AbortSignal.timeout(20000) });
  check("管理端登录页可打开", admin.status === 200, String(admin.status));

  console.log("");
  console.log("== 7. 群号仍在（确认没被部署冲掉） ==");
  const cfg = await (await fetch(O + "/api/admin/site-config", { signal: AbortSignal.timeout(20000) })).json();
  check("赛事群号仍在", cfg.events?.[0]?.eventQqGroup === "1107657580", JSON.stringify(cfg.events?.[0]?.eventQqGroup));

  console.log("");
  console.log(`结果：通过 ${pass} / ${pass + fail}`);
  if (fail > 0) process.exitCode = 2;
})().catch((e) => { console.error(e); process.exitCode = 1; });
