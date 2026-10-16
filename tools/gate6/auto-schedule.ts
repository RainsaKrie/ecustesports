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

/** 排期配置：用站点现成的赛制约束（并发上限 / 各 BO 时长 / 时段窗口） */
function configFromEvent(event: Record<string, unknown>): SchedulingConfig {
  const constraints = (event.constraints ?? {}) as Record<string, unknown>;
  const durations = (constraints.durations ?? {}) as Record<string, number>;
  const matchdays = Array.isArray(constraints.matchdays) ? constraints.matchdays as number[] : [6, 7];
  const eventDate = String(event.eventDateLabel ?? "").match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  const nextSaturday = new Date();
  nextSaturday.setDate(nextSaturday.getDate() + ((6 - nextSaturday.getDay() + 7) % 7 || 7));
  const base = eventDate ? new Date(Number(eventDate[1]), Number(eventDate[2]) - 1, Number(eventDate[3]), 12, 0, 0) : nextSaturday;
  const day = (offset: number) => { const d = new Date(base); d.setDate(d.getDate() + offset); return d; };
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const sessionStart = String(constraints.sessionStart ?? "12:00");
  const sessionEnd = String(constraints.sessionEnd ?? "18:00");
  void matchdays;
  return {
    maxConcurrentMatches: Number(constraints.maxConcurrent ?? 2),
    boDurations: { BO1: durations.BO1 ?? 45, BO3: durations.BO3 ?? 90, BO5: durations.BO5 ?? 150 } as Record<BOType, number>,
    stageStart: `${fmt(day(0))}T${sessionStart}:00`,
    stageEnd: `${fmt(day(0))}T${sessionEnd}:00`,
  };
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
  const config = configFromEvent(event);

  const pending = state.matches.filter((m) => m.status === "待排期" && (!PHASE || m.phase === PHASE));
  const occupied = state.matches.filter((m) => m.status !== "待排期");
  console.log(`赛程 v${state.version}｜待排期 ${pending.length} 场｜时段 ${config.stageStart} ~ ${config.stageEnd}｜并发上限 ${config.maxConcurrentMatches}`);
  if (pending.length === 0) { console.log("没有待排期的场次，结束。"); return; }

  const plan = planBulkSchedule(pending, occupied, config);
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
