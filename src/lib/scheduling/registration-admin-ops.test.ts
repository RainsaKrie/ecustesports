import assert from "node:assert/strict";

import {
  confirmTeamAdminOp,
  replacePlayerAdminOp,
  reviewPlayerAdminOp,
  undoRegistrationAdminOp,
  updatePlayerAdminOp,
  withdrawPlayerAdminOp,
  withdrawTeamAdminOp,
} from "./registration-admin-ops";
import { normalizeRegistrationState, type RegistrationPlayer, type RegistrationState } from "./registration-data";

let passed = 0;

function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

function player(id: string, overrides: Partial<RegistrationPlayer> = {}): RegistrationPlayer {
  return {
    id,
    name: `选手${id}`,
    studentId: `2026${id}`,
    gameId: `Player-${id}`,
    rank: "钻石",
    submittedAt: "2026-08-21T00:00:00.000Z",
    status: "已入队",
    reviewStatus: "待审核",
    teamId: "T-1",
    role: "首发",
    ...overrides,
  };
}

function fixture(): RegistrationState {
  const players = [1, 2, 3, 4, 5].map((index) => player(String(index)));
  return {
    players: [
      ...players,
      player("6", { status: "已报名", teamId: undefined, role: undefined, reviewStatus: "已通过" }),
    ],
    teams: [{
      id: "T-1",
      name: "瓦理一队",
      captainId: "1",
      memberIds: players.map((candidate) => candidate.id),
      status: "报名中",
      createdAt: "2026-08-21T00:00:00.000Z",
    }],
    teamRequests: [],
    operationLogs: [],
    playerRegistrationClosed: false,
    teamRegistrationClosed: false,
    frozen: false,
  };
}

test("未审核成员阻止正式名单确认", () => {
  const result = confirmTeamAdminOp(fixture(), "T-1");
  assert.equal(result.ok, false);
  assert.match(result.message, /未审核通过/);
});

test("旧版已冻结队伍成员迁移为已审核通过", () => {
  const state = fixture();
  state.teams[0].status = "已冻结";
  state.players = state.players.map((candidate) => ({ ...candidate, reviewStatus: undefined }));
  const normalized = normalizeRegistrationState(state);
  assert.equal(normalized.players.find((candidate) => candidate.id === "1")?.reviewStatus, "已通过");
  assert.equal(normalized.players.find((candidate) => candidate.id === "6")?.reviewStatus, "待审核");
});

test("五名首发全部审核通过后可以确认名单", () => {
  let state = fixture();
  for (const id of ["1", "2", "3", "4", "5"]) {
    const result = reviewPlayerAdminOp(state, { playerId: id, reviewStatus: "已通过" });
    assert.equal(result.ok, true);
    state = result.state;
  }
  const confirmed = confirmTeamAdminOp(state, "T-1");
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.state.teams[0].status, "已冻结");
  assert.equal(confirmed.state.operationLogs?.[0].action, "confirm-team");
});

test("资料更正保留原数据并留下操作记录", () => {
  const result = updatePlayerAdminOp(fixture(), {
    playerId: "1",
    name: "彭杰",
    studentId: "20280001",
    gameId: "PJ#2028",
    rank: "超凡",
    college: "商学院",
    reason: "选手主动更正",
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.players[0].gameId, "PJ#2028");
  assert.equal(result.state.operationLogs?.[0].reason, "选手主动更正");
  assert.equal(result.state.operationLogs?.[0].before.players[0].gameId, "Player-1");
});

test("换人继承原选手角色并留下双方身份", () => {
  const state = fixture();
  state.players = state.players.map((candidate) => candidate.id === "1" ? { ...candidate, reviewStatus: "已通过" } : candidate);
  const result = replacePlayerAdminOp(state, {
    teamId: "T-1",
    outgoingPlayerId: "1",
    incomingPlayerId: "6",
    reason: "原队长无法参赛",
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.teams[0].captainId, "6");
  assert.equal(result.state.players.find((candidate) => candidate.id === "6")?.role, "首发");
  assert.equal(result.state.players.find((candidate) => candidate.id === "1")?.status, "已报名");
});

test("队长个人退赛必须指定新队长", () => {
  const blocked = withdrawPlayerAdminOp(fixture(), { playerId: "1", reason: "时间冲突" });
  assert.equal(blocked.ok, false);
  const allowed = withdrawPlayerAdminOp(fixture(), { playerId: "1", replacementCaptainId: "2", reason: "时间冲突" });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.state.teams[0].captainId, "2");
  assert.equal(allowed.state.players.find((candidate) => candidate.id === "1")?.status, "已退赛");
});

test("整队退赛释放队员但保留队伍退赛记录", () => {
  const result = withdrawTeamAdminOp(fixture(), "T-1", "队伍主动弃赛");
  assert.equal(result.ok, true);
  assert.equal(result.state.teams[0].status, "已退赛");
  assert.equal(result.state.teams[0].memberIds.length, 0);
  assert.equal(result.state.players.find((candidate) => candidate.id === "2")?.status, "已报名");
});

test("仅可安全撤销最新操作", () => {
  const reviewed = reviewPlayerAdminOp(fixture(), { playerId: "1", reviewStatus: "已通过" });
  const logId = reviewed.state.operationLogs?.[0].id ?? "";
  const undone = undoRegistrationAdminOp(reviewed.state, logId);
  assert.equal(undone.ok, true);
  assert.equal(undone.state.players[0].reviewStatus, "待审核");
  assert.ok(undone.state.operationLogs?.[0].undoneAt);
});

test("操作后出现外部数据变化时拒绝撤销", () => {
  const reviewed = reviewPlayerAdminOp(fixture(), { playerId: "1", reviewStatus: "已通过" });
  const changed = {
    ...reviewed.state,
    players: [...reviewed.state.players, player("7", { status: "已报名", teamId: undefined, role: undefined })],
  };
  const result = undoRegistrationAdminOp(changed, reviewed.state.operationLogs?.[0].id ?? "");
  assert.equal(result.ok, false);
  assert.match(result.message, /不能自动撤销/);
});

console.log(`\n${passed}/9 registration admin tests passed`);
