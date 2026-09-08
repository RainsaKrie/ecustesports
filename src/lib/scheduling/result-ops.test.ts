// =====================
// RPT-01 赛果状态机纯函数测试
// 运行：npx tsx src/lib/scheduling/result-ops.test.ts
// 覆盖：合法性 / 身份版本 / 幂等重复 / 生效路径 / 下游恢复 / 晋级正确性与撤销原子性
// =====================

import type { ScheduleMatch, GameResult } from "./schedule-data";
import {
  submitResultOp,
  resolveReviewOp,
  correctResultOp,
  emptyLedger,
  computeDownstreamImpact,
  type ResultContext,
  type MatchAssignment,
} from "./result-ops";
import type { MatchReviewPolicy } from "./result-domain";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}
function g(a: number, b: number, map?: string): GameResult {
  return { map, teamAScore: a, teamBScore: b };
}

// ---------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------

const REVIEW_POLICY: MatchReviewPolicy = { forcedRounds: ["半决赛", "决赛"], forceReview: false };

function match(id: string, extra: Partial<ScheduleMatch> = {}): ScheduleMatch {
  return {
    id,
    phase: "小组赛",
    teamAId: `${id}-A`,
    teamBId: `${id}-B`,
    teamAName: `${id}-A名`,
    teamBName: `${id}-B名`,
    boType: "BO3",
    startTime: "2026-10-06T12:00:00",
    endTime: "2026-10-06T13:30:00",
    status: "已排期",
    frozen: false,
    ...extra,
  };
}

/** A 胜的状态（BO3 2:0） */
const A_WINS: GameResult[] = [g(13, 5), g(13, 7)];
const B_WINS: GameResult[] = [g(5, 13), g(7, 13)];

function ctx(matches: ScheduleMatch[], assignments?: MatchAssignment[], scheduleVersion = 1): ResultContext {
  return { matches, ledger: emptyLedger(), scheduleVersion, assignments: assignments ?? [], reviewPolicy: REVIEW_POLICY };
}

const REF = "ref-1";
function assign(matchId: string, refereeId = REF): MatchAssignment {
  return { matchId, refereeId, status: "assigned" };
}

console.log("== 组1 · 合法性校验 ==");
{
  const m = match("M1");
  const c = ctx([m], [assign("M1")]);
  check("BO3 2:0 合法且生效", submitResultOp({ matchId: "M1", refereeId: REF, basedOnScheduleVersion: 1, games: A_WINS }, c).ok);
  check("平局被拦", !submitResultOp({ matchId: "M1", refereeId: REF, basedOnScheduleVersion: 1, games: [g(13, 5), g(7, 7)] }, c).ok);
  check("局数不足被拦", !submitResultOp({ matchId: "M1", refereeId: REF, basedOnScheduleVersion: 1, games: [] }, c).ok);
  check("局数超限被拦", !submitResultOp({ matchId: "M1", refereeId: REF, basedOnScheduleVersion: 1, games: [g(13, 5), g(13, 7), g(13, 6)] }, c).ok);
}

console.log("\n== 组2 · 身份与版本 ==");
{
  const m = match("M2");
  check("比赛不存在被拦", !submitResultOp({ matchId: "NOPE", refereeId: REF, basedOnScheduleVersion: 1, games: A_WINS }, ctx([m], [assign("M2")])).ok);
  check("版本过期被拦(409)", (() => {
    const r = submitResultOp({ matchId: "M2", refereeId: REF, basedOnScheduleVersion: 99, games: A_WINS }, ctx([m], [assign("M2")]));
    return !r.ok && r.code === "VERSION_CONFLICT";
  })());
  check("未分配裁判被拦", !submitResultOp({ matchId: "M2", refereeId: "ref-else", basedOnScheduleVersion: 1, games: A_WINS }, ctx([m], [assign("M2")])).ok);
  check("已撤销分配被拦", (() => {
    const c = ctx([m], [{ matchId: "M2", refereeId: REF, status: "revoked" }]);
    return !submitResultOp({ matchId: "M2", refereeId: REF, basedOnScheduleVersion: 1, games: A_WINS }, c).ok;
  })());
}

