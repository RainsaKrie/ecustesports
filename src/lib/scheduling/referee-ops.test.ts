// =====================
// RPT-02 裁判身份、凭证与比赛分配纯函数测试
// 运行：npx tsx src/lib/scheduling/referee-ops.test.ts
// =====================

import {
  assignMatchOp,
  authenticateReferee,
  authorizeReferee,
  checkCredential,
  claimMatchOp,
  createRefereeOp,
  disableRefereeOp,
  emptyRefereeLedger,
  hashCredential,
  releaseClaimOp,
  resetCredentialOp,
  revokeAssignmentOp,
  type RefereeOpResult,
} from "./referee-ops";
import type { RefereeLedger } from "./referee-domain";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

const EVENT = "evt-1";
const OTHER_EVENT = "evt-2";
const EXPIRY_FUTURE = "2026-12-31T23:59:59.000Z";
const EXPIRY_PAST = "2020-01-01T00:00:00.000Z";
const ADMIN = "admin-1";

function newReferee(ledger: RefereeLedger, overrides: { expiresAt?: string; eventId?: string } = {}): { ledger: RefereeLedger; refereeId: string; credential: string } {
  const r = createRefereeOp(
    { eventId: overrides.eventId ?? EVENT, displayName: "裁判甲", actorId: ADMIN, credentialExpiresAt: overrides.expiresAt ?? EXPIRY_FUTURE },
    ledger,
  ) as RefereeOpResult<{ refereeId: string; credential: string }>;
  return { ledger: r.state!, refereeId: r.value!.refereeId, credential: r.value!.credential };
}

console.log("== 组1 · 明细存储与生成 ==");
{
  const { ledger, credential } = newReferee(emptyRefereeLedger());
  check("创建返回明文凭证", credential.length >= 32);
  check("服务端只存哈希（不存明文）", ledger.referees[0].credentialHash === hashCredential(credential));
  check("明文不在台账中", !JSON.stringify(ledger).includes(credential));
  check("凭证使用加密安全随机数（两次不同）", hashCredential(credential) !== hashCredential(newReferee(emptyRefereeLedger()).credential));
}

console.log("\n== 组2 · 凭证校验（防枚举统一失败） ==");
{
  const { ledger, credential } = newReferee(emptyRefereeLedger());
  check("正确凭证通过", checkCredential(credential, ledger).ok);
  check("错误凭证统一返回 INVALID_CREDENTIAL", (() => {
    const r = checkCredential("wrong-credential-abcde-fghij", ledger);
    return !r.ok && r.reason === "INVALID_CREDENTIAL";
  })());
  check("不存在的裁判与错误凭证无法区分", (() => {
    const a = checkCredential("no-such-credential-xxxxx", ledger);
    const b = checkCredential("wrong-credential-abcde-fghij", ledger);
    return !a.ok && !b.ok && a.reason === b.reason;
  })());
  check("过短凭证直接拒绝", !checkCredential("abc", ledger).ok);
}

