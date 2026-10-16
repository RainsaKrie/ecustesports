// =====================
// 批量排期（2026-10-16，P2）
//
// 用法（口令只从本机环境变量读，不写文件、不回显）：
//   ADMIN_PASSWORD=xxx npm run ops:auto-schedule              # 演练：只打印要排成什么样
//   ADMIN_PASSWORD=xxx npm run ops:auto-schedule -- --yes     # 真写
// 可选：EVENT_ID（默认 event-1）、BASE（默认生产）、--phase=小组赛（默认全部待排期场次）
//
// 规则：从配置的时段起点起，以 15 分钟为步长找最早可用时间，同一时刻不超过并发上限；
// 结束时间超出时段的场次记为「排不下」并写明原因，不静默丢弃。
// 写入走既有的整份保存接口（自带版本护栏与内容丢失护栏），并用 if-match 防覆盖。
// =====================

import { planBulkSchedule, applyBulkAssignments } from "../../src/lib/scheduling/bulk-schedule";
import type { SchedulingConfig, BOType } from "../../src/lib/scheduling/rule-engine";
import { normalizeScheduleState, type ScheduleMatch } from "../../src/lib/scheduling/schedule-data";

const args = process.argv.slice(2);
const take = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const BASE = (take("--base") ?? process.env.BASE ?? "https://ecustesports.top").replace(/\/$/, "");
const EVENT_ID = take("--event") ?? process.env.EVENT_ID ?? "event-1";
const PHASE = take("--phase") ?? process.env.PHASE ?? "";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const APPLY = args.includes("--yes");

if (!PASSWORD) { console.error("缺少 ADMIN_PASSWORD。例：ADMIN_PASSWORD=xxx npm run ops:auto-schedule"); process.exit(2); }

/**
 * 排期配置 + 比赛日窗口。
 *
 * 窗口按**周末**生成（赛制约束里的 matchdays 默认 [6,7]），从今天起排到赛期结束；
 * 规划器会按顺序填，填满当前比赛日才用下一个。可用 --days=2026-10-17,2026-10-18 覆盖。
 */
