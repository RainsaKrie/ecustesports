import assert from "node:assert/strict";

import { addMemberOp, createTeamOp, dissolveTeamOp, leaveTeamOp, renameTeamOp, setMemberRoleOp } from "./registration-ops.ts";
import type { RegistrationPlayer, RegistrationState } from "@/lib/domains/registration/data";

function player(id: string, overrides: Partial<RegistrationPlayer> = {}): RegistrationPlayer {
  return {
    id,
    name: `选手${id}`,
    studentId: `2026${id}`,
    gameId: `Player-${id}`,
    rank: "钻石",
    submittedAt: "2026-09-03T00:00:00.000Z",
    status: "已入队",
    reviewStatus: "已通过",
    teamId: "T-1",
    role: "首发",
    ...overrides,
  };
}

function fixture(): RegistrationState {
  const starters = [1, 2, 3, 4, 5].map((index) => player(String(index)));
  const waiting = [6, 7, 8].map((index) => player(String(index), {
    status: "已报名",
    teamId: undefined,
    role: undefined,
  }));

  return {
    players: [...starters, ...waiting],
    teams: [{
      id: "T-1",
      name: "测试队伍",
      captainId: "1",
      memberIds: starters.map((candidate) => candidate.id),
      status: "报名中",
      createdAt: "2026-09-03T00:00:00.000Z",
    }],
    teamRequests: [],
    operationLogs: [],
    playerRegistrationClosed: false,
    teamRegistrationClosed: false,
  };
}

let state = fixture();
const substitute = addMemberOp(state, { teamId: "T-1", playerId: "6", role: "替补" });
assert.equal(substitute.ok, true);
state = substitute.state!;
assert.equal(state.players.find((candidate) => candidate.id === "6")?.role, "替补");

const coach = addMemberOp(state, { teamId: "T-1", playerId: "7", role: "教练" });
assert.equal(coach.ok, true);
state = coach.state!;
assert.equal(state.players.find((candidate) => candidate.id === "7")?.role, "教练");

const secondSubstitute = addMemberOp(state, { teamId: "T-1", playerId: "8", role: "替补" });
assert.equal(secondSubstitute.ok, false);
assert.match(secondSubstitute.message ?? "", /替补最多 1 人/);

console.log("✓ 队伍支持 5 名首发、1 名替补和 1 名教练，并限制角色人数");

// —— 退出与解散 ——

// 队员退出：非队长、报名中队伍
{
  const s = fixture();
  const beforeRequests = s.teamRequests = [{
    id: "TR-1", type: "application", teamId: "T-1", playerId: "2", role: "首发",
    initiatedByPlayerId: "2", status: "pending", createdAt: "2026-09-03T00:00:00.000Z",
  }];
  const result = leaveTeamOp(s, { playerId: "2" });
  assert.equal(result.ok, true);
  const p = result.state!.players.find((candidate) => candidate.id === "2")!;
  assert.equal(p.status, "已报名");
  assert.equal(p.teamId, undefined);
  assert.equal(p.role, undefined);
  const team = result.state!.teams.find((candidate) => candidate.id === "T-1")!;
  assert.deepEqual(team.memberIds, ["1", "3", "4", "5"]);
  assert.equal((result.state!.teamRequests ?? []).find((r) => r.id === "TR-1")?.status, "cancelled");
  void beforeRequests;
}

// 队长不能单独退出
{
  const result = leaveTeamOp(fixture(), { playerId: "1" });
  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /队长/);
}

// 冻结后队员不能退出
{
  const s = fixture();
  s.teams[0].status = "已冻结";
  const result = leaveTeamOp(s, { playerId: "2" });
  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /冻结/);
}

// 队长解散：队伍删除、全员回池、清理 pending 请求
{
  const s = fixture();
  s.teamRequests = [{
    id: "TR-1", type: "invitation", teamId: "T-1", playerId: "2", role: "替补",
    initiatedByPlayerId: "1", status: "pending", createdAt: "2026-09-03T00:00:00.000Z",
  }];
  const result = dissolveTeamOp(s, { teamId: "T-1" });
  assert.equal(result.ok, true);
  assert.equal(result.state!.teams.length, 0);
  const members = result.state!.players.filter((candidate) => candidate.teamId === "T-1");
  assert.equal(members.length, 0);
  assert.ok(result.state!.players.every((candidate) => candidate.status === "已报名"));
  assert.equal((result.state!.teamRequests ?? []).find((r) => r.id === "TR-1")?.status, "cancelled");
}

// 冻结后队伍默认不能解散
{
  const s = fixture();
  s.teams[0].status = "已冻结";
  const result = dissolveTeamOp(s, { teamId: "T-1" });
  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /冻结/);
}

// allowFrozen 时冻结队伍可解散（未进对阵图）
{
  const s = fixture();
  s.teams[0].status = "已冻结";
  const result = dissolveTeamOp(s, { teamId: "T-1", allowFrozen: true });
  assert.equal(result.ok, true);
  assert.equal(result.state!.teams.length, 0);
  assert.ok(result.state!.players.every((candidate) => candidate.teamId === undefined));
}

// 已退赛队伍不可解散（即使 allowFrozen）
{
  const s = fixture();
  s.teams[0].status = "已退赛";
  const result = dissolveTeamOp(s, { teamId: "T-1", allowFrozen: true });
  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /退赛/);
}

console.log("✓ 队员退出（非队长/报名中）、队长不能单退、冻结后不可退/散；allowFrozen 放开冻结解散");