console.log("\n== 组3 · 权限推导（不依赖客户端 refereeId） ==");
{
  let l = emptyRefereeLedger();
  const made = newReferee(l);
  l = made.ledger;
  const assign = assignMatchOp({ eventId: EVENT, matchId: "M1", refereeId: made.refereeId, actorId: ADMIN }, l);
  l = assign.state!;

  check("已分配 + 有效凭证 → 允许", authorizeReferee(made.credential, EVENT, "M1", l).ok);
  // authenticateReferee 只校验凭证有效与事件范围，不检查单场分配（「我的比赛」列表场景）
  check("无任何分配也能 authenticate（列表）", authenticateReferee(made.credential, EVENT, l).ok);
  check("错误凭证 authenticate → INVALID_CREDENTIAL", (() => {
    const r = authenticateReferee("wrong-credential-abcde-fghij", EVENT, l);
    return !r.ok && r.reason === "INVALID_CREDENTIAL";
  })());
  check("跨赛事 authenticate → WRONG_EVENT", (() => {
    const r = authenticateReferee(made.credential, OTHER_EVENT, l);
    return !r.ok && r.reason === "WRONG_EVENT";
  })());
  check("未分配比赛 → NOT_ASSIGNED", (() => {
    const r = authorizeReferee(made.credential, EVENT, "M2", l);
    return !r.ok && r.reason === "NOT_ASSIGNED";
  })());
  check("跨赛事 → WRONG_EVENT", (() => {
    const r = authorizeReferee(made.credential, OTHER_EVENT, "M1", l);
    return !r.ok && r.reason === "WRONG_EVENT";
  })());

  // 过期
  const exp = newReferee(emptyRefereeLedger(), { expiresAt: EXPIRY_PAST });
  const expAssign = assignMatchOp({ eventId: EVENT, matchId: "M1", refereeId: exp.refereeId, actorId: ADMIN }, exp.ledger);
  check("凭证过期 → EXPIRED", (() => {
    const r = authorizeReferee(exp.credential, EVENT, "M1", expAssign.state!, "2021-01-01T00:00:00.000Z");
    return !r.ok && r.reason === "EXPIRED";
  })());

  // 停用
  const dis = newReferee(emptyRefereeLedger());
  const disAssign = assignMatchOp({ eventId: EVENT, matchId: "M1", refereeId: dis.refereeId, actorId: ADMIN }, dis.ledger);
  const disabled = disableRefereeOp(dis.refereeId, ADMIN, disAssign.state!) as RefereeOpResult;
  check("停用后 → DISABLED", (() => {
    const r = authorizeReferee(dis.credential, EVENT, "M1", disabled.state!);
    return !r.ok && r.reason === "DISABLED";
  })());
}

console.log("\n== 组4 · 撤销分配与重置 ==");
{
  let l = emptyRefereeLedger();
  const made = newReferee(l);
  l = made.ledger;
  const assign = assignMatchOp({ eventId: EVENT, matchId: "M1", refereeId: made.refereeId, actorId: ADMIN }, l);
  l = assign.state!;
  const revoke = revokeAssignmentOp({ assignmentId: assign.value!.assignmentId, actorId: ADMIN }, l);
  l = revoke.state!;
  check("撤销分配后 → NOT_ASSIGNED", (() => {
    const r = authorizeReferee(made.credential, EVENT, "M1", l);
    return !r.ok && r.reason === "NOT_ASSIGNED";
  })());

  // 重置凭证：旧凭证失效、新凭证生效
  const made2 = newReferee(emptyRefereeLedger());
  const assign2 = assignMatchOp({ eventId: EVENT, matchId: "M1", refereeId: made2.refereeId, actorId: ADMIN }, made2.ledger);
  const reset = resetCredentialOp({ refereeId: made2.refereeId, actorId: ADMIN, newCredentialExpiresAt: EXPIRY_FUTURE }, assign2.state!) as RefereeOpResult<{ credential: string }>;
  check("重置后旧凭证失效", (() => {
    const r = authorizeReferee(made2.credential, EVENT, "M1", reset.state!);
    return !r.ok && r.reason === "INVALID_CREDENTIAL";
  })());
  check("重置后新凭证生效", authorizeReferee(reset.value!.credential, EVENT, "M1", reset.state!).ok);
}

console.log("\n== 组5 · 审计追溯 ==");
{
  let l = emptyRefereeLedger();
  const made = newReferee(l);
  l = made.ledger;
  const assign = assignMatchOp({ eventId: EVENT, matchId: "M1", refereeId: made.refereeId, actorId: ADMIN }, l);
  l = assign.state!;
  const reset = resetCredentialOp({ refereeId: made.refereeId, actorId: ADMIN, newCredentialExpiresAt: EXPIRY_FUTURE }, l) as RefereeOpResult<{ credential: string }>;
  check("审计记录 create + assign + reset", (() => {
    const actions = reset.state!.audit.map((a) => a.action);
    return actions.includes("create-referee") && actions.includes("assign-match") && actions.includes("reset-credential");
  })());
  check("审计不泄露凭证明文", !JSON.stringify(reset.state!.audit).includes(reset.value!.credential));
}