function planInputFromEvent(event: Record<string, unknown>, overrideDays: string[]) {
  const constraints = (event.constraints ?? {}) as Record<string, unknown>;
  const durations = (constraints.durations ?? {}) as Record<string, number>;
  const sessionStart = String(constraints.sessionStart ?? "12:00");
  const sessionEnd = String(constraints.sessionEnd ?? "18:00");
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const windowOf = (day: string) => ({ start: `${day}T${sessionStart}:00`, end: `${day}T${sessionEnd}:00` });

  const days: string[] = overrideDays.length > 0 ? overrideDays : (() => {
    // 赛期形如「比赛时间10.7-11.8」：取出起止（年份用当前年）
    const span = String(event.eventDateLabel ?? "").match(/(\d{1,2})[.\-/](\d{1,2})\s*[-~至]\s*(\d{1,2})[.\-/](\d{1,2})/);
    const year = new Date().getFullYear();
    const end = span ? new Date(year, Number(span[3]) - 1, Number(span[4])) : new Date(Date.now() + 14 * 86_400_000);
    const out: string[] = [];
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    // 从明天起，取赛期内的周六周日（最多 8 天，够排两届小组赛）
    cursor.setDate(cursor.getDate() + 1);
    while (cursor <= end && out.length < 8) {
      if (cursor.getDay() === 6 || cursor.getDay() === 0) out.push(fmt(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  })();

  const config: SchedulingConfig = {
    maxConcurrentMatches: Number(constraints.maxConcurrent ?? 2),
    boDurations: { BO1: durations.BO1 ?? 45, BO3: durations.BO3 ?? 90, BO5: durations.BO5 ?? 150 } as Record<BOType, number>,
    stageStart: windowOf(days[0] ?? fmt(new Date())).start,
    stageEnd: windowOf(days[days.length - 1] ?? fmt(new Date())).end,
  };
  return { config, windows: days.map(windowOf) };
}

async function main() {
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, referer: `${BASE}/admin` },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!login.ok) { console.error(`登录失败 HTTP ${login.status}`); process.exit(1); }
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const headers = { cookie, origin: BASE, referer: `${BASE}/admin`, "content-type": "application/json" };

  const state = normalizeScheduleState(await (await fetch(`${BASE}/api/data/schedule?eventId=${encodeURIComponent(EVENT_ID)}`, { headers, cache: "no-store" })).json());
  const event = (await (await fetch(`${BASE}/api/admin/site-config`, { headers, cache: "no-store" })).json()).events?.find((e: { id: string }) => e.id === EVENT_ID) ?? {};
  const { config, windows } = planInputFromEvent(event, (take("--days") ?? process.env.DAYS ?? "").split(",").map((d) => d.trim()).filter(Boolean));

  // ★ 参赛队还没定的场次**不排**（组内决赛、淘汰赛后续轮次都属这类）：
  //   它们的队伍要等前序比赛出结果，现在排具体时间必然要改期。
  const awaitingTeams = state.matches.filter(
    (m) => m.status === "待排期" && (!PHASE || m.phase === PHASE) && (m.teamAId === "TBD" || m.teamBId === "TBD"),
  );
  const pending = state.matches.filter(
    (m) => m.status === "待排期" && (!PHASE || m.phase === PHASE) && m.teamAId !== "TBD" && m.teamBId !== "TBD",
  );
  const occupied = state.matches.filter((m) => m.status !== "待排期");
  console.log(`赛程 v${state.version}｜待排期 ${pending.length} 场｜并发上限 ${config.maxConcurrentMatches}｜比赛日：${windows.map((w) => w.start.slice(0, 10)).join("、")}`);
  if (awaitingTeams.length > 0) {
    console.log(`另有 ${awaitingTeams.length} 场参赛队未定（等前序比赛出结果），本次不排：${awaitingTeams.map((m) => m.id).join("、")}`);
  }
  if (pending.length === 0) { console.log("没有可排期的场次（队伍已确定的），结束。"); return; }

  const plan = planBulkSchedule(pending, occupied, config, windows);
  console.log(`\n计划排期 ${plan.assignments.length} 场：`);
  for (const a of plan.assignments) {
    const m = pending.find((x) => x.id === a.matchId);
    console.log(`  ${a.startTime.slice(11, 16)}–${a.endTime.slice(11, 16)}  ${a.matchId}  ${m?.teamAName} vs ${m?.teamBName}（${m?.boType}）`);
  }
  if (plan.skipped.length > 0) { console.log(`\n排不下 ${plan.skipped.length} 场：`); for (const s of plan.skipped) console.log(`  ${s.matchId}：${s.reason}`); }
  if (!APPLY) { console.log("\n（演练模式：加 --yes 才会真写）"); return; }

  const next = { ...state, matches: applyBulkAssignments(state.matches as ScheduleMatch[], plan.assignments) };
  const save = await fetch(`${BASE}/api/data/schedule?eventId=${encodeURIComponent(EVENT_ID)}`, {
    method: "POST", headers: { ...headers, "if-match": String(state.version) }, body: JSON.stringify(next),
  });
  const body = (await save.json().catch(() => ({}))) as { message?: string };
  console.log(`\n提交：HTTP ${save.status} ${body.message ?? ""}`);
  if (!save.ok) { console.error("写入失败，没有做任何改动。若为 409，说明期间有别的写入，重跑一次即可。"); process.exit(1); }
  const after = normalizeScheduleState(await (await fetch(`${BASE}/api/data/schedule?eventId=${encodeURIComponent(EVENT_ID)}`, { headers, cache: "no-store" })).json());
  console.log(`回读：v${after.version}｜已排期 ${after.matches.filter((m) => m.status !== "待排期").length} 场｜待排期 ${after.matches.filter((m) => m.status === "待排期").length} 场`);
}

main().catch((e) => { console.error("失败：", e instanceof Error ? e.message : e); process.exit(1); });
