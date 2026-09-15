// =====================
// RPT-04 裁判报分服务编排层集成测试（mock 隔离，不写生产）
// 运行：npx tsx src/lib/scheduling/reporting-service.test.ts
// =====================

import {
  buildResultContext,
  emptyReportingState,
  loginRefereeOp,
  projectAdminReviewQueue,
  projectMyMatches,
  projectOpenMatches,
  projectPublicResults,
  submitRefereeResultOp,
  uploadRefereeEvidenceOp,
  toResultAssignments,
  type ReportingState,
} from "./reporting-service";
import { resolveReviewOp, type ResultContext } from "./result-ops";
import {
  assignMatchOp,
  claimMatchOp,
  createRefereeOp,
  emptyRefereeLedger,
  type RefereeOpResult,
} from "./referee-ops";
import type { RefereeLedger } from "./referee-domain";
import type { ScheduleMatch } from "./schedule-data";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

const EVENT = "evt-1";
const EXPIRY = "2026-12-31T23:59:59.000Z";
const EVENT_ENDS = "2026-10-08T12:00:00.000Z";
const ADMIN = "admin-1";
const SHA = "a".repeat(64);

/** 构造一场 BO3 比赛（A vs B，无下游） */
function match(id: string, overrides: Partial<ScheduleMatch> = {}): ScheduleMatch {
  return {
    id,
    phase: "淘汰赛",
    round: "首轮",
    teamAId: "team-a",
    teamBId: "team-b",
    teamAName: "甲队",
    teamBName: "乙队",
    boType: "BO3",
    startTime: "",
    endTime: "",
    status: "已排期",
    frozen: false,
    ...overrides,
  };
}

/** 建一名已分配 M1 的裁判，返回 { state, credential, refereeId } */
function setupReferee(matchId = "M1") {
  let referee: RefereeLedger = emptyRefereeLedger();
  const made = createRefereeOp({ eventId: EVENT, displayName: "裁判甲", actorId: ADMIN, credentialExpiresAt: EXPIRY }, referee) as RefereeOpResult<{ refereeId: string; credential: string }>;
  referee = made.state!;
  const assigned = assignMatchOp({ eventId: EVENT, matchId, refereeId: made.value!.refereeId, actorId: ADMIN }, referee);
  referee = assigned.state!;
  return { referee, credential: made.value!.credential, refereeId: made.value!.refereeId };
}

/** 组装初始 ReportingState */
function initState(matches: ScheduleMatch[], referee: RefereeLedger, scheduleVersion = 1) {
  const base = emptyReportingState(matches, scheduleVersion, EVENT_ENDS);
  return { ...base, referee };
}

const BO3_GAMES = [
  { map: "图A", teamAScore: 13, teamBScore: 5 },
  { map: "图B", teamAScore: 13, teamBScore: 8 },
];

console.log("== 组1 · 登录与权限推导 ==");
{
  const { referee, credential, refereeId } = setupReferee();
  const state = initState([match("M1")], referee);

  check("有效凭证登录成功", loginRefereeOp(credential, EVENT, state).ok);
  check("登录返回 refereeId", (() => {
    const r = loginRefereeOp(credential, EVENT, state);
    return r.ok && r.value!.refereeId === refereeId;
  })());
  check("错误凭证登录被拒", !loginRefereeOp("wrong-credential-abcdefghijk", EVENT, state).ok);
  check("跨赛事登录被拒", (() => {
    const r = loginRefereeOp(credential, "evt-2", state);
    return !r.ok && r.code === "WRONG_EVENT";
  })());
}