console.log("\n== 组6 · 不加入选手名单 / 边界 ==");
{
  check("停用无变化的裁判幂等", disableRefereeOp("ref-none", ADMIN, emptyRefereeLedger()).ok === false);
  check("撤销不存在的分配被拒", !revokeAssignmentOp({ assignmentId: "asg-none", actorId: ADMIN }, emptyRefereeLedger()).ok);
  check("重复分配不产生重复记录", (() => {
    let l = emptyRefereeLedger();
    const made = newReferee(l);
    l = made.ledger;
    l = assignMatchOp({ eventId: EVENT, matchId: "M1", refereeId: made.refereeId, actorId: ADMIN }, l).state!;
    const again = assignMatchOp({ eventId: EVENT, matchId: "M1", refereeId: made.refereeId, actorId: ADMIN }, l);
    return again.ok && again.state!.assignments.filter((a) => a.matchId === "M1" && a.refereeId === made.refereeId && a.status === "assigned").length === 1;
  })());
  check("跨赛事分配被拒绝", (() => {
    const made = newReferee(emptyRefereeLedger());
    const result = assignMatchOp({ eventId: OTHER_EVENT, matchId: "M1", refereeId: made.refereeId, actorId: ADMIN }, made.ledger);
    return !result.ok && result.code === "WRONG_EVENT";
  })());
  check("无效凭证有效期被拒绝", (() => {
    const result = createRefereeOp(
      { eventId: EVENT, displayName: "裁判乙", actorId: ADMIN, credentialExpiresAt: "not-a-date" },
      emptyRefereeLedger(),
    );
    return !result.ok && result.code === "INVALID_EXPIRY";
  })());
  check("重复撤销不追加审计", (() => {
    const made = newReferee(emptyRefereeLedger());
    const assigned = assignMatchOp({ eventId: EVENT, matchId: "M1", refereeId: made.refereeId, actorId: ADMIN }, made.ledger);
    const first = revokeAssignmentOp({ assignmentId: assigned.value!.assignmentId, actorId: ADMIN }, assigned.state!);
    const auditCount = first.state!.audit.length;
    const again = revokeAssignmentOp({ assignmentId: assigned.value!.assignmentId, actorId: ADMIN }, first.state!);
    return again.ok && again.reason === "已撤销" && again.state!.audit.length === auditCount;
  })());
}

