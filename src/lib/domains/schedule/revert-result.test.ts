// =====================
// 撤销赛果（2026-11-05）
// 运行：npm run test:revert-result
//
// 为什么要钉住：这是在**比赛进行中**才用得上的补救操作，一旦写错，
// 要么退不掉（报错却不动），要么把已经打完的下一场清空 —— 两种都比不写更糟。
// 所以护栏与级联都要单独断言。
// =====================

import { revertResultOp } from "./revert-result.ts";
import type { ScheduleMatch, ScheduleState } from "./schedule-data.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ✓ ${name}`);
    return;
  }
  failed += 1;
  console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
}

function match(id: string, patch: Partial<ScheduleMatch> = {}): ScheduleMatch {
  return {
    id,
    phase: "淘汰赛",
    teamAId: `A-${id}`,
    teamBId: `B-${id}`,
    teamAName: `队A-${id}`,
    teamBName: `队B-${id}`,
    boType: "BO3",
    startTime: "",
    endTime: "",
    status: "待排期",
    frozen: false,
    ...patch,
  };
}

function state(matches: ScheduleMatch[]): ScheduleState {
  return { version: 1, config: { stageStart: "", stageEnd: "", venues: [], blocks: [] } as never, configConfirmed: true, matches, requests: [] };
}

console.log("== 撤销赛果 ==");

// ① 没有赛果 → 拒绝
{
  const s = state([match("M1")]);
  const out = revertResultOp(s, "M1");
  check("没有赛果时拒绝", !out.ok, out.ok ? "竟然成功了" : "");
}

// ② 有排期的已完成场 → 清干净并退回「已排期」
{
  const s = state([
    match("M1", { status: "已完成", startTime: "2026-11-05T19:00:00", winnerTeamId: "A-M1", gameResults: [{ map: "", teamAScore: 1, teamBScore: 0 }] }),
  ]);
  const out = revertResultOp(s, "M1");
  const m = out.ok ? out.state.matches[0] : null;
  check("已完成的场能撤销", out.ok);
  check("赛果被清空", !!m && !m.gameResults && !m.winnerTeamId);
  check("有排期 → 退回已排期", !!m && m.status === "已排期", m ? `实际 ${m.status}` : "");
}

// ③ 没排期的 → 退回「待排期」
{
  const s = state([match("M1", { status: "已完成", winnerTeamId: "A-M1", gameResults: [{ map: "", teamAScore: 1, teamBScore: 0 }] })]);
  const out = revertResultOp(s, "M1");
  check("无排期 → 退回待排期", out.ok && out.state.matches[0].status === "待排期");
}

// ④ 级联：下一场被填进去的那一侧要清回待定
{
  const s = state([
    match("M1", { status: "已完成", winnerTeamId: "A-M1", nextMatchId: "M2", nextSide: "B", gameResults: [{ map: "", teamAScore: 1, teamBScore: 0 }] }),
    match("M2", { teamAId: "X", teamAName: "别的队", teamBId: "A-M1", teamBName: "队A-M1" }),
  ]);
  const out = revertResultOp(s, "M1");
  const next = out.ok ? out.state.matches.find((m) => m.id === "M2")! : null;
  check("下一场胜者侧清回待定", !!next && next.teamBName === "待定" && next.teamBId === "");
  check("下一场另一侧不动", !!next && next.teamAName === "别的队");
}

// ⑤ 下一场已经打完 → 拒绝（不能把已打的结果清空）
{
  const s = state([
    match("M1", { status: "已完成", winnerTeamId: "A-M1", nextMatchId: "M2", nextSide: "A", gameResults: [{ map: "", teamAScore: 1, teamBScore: 0 }] }),
    match("M2", { status: "已完成", winnerTeamId: "A-M2", gameResults: [{ map: "", teamAScore: 1, teamBScore: 0 }] }),
  ]);
  const out = revertResultOp(s, "M1");
  check("下一场已有赛果时拒绝", !out.ok, out.ok ? "竟然成功了" : "");
}

// ⑥ 不存在的场 → 拒绝
{
  const out = revertResultOp(state([match("M1")]), "M9");
  check("不存在的场拒绝", !out.ok);
}

console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项失败`);
if (failed > 0) process.exit(1);