console.log("\n== 组2 · 提交赛果（越权与原子） ==");
{
  // 未分配比赛的裁判不能提交
  const { referee, credential } = setupReferee("M1");
  const state = initState([match("M1"), match("M2")], referee);
  check("未分配比赛提交被拒", (() => {
    const r = submitRefereeResultOp({ credential, eventId: EVENT, matchId: "M2", basedOnScheduleVersion: 1, games: BO3_GAMES }, state);
    return !r.ok && r.code === "NOT_ASSIGNED";
  })());

  // 正常提交 → 提交即生效（decision 3），正式赛果更新
  const ok = submitRefereeResultOp({ credential, eventId: EVENT, matchId: "M1", basedOnScheduleVersion: 1, games: BO3_GAMES }, state);
  check("正常提交生效", ok.ok && ok.value!.status === "accepted");
  check("正式赛果已写入（胜者判定 + 已完成）", (() => {
    const m = ok.state!.matches.find((x) => x.id === "M1")!;
    return m.winnerTeamId === "team-a" && m.status === "已完成";
  })());

  // 幂等：同比分重复提交不双重推进
  const again = submitRefereeResultOp({ credential, eventId: EVENT, matchId: "M1", basedOnScheduleVersion: 1, games: BO3_GAMES }, state);
  check("重复提交幂等（仍 accepted，正式赛果不重复推进）", (() => {
    const acceptedCount = again.state!.result.submissions.filter((s) => s.matchId === "M1" && s.status === "accepted").length;
    return again.ok && acceptedCount === 1;
  })());

  // 版本冲突 → 409 不静默覆盖
  check("版本冲突被拒", (() => {
    const r = submitRefereeResultOp({ credential, eventId: EVENT, matchId: "M1", basedOnScheduleVersion: 99, games: BO3_GAMES }, state);
    return !r.ok && r.code === "VERSION_CONFLICT";
  })());
}

console.log("\n== 组3 · 证据先传后挂 ==");
{
  const { referee, credential } = setupReferee();
  const state = initState([match("M1")], referee);

  // 先传证据草稿
  const ev = uploadRefereeEvidenceOp({ credential, eventId: EVENT, matchId: "M1", mimeType: "image/png", sizeBytes: 64, sha256: SHA }, state);
  check("上传证据草稿成功", ev.ok && ev.value!.evidenceId !== undefined);
  check("未分配比赛上传证据被拒", (() => {
    const r = uploadRefereeEvidenceOp({ credential, eventId: EVENT, matchId: "M2", mimeType: "image/png", sizeBytes: 64, sha256: SHA }, initState([match("M1"), match("M2")], referee));
    return !r.ok && r.code === "NOT_ASSIGNED";
  })());

  // 带上证据提交 → 证据挂到提交
  const withEvidence = submitRefereeResultOp({ credential, eventId: EVENT, matchId: "M1", basedOnScheduleVersion: 1, games: BO3_GAMES, evidenceIds: [ev.value!.evidenceId] }, ev.state!);
  check("带证据提交生效", withEvidence.ok && withEvidence.value!.status === "accepted");
  check("证据挂到提交（submissionId 已填）", (() => {
    const record = withEvidence.state!.evidence.evidence.find((e) => e.id === ev.value!.evidenceId)!;
    return record.submissionId === withEvidence.value!.submissionId;
  })());

  // 挂到不存在的证据 → 拒绝
  check("提交引用不存在证据被拒", (() => {
    const r = submitRefereeResultOp({ credential, eventId: EVENT, matchId: "M1", basedOnScheduleVersion: 1, games: BO3_GAMES, evidenceIds: ["EVD-none"] }, state);
    return !r.ok && r.code === "EVIDENCE_NOT_FOUND";
  })());
}

console.log("\n== 组4 · 投影最小化 ==");
{
  const { referee, credential, refereeId } = setupReferee();
  const matches = [match("M1"), match("M2")];
  let state = initState(matches, referee);
  // 给 M1 提交生效
  const done = submitRefereeResultOp({ credential, eventId: EVENT, matchId: "M1", basedOnScheduleVersion: 1, games: BO3_GAMES }, state);
  state = done.state!;

  check("我的比赛只含被分配场次", (() => {
    const mine = projectMyMatches(state, refereeId);
    return mine.length === 1 && mine[0].matchId === "M1";
  })());

  check("公开赛程只含已 accepted 的正式赛果", (() => {
    const pub = projectPublicResults(state);
    return pub.length === 1 && pub[0].winnerTeamName === "甲队";
  })());

  check("公开赛程不泄露提交记录/凭证/哈希/内部 ID", (() => {
    const pub = JSON.stringify(projectPublicResults(state));
    return !pub.includes(credential) && !pub.includes(credential.slice(0, 20)) && !pub.includes("credentialHash") && !pub.includes("team-a") && !pub.includes("team-b") && !pub.includes("ref-");
  })());

  check("凭证/哈希字段不在公开投影中", (() => {
    const pub = projectPublicResults(state);
    return pub.every((p) => !("submissionId" in p) && !("refereeId" in p) && !("sha256" in p));
  })());
}

