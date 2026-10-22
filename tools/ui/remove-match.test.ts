// 删除单场比赛的行为测试（2026-10-22）
import { removeMatchOp } from "../../src/lib/domains/schedule/remove-match";
import type { ScheduleState, ScheduleMatch } from "../../src/lib/domains/schedule/schedule-data";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "：" + detail : ""}`); }
}

function m(id: string, status: string, extra: Partial<ScheduleMatch> = {}): ScheduleMatch {
  return {
    id, phase: "小组赛", round: "A 组 决赛", boType: "BO1", frozen: false, status,
    startTime: "", endTime: "", teamAId: "T1", teamBId: "T2",
    teamAName: "A", teamBName: "B", ...extra,
  } as unknown as ScheduleMatch;
}
const state = (matches: ScheduleMatch[]): ScheduleState => ({ version: 1, matches } as unknown as ScheduleState);

console.log("删除单场比赛");

// ① 待排期的比赛可以删
const s1 = removeMatchOp(state([m("M1", "待排期"), m("M2", "已排期")]), "M1");
check("待排期的可以删", s1.ok && s1.state.matches.length === 1, s1.ok ? "" : s1.message);

// ② 已完成的不能删（会连比分一起丢掉）
const s2 = removeMatchOp(state([m("M1", "已完成")]), "M1");
check("已完成的拒绝删除", !s2.ok, s2.ok ? "竟然删掉了" : "");
check("拒绝时给出原因", !s2.ok && s2.message.includes("已完成"), !s2.ok ? s2.message : "");

// ③ 被后续比赛指向的**可以删**，但要把链接断开（不拒绝）
//    —— 典型场景：取消小组决赛，半决赛的 nextMatchId 正指着它。
const s3 = removeMatchOp(
  state([m("M1", "待排期"), m("M2", "待排期", { nextMatchId: "M1" } as Partial<ScheduleMatch>)]),
  "M1",
);
check("被指向的可以删（不能因此永远删不掉）", s3.ok, s3.ok ? "" : s3.message);
if (s3.ok) {
  const survivor = s3.state.matches.find((x) => x.id === "M2");
  check("指向它的链接已断开", survivor?.nextMatchId === undefined, String(survivor?.nextMatchId));
  check("其余比赛保留", s3.state.matches.length === 1, String(s3.state.matches.length));
}
// 败者路径的链接也要一并断开
const s3b = removeMatchOp(
  state([m("M1", "待排期"), m("M2", "待排期", { nextLoserMatchId: "M1" } as Partial<ScheduleMatch>)]),
  "M1",
);
check("败者路径链接也断开", s3b.ok && s3b.state.matches[0].nextLoserMatchId === undefined);

// ④ 不存在的 id 不抛异常
const s4 = removeMatchOp(state([m("M1", "待排期")]), "NOPE");
check("不存在的 id 返回失败而不是抛错", !s4.ok);

// ⑤ 删除后不影响其他比赛
const s5 = removeMatchOp(state([m("M1", "待排期"), m("M2", "待排期")]), "M1");
check("只删目标，其余保留", s5.ok && s5.state.matches[0].id === "M2", s5.ok ? s5.state.matches.map((x) => x.id).join(",") : "");

console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
if (failed > 0) process.exit(1);