// =====================
// 裁判自助认领（2026-09-15 新增）
//
// 背景：原流程是负责人在管理端逐场指派。实际流程是队伍先约赛得到比赛列表，
// 裁判自己看哪些能执裁。指派于是变成负责人的负担，且会出现「没人认领」的空档。
// =====================
{
  console.log("\n== 裁判自助认领 ==");
  const made = newReferee(emptyRefereeLedger());
  check("认领成功", (() => {
    const r = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: made.refereeId }, made.ledger);
    return r.ok && r.state!.assignments.length === 1;
  })());
  check("标记为自助认领并记录认领时间", (() => {
    const st = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: made.refereeId }, made.ledger).state!;
    const a = st.assignments[0];
    return a.selfClaimed === true && typeof a.claimedAt === "string" && a.assignedBy === made.refereeId;
  })());
  check("写入 claim-match 审计", (() => {
    const st = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: made.refereeId }, made.ledger).state!;
    return st.audit.some((e) => e.action === "claim-match" && e.actorId === made.refereeId);
  })());
  check("重复认领幂等（不报错、不重复写入）", (() => {
    const first = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: made.refereeId }, made.ledger);
    const again = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: made.refereeId }, first.state!);
    return again.ok && again.reason === "你已认领该场" && again.state!.assignments.length === 1;
  })());

  console.log("");
  console.log("== ★ 抢单冲突：两个裁判同时认领同一场 ==");
  {
    // 造两个裁判
    const a = newReferee(emptyRefereeLedger());
    const b = newReferee(a.ledger);
    const first = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: a.refereeId }, b.ledger);
    check("裁判甲先认领成功", first.ok && first.state!.assignments.length === 1);

    const second = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: b.refereeId }, first.state!);
    check("裁判乙认领同一场被拒绝", !second.ok && second.code === "MATCH_TAKEN");
    check("拒绝理由是「已被他人认领」", !second.ok && second.error.includes("已被"), !second.ok ? second.error : "");
    check("台账没有被写入第二条", first.state!.assignments.length === 1);

    // 换一场则不受影响
    const other = claimMatchOp({ eventId: EVENT, matchId: "M2", refereeId: b.refereeId }, first.state!);
    check("换一场仍可认领", other.ok && other.state!.assignments.length === 2);
  }

  console.log("");
  console.log("== 释放自己认领的比赛 ==");
  {
    const a = newReferee(emptyRefereeLedger());
    const claimed = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: a.refereeId }, a.ledger);
    const released = releaseClaimOp({ eventId: EVENT, matchId: "M1", refereeId: a.refereeId }, claimed.state!);
    check("释放成功", released.ok);
    check("分配变为 revoked", (() => {
      const mine = released.state!.assignments.filter((x) => x.matchId === "M1");
      return mine.length === 1 && mine[0].status === "revoked";
    })());
    check("写入 release-claim 审计", released.state!.audit.some((e) => e.action === "release-claim"));

    // 释放后该场可以再被别人认领（不能留下永久占用）
    const b = newReferee(released.state!);
    const reclaim = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: b.refereeId }, b.ledger);
    check("释放后他人可再次认领", reclaim.ok && reclaim.state!.assignments.filter((x) => x.matchId === "M1" && x.status === "assigned").length === 1);

    // 没认领过的场次不能释放
    const notClaimed = releaseClaimOp({ eventId: EVENT, matchId: "M9", refereeId: a.refereeId }, a.ledger);
    check("未认领的场次不能释放", !notClaimed.ok && notClaimed.code === "NOT_CLAIMED");
  }

  console.log("");
  console.log("== ★ 被指派的场次不能由裁判自己丢掉 ==");
  {
    // 理由：负责人指派是「没人认领」时的兜底。若被指派人可以自行释放，
    // 这个兜底就形同虚设——他可以单方面卸责。
    const a = newReferee(emptyRefereeLedger());
    const assigned = assignMatchOp({ eventId: EVENT, matchId: "M1", refereeId: a.refereeId, actorId: ADMIN }, a.ledger);
    const refused = releaseClaimOp({ eventId: EVENT, matchId: "M1", refereeId: a.refereeId }, assigned.state!);
    check("裁判不能释放负责人指派的场次", !refused.ok && refused.code === "NOT_SELF_CLAIMED");
    check("提示去找负责人", !refused.ok && refused.error.includes("负责人"), !refused.ok ? refused.error : "");
    check("分配保持 assigned", assigned.state!.assignments[0].status === "assigned");
  }

  console.log("");
  console.log("== ★ 负责人指派不会覆盖别人的认领 ==");
  {
    const a = newReferee(emptyRefereeLedger());
    const b = newReferee(a.ledger);
    const claimed = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: a.refereeId }, b.ledger);
    const override = assignMatchOp({ eventId: EVENT, matchId: "M1", refereeId: b.refereeId, actorId: ADMIN }, claimed.state!);
    check("已被认领的场次不能被指派覆盖", !override.ok && override.code === "MATCH_TAKEN");
    check("提示先撤销认领", !override.ok && override.error.includes("撤销"), !override.ok ? override.error : "");
    check("仍只有一条分配", claimed.state!.assignments.length === 1);

    // 换一场可以正常指派
    const okAssign = assignMatchOp({ eventId: EVENT, matchId: "M2", refereeId: b.refereeId, actorId: ADMIN }, claimed.state!);
    check("未被占用的场次可正常指派", okAssign.ok);
  }

  console.log("");
  console.log("== 认领的边界条件 ==");
  {
    const a = newReferee(emptyRefereeLedger());
    check("停用的裁判不能认领", (() => {
      const disabled = disableRefereeOp(a.refereeId, ADMIN, a.ledger);
      const r = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: a.refereeId }, disabled.state!);
      return !r.ok && r.code === "REFEREE_DISABLED";
    })());
    check("不存在的裁判不能认领", (() => {
      const r = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: "no-such" }, a.ledger);
      return !r.ok && r.code === "REFEREE_NOT_FOUND";
    })());
    check("跨赛事认领被拒绝", (() => {
      const other = newReferee(emptyRefereeLedger(), { eventId: OTHER_EVENT });
      const r = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: other.refereeId }, other.ledger);
      return !r.ok && r.code === "WRONG_EVENT";
    })());
    check("认领后即通过 authorizeReferee（可进入报分）", (() => {
      const r = claimMatchOp({ eventId: EVENT, matchId: "M1", refereeId: a.refereeId }, a.ledger);
      const auth = authorizeReferee(a.credential, EVENT, "M1", r.state!);
      return auth.ok && auth.refereeId === a.refereeId;
    })());
  }
}

console.log(`\n结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