console.log("\n== 组5 · 分配关系投影 ==");
{
  const { referee } = setupReferee("M1");
  const assignments = toResultAssignments(referee);
  check("投影只含 active 分配", assignments.length === 1 && assignments[0].matchId === "M1");
  check("buildResultContext 组装赛果上下文", (() => {
    const ctx = buildResultContext(initState([match("M1")], referee));
    return ctx.assignments.length === 1 && ctx.scheduleVersion === 1;
  })());
}

console.log("\n== 组6 · 管理员异常队列投影（RPT-06） ==");
{
  // 强制复核场次（半决赛）→ needs-review + 强制复核标签
  const { referee, credential } = setupReferee("M1");
  const semiFinal = [match("M1", { round: "半决赛" })];
  const state = initState(semiFinal, referee);
  const submitted = submitRefereeResultOp({ credential, eventId: EVENT, matchId: "M1", basedOnScheduleVersion: 1, games: BO3_GAMES }, state);
  check("半决赛提交进入 needs-review", submitted.ok && submitted.value!.status === "needs-review");

  const queue = projectAdminReviewQueue(submitted.state!);
  check("异常队列含该提交", queue.length === 1 && queue[0].matchId === "M1");
  check("强制复核标签正确", queue[0].riskTag === "强制复核");
  check("风险原因可读", queue[0].riskReason.includes("强制复核"));

  // 普通场次直接 accepted，不进异常队列
  const normal = [match("M2", { round: "首轮" })];
  const { referee: r2, credential: c2 } = setupReferee("M2");
  const st2 = initState(normal, r2);
  const ok2 = submitRefereeResultOp({ credential: c2, eventId: EVENT, matchId: "M2", basedOnScheduleVersion: 1, games: BO3_GAMES }, st2);
  check("普通场次直接生效不进队列", ok2.ok && ok2.value!.status === "accepted" && projectAdminReviewQueue(ok2.state!).length === 0);

  // 结果冲突：同场已 accepted，再提交相反胜者 → 结果冲突标签
  const { referee: r3, credential: c3 } = setupReferee("M3");
  const st3 = initState([match("M3", { round: "首轮" })], r3);
  const first = submitRefereeResultOp({ credential: c3, eventId: EVENT, matchId: "M3", basedOnScheduleVersion: 1, games: BO3_GAMES }, st3);
  // 反转比分（乙队胜）
  const REVERSE_GAMES = [
    { map: "图A", teamAScore: 5, teamBScore: 13 },
    { map: "图B", teamAScore: 8, teamBScore: 13 },
  ];
  const conflict = submitRefereeResultOp({ credential: c3, eventId: EVENT, matchId: "M3", basedOnScheduleVersion: 1, games: REVERSE_GAMES }, first.state!);
  check("相反胜者提交进入 needs-review", conflict.ok && conflict.value!.status === "needs-review");
  const conflictQueue = projectAdminReviewQueue(conflict.state!);
  check("结果冲突标签正确", conflictQueue.length === 1 && conflictQueue[0].riskTag === "结果冲突");
  check("冲突场景带出已生效胜者", conflictQueue[0].existingAcceptedWinnerTeamName === "甲队");

  // 裁决 accept → 队列清空 + 正式赛果更新
  const ctx: ResultContext = buildResultContext(conflict.state!);
  const resolve = resolveReviewOp({ submissionId: conflictQueue[0].submissionId, accept: true, actorId: ADMIN, reason: "核对截图确认乙队胜" }, ctx);
  check("裁决 accept 成功", resolve.ok && resolve.value!.status === "accepted");
  const stAfter = { ...conflict.state!, matches: resolve.state!.matches, result: resolve.state!.ledger } as ReportingState;
  check("裁决后队列清空", projectAdminReviewQueue(stAfter).length === 0);
  check("裁决后正式赛果胜者为乙队", (() => {
    const m = stAfter.matches.find((x) => x.id === "M3")!;
    return m.winnerTeamId === "team-b" && m.status === "已完成";
  })());

  // 裁决 reject → 队列清空 + 正式赛果不变（仍是甲队）
  // 重新构造一个冲突场景走 reject 分支
  const { referee: r4, credential: c4 } = setupReferee("M4");
  const st4b = initState([match("M4", { round: "首轮" })], r4);
  const first4 = submitRefereeResultOp({ credential: c4, eventId: EVENT, matchId: "M4", basedOnScheduleVersion: 1, games: BO3_GAMES }, st4b);
  const conflict4 = submitRefereeResultOp({ credential: c4, eventId: EVENT, matchId: "M4", basedOnScheduleVersion: 1, games: REVERSE_GAMES }, first4.state!);
  const q4 = projectAdminReviewQueue(conflict4.state!);
  const reject = resolveReviewOp({ submissionId: q4[0].submissionId, accept: false, actorId: ADMIN, reason: "凭证不足" }, buildResultContext(conflict4.state!));
  check("裁决 reject 成功", reject.ok && reject.value!.status === "rejected");
  const stAfterReject = { ...conflict4.state!, matches: reject.state!.matches, result: reject.state!.ledger } as ReportingState;
  check("驳回后队列清空", projectAdminReviewQueue(stAfterReject).length === 0);
  check("驳回后正式赛果仍为甲方", (() => {
    const m = stAfterReject.matches.find((x) => x.id === "M4")!;
    return m.winnerTeamId === "team-a";
  })());
}

