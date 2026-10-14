// =====================
// 从本地快照恢复线上赛程（2026-10-14）
//
// 背景：线上 event-1 的赛程在 2026-10-14 11:35 前后被清空（v89 → v90、0 场），
// 原因未定（换赛制接口当时并未执行，赛制仍是 GSL 模板）。赛前抓到的 v89 快照
// （40 场：资格赛 4 已完成 + 入围赛 16 已完成 + 小组赛 20 待排期）存在
// `.workbuddy/rescue-2026-10-14/public-schedule-try1.json`。
//
// 用法（口令只在你本机环境变量里，不写进任何文件）：
//   ADMIN_PASSWORD=你的管理端口令 npm run ops:restore-schedule -- --yes
// 可选：
//   EVENT_ID=event-1           目标赛事（默认 event-1）
//   SNAPSHOT=.workbuddy/...   快照路径（默认上面那份）
//   BASE=http://localhost:3000 目标站点（默认生产 https://ecustesports.top）
//
// 安全性：① 先登录、读当前文档，**只替换 matches**，保留现有的 requests / notifications / config；
//         ② 打印将要写入的内容摘要，不带 --yes 就只做演练；
//         ③ 带 if-match 当前版本号提交，版本被别处改过就会 409 拒绝，不会覆盖新改动；
//         ④ 从不打印口令。
// =====================

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const take = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const BASE = (take("--base") ?? process.env.BASE ?? "https://ecustesports.top").replace(/\/$/, "");
const EVENT_ID = take("--event") ?? process.env.EVENT_ID ?? "event-1";
const SNAPSHOT = take("--snapshot")
  ?? process.env.SNAPSHOT
  ?? path.join(ROOT, ".workbuddy", "rescue-2026-10-14", "public-schedule-try1.json");
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const APPLY = args.includes("--yes");

if (!PASSWORD) {
  console.error("缺少 ADMIN_PASSWORD 环境变量。例：ADMIN_PASSWORD=xxx npm run ops:restore-schedule -- --yes");
  process.exit(2);
}
if (!existsSync(SNAPSHOT)) {
  console.error(`找不到快照文件：${SNAPSHOT}`);
  process.exit(2);
}

type Match = { id: string; phase: string; status: string; startTime?: string };
type ScheduleState = { version: number; matches: Match[]; [key: string]: unknown };

const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as ScheduleState;
const phaseCount = (matches: Match[]) => {
  const per: Record<string, Record<string, number>> = {};
  for (const match of matches) {
    per[match.phase] = per[match.phase] ?? {};
    per[match.phase][match.status] = (per[match.phase][match.status] ?? 0) + 1;
  }
  return per;
};

console.log("== 快照 ==");
console.log(`  文件：${path.relative(ROOT, SNAPSHOT)}`);
console.log(`  sha256：${createHash("sha256").update(readFileSync(SNAPSHOT)).digest("hex").slice(0, 16)}…`);
console.log(`  快照版本：v${snapshot.version}，场次 ${snapshot.matches.length}`);
console.log(`  分阶段×状态：${JSON.stringify(phaseCount(snapshot.matches))}`);
console.log(`  已完成：${snapshot.matches.filter((m) => m.status === "已完成").length} 场`);

async function main() {
  // 登录：生产有来源校验，必须带同源头部
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, referer: `${BASE}/admin` },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!login.ok) {
    console.error(`登录失败：HTTP ${login.status}（口令不对，或站点不可达）`);
    process.exit(1);
  }
  const cookie = (login.headers.getSetCookie?.() ?? []).map((item) => item.split(";")[0]).join("; ");
  console.log(`\n登录成功：HTTP ${login.status}`);

  const headers = { cookie, origin: BASE, referer: `${BASE}/admin`, "content-type": "application/json" };
  const currentResponse = await fetch(`${BASE}/api/data/schedule?eventId=${encodeURIComponent(EVENT_ID)}`, {
    headers, cache: "no-store",
  });
  if (!currentResponse.ok) {
    console.error(`读取当前赛程失败：HTTP ${currentResponse.status}`);
    process.exit(1);
  }
  const current = (await currentResponse.json()) as ScheduleState;
  console.log(`当前线上赛程：v${current.version}，场次 ${(current.matches ?? []).length}`);
  console.log(`  分阶段×状态：${JSON.stringify(phaseCount(current.matches ?? []))}`);

  // 只替换 matches，保留当前的 requests / notifications / config
  const merged: ScheduleState = { ...current, matches: snapshot.matches };
  console.log("\n== 将要写入 ==");
  console.log(`  场次 ${(current.matches ?? []).length} → ${snapshot.matches.length}`);
  console.log(`  保留现有 requests=${Array.isArray(current.requests) ? current.requests.length : "无"} / notifications=${
    Array.isArray(current.notifications) ? current.notifications.length : "无"}`);
  console.log(`  if-match 版本：${current.version}`);

  if (!APPLY) {
    console.log("\n（演练模式：加 --yes 才会真的提交）");
    return;
  }

  const save = await fetch(`${BASE}/api/data/schedule?eventId=${encodeURIComponent(EVENT_ID)}`, {
    method: "POST",
    headers: { ...headers, "if-match": String(current.version) },
    body: JSON.stringify(merged),
  });
  const body = (await save.json().catch(() => ({}))) as { message?: string };
  console.log(`\n提交结果：HTTP ${save.status} ${body.message ?? ""}`);
  if (!save.ok) {
    console.error("写入失败，**没有做任何改动**。若是 409，说明期间有别的写入，重新跑一次即可。");
    process.exit(1);
  }

  // 回读核对（公开接口，带缓存，等一拍再看）
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const verify = await fetch(`${BASE}/api/public/schedule?eventId=${encodeURIComponent(EVENT_ID)}`, { cache: "no-store" });
  const after = (await verify.json()) as ScheduleState;
  console.log(`回读：v${after.version}，场次 ${(after.matches ?? []).length}`);
  console.log(`  分阶段×状态：${JSON.stringify(phaseCount(after.matches ?? []))}`);
  console.log((after.matches ?? []).length === snapshot.matches.length ? "✓ 已恢复" : "✗ 数量不符，请再查");
}

main().catch((error) => {
  console.error("恢复失败：", error instanceof Error ? error.message : error);
  process.exit(1);
});
