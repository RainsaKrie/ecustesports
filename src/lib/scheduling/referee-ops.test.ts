// =====================
// RPT-02 裁判身份、凭证与比赛分配纯函数测试
// 运行：npx tsx src/lib/scheduling/referee-ops.test.ts
// =====================

import {
  assignMatchOp,
  authenticateReferee,
  authorizeReferee,
  checkCredential,
  createRefereeOp,
  disableRefereeOp,
  emptyRefereeLedger,
  hashCredential,
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
  check("正确凭证通过", checkCredential(credential, EVENT, ledger).ok);
  check("错误凭证统一返回 INVALID_CREDENTIAL", (() => {
    const r = checkCredential("wrong-credential-abcde-fghij", EVENT, ledger);
    return !r.ok && r.reason === "INVALID_CREDENTIAL";
  })());
  check("不存在的裁判与错误凭证无法区分", (() => {
    const a = checkCredential("no-such-credential-xxxxx", EVENT, ledger);
    const b = checkCredential("wrong-credential-abcde-fghij", EVENT, ledger);
    return !a.ok && !b.ok && a.reason === b.reason;
  })());
  check("过短凭证直接拒绝", !checkCredential("abc", EVENT, ledger).ok);
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
}

console.log(`\n结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);