console.log("\n== 组3 · 幂等与重复 ==");
{
  const m = match("M3");
  const input = { matchId: "M3", refereeId: REF, basedOnScheduleVersion: 1, games: A_WINS };
  const c1 = ctx([m], [assign("M3")]);
  const r1 = submitResultOp(input, c1);
  check("首次提交生效", r1.ok && r1.value?.status === "accepted");
  const state1 = r1.state!;
  check("生效后 resultVersion=1", state1.ledger.resultVersion === 1);
  // 同 ID 重复提交
  const r2 = submitResultOp({ ...input, submissionId: r1.value!.submissionId }, state1);
  check("同 ID 重复提交幂等（不重复推进）", r2.ok && state1.ledger.submissions.length === 1 && r2.state!.ledger.resultVersion === 1);
  // 同场相同结果（构造不同 ID 但结果一致）
  const r3 = submitResultOp(input, c1);
  check("同场相同结果不产生新记录", r3.ok && r3.value?.status === "accepted");
}

console.log("\n== 组4 · 生效路径（提交即生效 vs 强制复核） ==");
{
  const normal = match("M4a");
  const c = ctx([normal], [assign("M4a")]);
  const r = submitResultOp({ matchId: "M4a", refereeId: REF, basedOnScheduleVersion: 1, games: A_WINS }, c);
  check("普通合法结果直接生效（决策3）", r.ok && r.value?.status === "accepted");
  check("生效后比赛标记已完成", r.state!.matches.find((m) => m.id === "M4a")?.status === "已完成");
  check("生效后 winnerTeamId 写正", r.state!.matches.find((m) => m.id === "M4a")?.winnerTeamId === "M4a-A");

  const semi = match("M4b", { round: "半决赛" });
  const c2 = ctx([semi], [assign("M4b")]);
  const r2 = submitResultOp({ matchId: "M4b", refereeId: REF, basedOnScheduleVersion: 1, games: A_WINS }, c2);
  check("半决赛进 needs-review（决策4）", r2.ok && r2.value?.status === "needs-review");
  check("needs-review 不碰正式赛果", r2.state!.matches.find((m) => m.id === "M4b")?.status !== "已完成");
}

console.log("\n== 组5 · 下游恢复（决策6） ==");
{
  // 下游无进度
  const up = match("M5", { nextMatchId: "M6", nextSide: "A" });
  const down = match("M6", { startTime: "", status: "待排期" });
  const c = ctx([up, down], [assign("M5")]);
  const impact = computeDownstreamImpact(up, c.matches);
  check("占位下游：无进度标记", !impact.hasScheduledDownstream && !impact.hasProgressedDownstream);

  // 下游已排期未 BP
  const down2 = match("M6", { startTime: "2026-10-07T12:00:00", status: "已排期" });
  const impact2 = computeDownstreamImpact(up, [up, down2]);
  check("下游已排期：hasScheduledDownstream", impact2.hasScheduledDownstream && !impact2.hasProgressedDownstream);

  // 下游已 BP
  const down3 = match("M6", { startTime: "2026-10-07T12:00:00", status: "已排期", bpMaps: ["莲花"] });
  const impact3 = computeDownstreamImpact(up, [up, down3]);
  check("下游已 BP：hasProgressedDownstream", impact3.hasProgressedDownstream);
}