// —— 建队不设数量上限 ——
// 报名阶段允许队伍数超出赛制所需（本届为 32 队赛制），
// 最终签位由抽签环节的队数区间校验把关，不在建队时挡人。
{
  // createTeamOp 返回新状态（不可变），所以用返回值逐次推进
  let s = fixture();
  const baseCount = s.teams.length;
  const created: string[] = [];
  for (let index = 0; index < 40; index += 1) {
    const captainId = `cap-${index}`;
    s = { ...s, players: [...s.players, player(captainId, { status: "已报名", teamId: undefined, role: undefined })] };
    const r = createTeamOp(s, { name: `第${index}队`, captainId });
    assert.equal(r.ok, true, `第 ${index + 1} 次建队应成功`);
    s = r.state!;
    created.push(r.team!.id);
  }
  assert.equal(s.teams.length, baseCount + 40, `总队伍数应为 ${baseCount} + 40`);
  assert.equal(new Set(created).size, 40, "40 支新队 id 互不重复");
}

// 去掉上限后，同名与空名仍必须被拦
{
  let s = fixture();
  const first = createTeamOp(s, { name: "重名队", captainId: "6" });
  assert.equal(first.ok, true);
  s = first.state!;

  s = { ...s, players: [...s.players, player("cap-x", { status: "已报名", teamId: undefined, role: undefined })] };
  const dup = createTeamOp(s, { name: "重名队", captainId: "cap-x" });
  assert.equal(dup.ok, false, "同名队伍仍应被拒");
  assert.match(dup.message ?? "", /同名/);

  s = { ...s, players: [...s.players, player("cap-y", { status: "已报名", teamId: undefined, role: undefined })] };
  const empty = createTeamOp(s, { name: "   ", captainId: "cap-y" });
  assert.equal(empty.ok, false, "空名仍应被拒");
}

console.log("✓ 建队不设数量上限（建到 40 支仍成功）；同名与空名仍被拦");



// 队长默认首发（兼容旧调用）
{
  const s = fixture();
  const r = createTeamOp(s, { name: "新队", captainId: "6" });
  assert.equal(r.ok, true);
  assert.equal(r.state!.players.find((candidate) => candidate.id === "6")?.role, "首发");
}

// 队长可作替补
{
  const s = fixture();
  const r = createTeamOp(s, { name: "新队", captainId: "6", captainRole: "替补" });
  assert.equal(r.ok, true);
  assert.equal(r.state!.players.find((candidate) => candidate.id === "6")?.role, "替补");
}

// 队长可作教练
{
  const s = fixture();
  const r = createTeamOp(s, { name: "新队", captainId: "6", captainRole: "教练" });
  assert.equal(r.ok, true);
  assert.equal(r.state!.players.find((candidate) => candidate.id === "6")?.role, "教练");
}

// —— 队名修改 ——

// 报名中可改、且不得重名
{
  const s = fixture();
  const okR = renameTeamOp(s, { teamId: "T-1", name: "改名队" });
  assert.equal(okR.ok, true);
  assert.equal(okR.state!.teams[0].name, "改名队");
}
{
  const s = fixture();
  // 改成自己的名字 = 未变化，应拒绝
  const same = renameTeamOp(s, { teamId: "T-1", name: "测试队伍" });
  assert.equal(same.ok, false);
  assert.match(same.message ?? "", /未发生变化/);
}
{
  const s = fixture();
  s.teams.push({ id: "T-2", name: "另一队", captainId: "9", memberIds: ["9"], status: "报名中", createdAt: "2026-09-03T00:00:00.000Z" });
  const dup = renameTeamOp(s, { teamId: "T-1", name: "另一队" });
  assert.equal(dup.ok, false);
  assert.match(dup.message ?? "", /同名/);
}

// 冻结后不能改
{
  const s = fixture();
  s.teams[0].status = "已冻结";
  const r = renameTeamOp(s, { teamId: "T-1", name: "新名" });
  assert.equal(r.ok, false);
  assert.match(r.message ?? "", /冻结/);
}

// —— 改角色 ——

// 改自己角色成功
{
  const s = fixture();
  const r = setMemberRoleOp(s, { teamId: "T-1", playerId: "2", role: "替补" });
  assert.equal(r.ok, true);
  assert.equal(r.state!.players.find((candidate) => candidate.id === "2")?.role, "替补");
}

// 目标角色已满则拒绝
{
  const s = fixture();
  // 替补已满（选手 6 是替补，再加一名替补到 2 就超限——但 fixture 里 6 不在队伍里；改为把一名首发改成替补后再把另一名改成替补应触发上限）
  // 直接构造：T-1 已有 1 替补（给 2 改成替补后），再把 3 改成替补应失败
  const first = setMemberRoleOp(s, { teamId: "T-1", playerId: "2", role: "替补" });
  assert.equal(first.ok, true);
  const second = setMemberRoleOp(first.state!, { teamId: "T-1", playerId: "3", role: "替补" });
  assert.equal(second.ok, false);
  assert.match(second.message ?? "", /已满/);
}

// 角色未变化拒绝
{
  const s = fixture();
  const r = setMemberRoleOp(s, { teamId: "T-1", playerId: "2", role: "首发" });
  assert.equal(r.ok, false);
  assert.match(r.message ?? "", /未发生变化/);
}

// 非队内选手拒绝
{
  const s = fixture();
  const r = setMemberRoleOp(s, { teamId: "T-1", playerId: "6", role: "替补" });
  assert.equal(r.ok, false);
  assert.match(r.message ?? "", /不在队伍/);
}

// 冻结后不能改角色
{
  const s = fixture();
  s.teams[0].status = "已冻结";
  const r = setMemberRoleOp(s, { teamId: "T-1", playerId: "2", role: "替补" });
  assert.equal(r.ok, false);
  assert.match(r.message ?? "", /冻结/);
}

console.log("✓ 建队队长可选首发/替补/教练；队名可改（报名中/防重名/冻结锁）；改角色（校验满员/未变/非队员/冻结）");