// =====================
// 可认领的比赛（2026-09-15 新增）
//
// 对应流程：队伍先约赛得到比赛列表 → 裁判自己看哪些能执裁 → 认领。
// 所以入选条件是「已排期 + 未完成 + 尚无人认领」，三条缺一不可。
// =====================
{
  console.log("\n== 可认领的比赛列表 ==");

  function stateWithMatches(matches: ScheduleMatch[], ledger: RefereeLedger): ReportingState {
    return { ...emptyReportingState(matches, 5), referee: ledger };
  }

  const madeRef = createRefereeOp(
    { eventId: EVENT, displayName: "裁判甲", actorId: ADMIN, credentialExpiresAt: EXPIRY },
    emptyRefereeLedger(),
  ) as RefereeOpResult<{ refereeId: string; credential: string }>;
  const refId = madeRef.value!.refereeId;

  const M = [
    match("M1", { startTime: "2026-10-06T12:00:00", endTime: "2026-10-06T13:30:00" }),
    // 未排期：裁判无从安排自己，不应出现
    match("M2"),
    // 已完成：不需要裁判
    match("M3", { startTime: "2026-10-06T12:00:00", endTime: "2026-10-06T13:30:00", status: "已完成" }),
    match("M4", { startTime: "2026-10-06T15:00:00", endTime: "2026-10-06T16:30:00" }),
    match("M5", { startTime: "2026-10-06T18:00:00", endTime: "2026-10-06T19:30:00" }),
  ];

  const open = projectOpenMatches(stateWithMatches(M, madeRef.state!), refId);
  const ids = open.map((m) => m.matchId);
  check("只列出已排期且未完成的场次", ids.join(",") === "M1,M4,M5", ids.join(","));
  check("未排期的场次不出现", !ids.includes("M2"));
  check("已完成的场次不出现", !ids.includes("M3"));
  check("按开始时间升序", open[0].startTime <= open[1].startTime && open[1].startTime <= open[2].startTime);

  console.log("");
  console.log("== 已被人认领的场次从列表消失 ==");
  {
    const claimed = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: refId }, madeRef.state!);
    const after = projectOpenMatches(stateWithMatches(M, claimed.state!), refId);
    const afterIds = after.map((m) => m.matchId);
    check("认领后该场不再出现在可认领列表", !afterIds.includes("M1"), afterIds.join(","));
    check("其余场次仍在", afterIds.join(",") === "M4,M5", afterIds.join(","));
  }

  console.log("");
  console.log("== 负责人指派的场次同样从列表消失 ==");
  {
    // 判定「已被占走」时不应区分来源——否则已指派的场次还能被认领，造成两人都以为负责这场
    const assigned = assignMatchOp({ eventId: EVENT, matchId: "M4", refereeId: refId, actorId: ADMIN }, madeRef.state!);
    const after = projectOpenMatches(stateWithMatches(M, assigned.state!), refId);
    check("被指派的场次不在可认领列表", !after.map((m) => m.matchId).includes("M4"), after.map((m) => m.matchId).join(","));
  }

  console.log("");
  console.log("== ★ 时间重叠只提示、不剔除 ==");
  {
    // 先认领 M1（12:00-13:30），再看 M4（15:00-16:30，不重叠）与一场真正重叠的
    const overlapping = [...M, match("M6", { startTime: "2026-10-06T13:00:00", endTime: "2026-10-06T14:30:00" })];
    const claimed = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: refId }, madeRef.state!);
    const list = projectOpenMatches(stateWithMatches(overlapping, claimed.state!), refId);
    const m6 = list.find((x) => x.matchId === "M6");
    const m4 = list.find((x) => x.matchId === "M4");
    check("重叠的场次仍然列出（提示而非拦截）", Boolean(m6), list.map((x) => x.matchId).join(","));
    check("标记为与我已认领的场次重叠", m6?.overlapsMyMatch === true);
    check("不重叠的场次不标记", m4?.overlapsMyMatch === false);
  }

  console.log("");
  console.log("== 「我的比赛」区分认领与指派 ==");
  {
    const mineClaim = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: refId }, madeRef.state!);
    const mineAssign = assignMatchOp({ eventId: EVENT, matchId: "M4", refereeId: refId, actorId: ADMIN }, mineClaim.state!);
    const st = stateWithMatches(M, mineAssign.state!);
    const my = projectMyMatches(st, refId);
    check("两场都在「我的比赛」", my.length === 2, String(my.length));
    check("认领的标记 selfClaimed", my.find((x) => x.matchId === "M1")?.selfClaimed === true);
    check("指派的标记 selfClaimed 为 false", my.find((x) => x.matchId === "M4")?.selfClaimed === false);
    check("带上开始时间", Boolean(my.find((x) => x.matchId === "M1")?.startTime));
    check("按时间排序", my[0].matchId === "M1" && my[1].matchId === "M4", my.map((x) => x.matchId).join(","));
  }

  console.log("");
  console.log("== ★ 改期后「我的比赛」内部重叠要被发现 ==");
  {
    // 场景：裁判认领了 12:00 和 15:00 两场（当时不冲突），
    // 后来其中一场被改到 12:30，两场撞了。
    // ★ 改期不会通知裁判（approveRequestOp 只动赛程文档，不知道裁判台账），
    //   所以这个标记是裁判发现自己时间撞车的唯一途径。
    const base = [
      match("M1", { startTime: "2026-10-06T12:00:00", endTime: "2026-10-06T13:30:00" }),
      match("M2", { startTime: "2026-10-06T15:00:00", endTime: "2026-10-06T16:30:00" }),
    ];
    const claimed1 = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: refId }, madeRef.state!);
    const claimed2 = claimMatchOp({ eventId: EVENT, matchId: "M2", refereeId: refId }, claimed1.state!);

    const beforeReschedule = projectMyMatches(stateWithMatches(base, claimed2.state!), refId);
    check("改期前两场都不算重叠", beforeReschedule.every((m) => !m.overlapsMyMatch),
      beforeReschedule.map((m) => m.matchId + ":" + m.overlapsMyMatch).join(","));

    // 把 M2 改到 12:30（与 M1 的 12:00-13:30 重叠）
    const moved = base.map((m) =>
      m.id === "M2" ? { ...m, startTime: "2026-10-06T12:30:00", endTime: "2026-10-06T14:00:00" } : m,
    );
    const after = projectMyMatches(stateWithMatches(moved, claimed2.state!), refId);
    check("改期后两场都被标记重叠", after.every((m) => m.overlapsMyMatch),
      after.map((m) => m.matchId + ":" + m.overlapsMyMatch).join(","));

    // 首尾相接不算重叠（13:30 结束 / 13:30 开始）
    const adjacent = base.map((m) =>
      m.id === "M2" ? { ...m, startTime: "2026-10-06T13:30:00", endTime: "2026-10-06T15:00:00" } : m,
    );
    const touching = projectMyMatches(stateWithMatches(adjacent, claimed2.state!), refId);
    check("首尾相接不算重叠", touching.every((m) => !m.overlapsMyMatch),
      touching.map((m) => m.matchId + ":" + m.overlapsMyMatch).join(","));

    // 只有一场时不可能重叠
    const onlyOne = stateWithMatches([base[0]], claimed2.state!);
    check("只有一场时不会有重叠标记", projectMyMatches(onlyOne, refId).every((m) => !m.overlapsMyMatch));

    // 未排期的场次不参与重叠判定
    const withUnscheduled = [...base, match("M9")];
    const claimed3 = claimMatchOp({ eventId: EVENT, matchId: "M9", refereeId: refId }, claimed2.state!);
    const un = projectMyMatches(stateWithMatches(withUnscheduled, claimed3.state!), refId);
    check("未排期的场次不算重叠", un.every((m) => !m.overlapsMyMatch),
      un.map((m) => m.matchId + ":" + m.overlapsMyMatch).join(","));

    // 别人的场次不该影响我的重叠判断
    const other = createRefereeOp(
      { eventId: EVENT, displayName: "裁判丙", actorId: ADMIN, credentialExpiresAt: EXPIRY },
      claimed3.state!,
    ) as RefereeOpResult<{ refereeId: string }>;
    const otherClaim = claimMatchOp({ eventId: EVENT, matchId: "M5", refereeId: other.value!.refereeId }, other.state!);
    const mixed = projectMyMatches(
      stateWithMatches([...base, match("M5", { startTime: "2026-10-06T12:10:00", endTime: "2026-10-06T13:40:00" })], otherClaim.state!),
      refId,
    );
    check("别人认领的场次不影响我的重叠判断", mixed.every((m) => !m.overlapsMyMatch),
      mixed.map((m) => m.matchId + ":" + m.overlapsMyMatch).join(","));
  }

  console.log("");
  console.log("== 边界 ==");
  {
    check("没有比赛时返回空数组", projectOpenMatches(stateWithMatches([], madeRef.state!), refId).length === 0);
    // 本函数不做鉴权——那在 API 层（凭证 → refereeId）完成。
    // 所以传入任意 id 都会拿到列表；refereeId 在这里只用于算「与我的场次是否重叠」。
    check("不做鉴权：未知 id 仍返回列表", projectOpenMatches(stateWithMatches(M, madeRef.state!), "no-such").length === 3);
    check("但未知 id 不会有重叠标记", projectOpenMatches(stateWithMatches(M, madeRef.state!), "no-such").every((m) => !m.overlapsMyMatch));
    check(
      "别人认领的场次对我也是不可认领",
      (() => {
        const other = createRefereeOp(
          { eventId: EVENT, displayName: "裁判乙", actorId: ADMIN, credentialExpiresAt: EXPIRY },
          madeRef.state!,
        ) as RefereeOpResult<{ refereeId: string }>;
        const claimedByOther = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: other.value!.refereeId }, other.state!);
        const list = projectOpenMatches(stateWithMatches(M, claimedByOther.state!), refId);
        return !list.map((x) => x.matchId).includes("M1");
      })(),
    );
  }
}

console.log(`\n结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