console.log("\n== 组5b · 受控更正 ==");
{
  // 下游已 BP → 必须阻止
  const up = match("M7", { nextMatchId: "M8", nextSide: "A", status: "已完成", gameResults: A_WINS, winnerTeamId: "M7-A" });
  const down = match("M8", { bpMaps: ["莲花"] });
  const ledger = emptyLedger();
  ledger.submissions.push({ id: "s1", matchId: "M7", submittedByRefereeId: REF, basedOnScheduleVersion: 1, games: A_WINS, declaredWinnerTeamId: "M7-A", evidenceIds: [], source: "manual", status: "accepted", submittedAt: new Date().toISOString() });
  ledger.resultVersion = 1;
  const c = { matches: [up, down], ledger, scheduleVersion: 1, assignments: [assign("M7")], reviewPolicy: REVIEW_POLICY };
  const r = correctResultOp({ matchId: "M7", actorId: "admin", reason: "更正", newGames: B_WINS, newWinnerTeamId: "M7-B" }, c);
  check("下游已 BP 更正被阻止", !r.ok && r.code === "DOWNSTREAM_PROGRESSED");

  // 无下游进度 → 允许更正
  const up2 = match("M9", { status: "已完成", gameResults: A_WINS, winnerTeamId: "M9-A" });
  const ledger2 = emptyLedger();
  ledger2.submissions.push({ id: "s2", matchId: "M9", submittedByRefereeId: REF, basedOnScheduleVersion: 1, games: A_WINS, declaredWinnerTeamId: "M9-A", evidenceIds: [], source: "manual", status: "accepted", submittedAt: new Date().toISOString() });
  ledger2.resultVersion = 1;
  const c2 = { matches: [up2], ledger: ledger2, scheduleVersion: 1, assignments: [assign("M9")], reviewPolicy: REVIEW_POLICY };
  const r2 = correctResultOp({ matchId: "M9", actorId: "admin", reason: "更正", newGames: B_WINS, newWinnerTeamId: "M9-B" }, c2);
  check("无下游进度允许更正", r2.ok);
  check("更正后胜者翻转", r2.state!.matches.find((m) => m.id === "M9")?.winnerTeamId === "M9-B");
  check("旧提交被标记 superseded", r2.state!.ledger.submissions.find((s) => s.id === "s2")?.status === "superseded");
}

console.log("\n== 组6 · 晋级正确性与裁决 ==");
{
  // 晋级路径正确
  const up = match("M10", { nextMatchId: "M11", nextSide: "A", teamAId: "T1", teamAName: "队1", teamBId: "T2", teamBName: "队2" });
  const down = match("M11", { teamAId: "", teamAName: "", startTime: "", status: "待排期" });
  const c = ctx([up, down], [assign("M10")]);
  const r = submitResultOp({ matchId: "M10", refereeId: REF, basedOnScheduleVersion: 1, games: A_WINS }, c);
  check("胜者填入下游 A 侧", r.ok && r.state!.matches.find((m) => m.id === "M11")?.teamAId === "T1");

  // needs-review 裁决 accept
  const semi2 = match("M12", { round: "半决赛" });
  const c2 = ctx([semi2], [assign("M12")]);
  const sub = submitResultOp({ matchId: "M12", refereeId: REF, basedOnScheduleVersion: 1, games: A_WINS }, c2);
  const state2 = sub.state!;
  const accepted = resolveReviewOp({ submissionId: sub.value!.submissionId, accept: true, actorId: "admin", reason: "确认" }, state2);
  check("裁决 accept 后生效", accepted.ok && accepted.value?.status === "accepted");
  check("裁决 accept 后比赛完成", accepted.state!.matches.find((m) => m.id === "M12")?.status === "已完成");
  // 钉死 upsert：同 id 不得出现两条记录
  const sameId = accepted.state!.ledger.submissions.filter((s) => s.id === sub.value!.submissionId);
  check("裁决 accept 后同 id 仅一条记录", sameId.length === 1 && sameId[0].status === "accepted");
  check("裁决 accept 后无残留 needs-review", !accepted.state!.ledger.submissions.some((s) => s.id === sub.value!.submissionId && s.status === "needs-review"));
}

console.log("\n== 组6b · 撤销原子性 ==");
{
  // 失败提交不留半更新状态
  const m = match("M13");
  const c = ctx([m], [assign("M13")]);
  const r = submitResultOp({ matchId: "M13", refereeId: REF, basedOnScheduleVersion: 1, games: [g(13, 5), g(7, 7)] }, c);
  check("非法提交不留状态", !r.ok && r.state === undefined);
  check("非法提交不产生记录", c.ledger.submissions.length === 0 && c.matches.find((x) => x.id === "M13")?.status !== "已完成");
}

console.log(`\n结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);