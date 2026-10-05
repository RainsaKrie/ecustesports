import assert from "node:assert/strict";

import {
  approveAllPlayersAdminOp,
  confirmEligibleTeamsAdminOp,
  confirmTeamAdminOp,
  createPlayerAdminOp,
  createTeamAdminOp,
  deletePlayerAdminOp,
  dissolveTeamAdminOp,
  renameTeamAdminOp,
  replacePlayerAdminOp,
  resetPlayerTokenAdminOp,
  reviewPlayerAdminOp,
  setMemberRoleAdminOp,
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
    reviewStatus: "已通过",
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

test("被标记为需修改的成员阻止正式名单确认", () => {
  const state = fixture();
  state.players = state.players.map((candidate) =>
    candidate.teamId === "T-1" ? { ...candidate, reviewStatus: "需修改" as const } : candidate,
  );
  const result = confirmTeamAdminOp(state, "T-1");
  assert.equal(result.ok, false);
  assert.match(result.message, /未审核通过/);
});

test("未设置审核状态的选手一律归一化为已通过（默认通过）", () => {
  const state = fixture();
  state.teams[0].status = "已冻结";
  state.players = state.players.map((candidate) => ({ ...candidate, reviewStatus: undefined }));
  const normalized = normalizeRegistrationState(state);
  assert.equal(normalized.players.find((candidate) => candidate.id === "1")?.reviewStatus, "已通过");
  // 未组队的选手同样默认通过——不再有「人人都要审」这一步
  assert.equal(normalized.players.find((candidate) => candidate.id === "6")?.reviewStatus, "已通过");
});

test("历史「待审核」归一化为已通过，明确标记的「需修改」保留", () => {
  const state = fixture();
  state.players = state.players.map((candidate) =>
    candidate.id === "1"
      ? { ...candidate, reviewStatus: "待审核" as RegistrationPlayer["reviewStatus"] }
      : candidate.id === "2" ? { ...candidate, reviewStatus: "需修改" as const } : candidate,
  );
  const normalized = normalizeRegistrationState(state);
  assert.equal(normalized.players.find((candidate) => candidate.id === "1")?.reviewStatus, "已通过");
  assert.equal(normalized.players.find((candidate) => candidate.id === "2")?.reviewStatus, "需修改");
});

test("把被标记的成员恢复为已通过后可以确认名单", () => {
  let state = fixture();
  state.players = state.players.map((candidate) =>
    candidate.teamId === "T-1" ? { ...candidate, reviewStatus: "需修改" as const } : candidate,
  );
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

test("一键确认只冻结满编队伍，未满编的原地留下", () => {
  const state = fixture();
  state.teams = [
    ...state.teams,
    { id: "T-2", name: "缺人队", captainId: "7", memberIds: ["7", "8", "9", "10"], status: "报名中", createdAt: "2026-08-21T00:00:00.000Z" },
  ];
  state.players = [...state.players, ...[7, 8, 9, 10].map((index) => player(String(index), { teamId: "T-2" }))];
  const result = confirmEligibleTeamsAdminOp(state);
  assert.equal(result.ok, true);
  assert.equal(result.state.teams.find((team) => team.id === "T-1")?.status, "已冻结");
  assert.equal(result.state.teams.find((team) => team.id === "T-2")?.status, "报名中");
  // 一次批量只记一条记录，撤销时一并回退
  assert.equal(result.state.operationLogs?.length, 1);
  assert.equal(result.state.operationLogs?.[0].action, "confirm-eligible-teams");
  assert.match(result.message, /另有 1 支未满编/);
});

test("一键确认可一次撤销并恢复全部队伍", () => {
  const result = confirmEligibleTeamsAdminOp(fixture());
  assert.equal(result.ok, true);
  const undone = undoRegistrationAdminOp(result.state, result.state.operationLogs?.[0].id ?? "");
  assert.equal(undone.ok, true);
  assert.equal(undone.state.teams[0].status, "报名中");
});

test("没有满编队伍时一键确认失败并说明条件", () => {
  const state = fixture();
  state.players = state.players.map((candidate) => candidate.id === "5" ? { ...candidate, role: "替补" as const } : candidate);
  const result = confirmEligibleTeamsAdminOp(state);
  assert.equal(result.ok, false);
  assert.match(result.message, /都不满足确认条件/);
});

test("一键确认跳过资料未通过的满编队伍", () => {
  const state = fixture();
  state.players = state.players.map((candidate) => candidate.id === "3" ? { ...candidate, reviewStatus: "需修改" as const } : candidate);
  const result = confirmEligibleTeamsAdminOp(state);
  assert.equal(result.ok, false);
  assert.equal(result.state.teams[0].status, "报名中");
});

test("标记需修改不会把已确认的名单打回报名中", () => {
  const state = fixture();
  state.teams[0].status = "已冻结";
  const result = reviewPlayerAdminOp(state, { playerId: "1", reviewStatus: "需修改" });
  assert.equal(result.ok, true);
  // 只标人，不动队伍——负责人不该为了一个人的资料问题重新确认整支队伍
  assert.equal(result.state.teams[0].status, "已冻结");
  assert.equal(result.state.players.find((candidate) => candidate.id === "1")?.reviewStatus, "需修改");
});

test("资料更正保留原数据并留下操作记录", () => {
  const result = updatePlayerAdminOp(fixture(), {
    playerId: "1",
    name: "彭杰",
    studentId: "20280001",
    gameId: "PJ#2028",
    rank: "超凡",
    qq: "123456789",
    phone: "13800138000",
    positions: ["一突", "哨位"],
    reason: "选手主动更正",
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.players[0].gameId, "PJ#2028");
  assert.equal(result.state.players[0].positions?.join(","), "一突,哨位");
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

test("解散队伍删除队伍对象并让全员回池", () => {
  const result = dissolveTeamAdminOp(fixture(), "T-1", "重复报名清理");
  assert.equal(result.ok, true);
  assert.equal(result.state.teams.length, 0);
  assert.ok(result.state.players.filter((candidate) => candidate.teamId === "T-1").length === 0);
  assert.ok(result.state.players.every((candidate) => candidate.teamId === undefined));
  assert.equal(result.state.operationLogs?.[0].action, "dissolve-team");
});

test("解散队伍记审计日志并可撤销", () => {
  const dissolved = dissolveTeamAdminOp(fixture(), "T-1", "组队失败");
  assert.equal(dissolved.ok, true);
  const undone = undoRegistrationAdminOp(dissolved.state, dissolved.state.operationLogs?.[0].id ?? "");
  assert.equal(undone.ok, true);
  assert.equal(undone.state.teams.length, 1);
  assert.equal(undone.state.teams[0].name, "瓦理一队");
});

test("冻结但未进对阵图的队伍可以解散", () => {
  let state = fixture();
  for (const id of ["1", "2", "3", "4", "5"]) {
    const result = reviewPlayerAdminOp(state, { playerId: id, reviewStatus: "已通过" });
    state = result.state;
  }
  const confirmed = confirmTeamAdminOp(state, "T-1");
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.state.teams[0].status, "已冻结");
  // 未进对阵图（inBracket=false），已冻结队伍也可解散
  const result = dissolveTeamAdminOp(confirmed.state, "T-1", "测试队伍清理", false);
  assert.equal(result.ok, true);
  assert.equal(result.state.teams.length, 0);
  assert.ok(result.state.players.every((candidate) => candidate.teamId === undefined));
});

test("已进对阵图的队伍不能解散，只能整队退赛", () => {
  const result = dissolveTeamAdminOp(fixture(), "T-1", "试试", true);
  assert.equal(result.ok, false);
  assert.match(result.message, /整队退赛/);
});

test("已退赛队伍不能解散", () => {
  const withdrawn = withdrawTeamAdminOp(fixture(), "T-1", "队伍主动弃赛");
  assert.equal(withdrawn.ok, true);
  const result = dissolveTeamAdminOp(withdrawn.state, "T-1", "试图删除", false);
  assert.equal(result.ok, false);
  assert.match(result.message, /退赛/);
});

test("仅可安全撤销最新操作", () => {
  const flagged = fixture();
  flagged.players = flagged.players.map((candidate) =>
    candidate.id === "1" ? { ...candidate, reviewStatus: "需修改" as const } : candidate,
  );
  const reviewed = reviewPlayerAdminOp(flagged, { playerId: "1", reviewStatus: "已通过" });
  const logId = reviewed.state.operationLogs?.[0].id ?? "";
  const undone = undoRegistrationAdminOp(reviewed.state, logId);
  assert.equal(undone.ok, true);
  assert.equal(undone.state.players[0].reviewStatus, "需修改");
  assert.ok(undone.state.operationLogs?.[0].undoneAt);
});

test("操作后出现外部数据变化时拒绝撤销", () => {
  const flagged = fixture();
  flagged.players = flagged.players.map((candidate) =>
    candidate.id === "1" ? { ...candidate, reviewStatus: "需修改" as const } : candidate,
  );
  const reviewed = reviewPlayerAdminOp(flagged, { playerId: "1", reviewStatus: "已通过" });
  const changed = {
    ...reviewed.state,
    players: [...reviewed.state.players, player("7", { status: "已报名", teamId: undefined, role: undefined })],
  };
  const result = undoRegistrationAdminOp(changed, reviewed.state.operationLogs?.[0].id ?? "");
  assert.equal(result.ok, false);
  assert.match(result.message, /不能自动撤销/);
});

test("重置参赛码更新哈希并返回明文新码", () => {
  const result = resetPlayerTokenAdminOp(fixture(), { playerId: "1", tokenHash: "new-hash", newToken: "new-token" });
  assert.equal(result.ok, true);
  assert.equal(result.newToken, "new-token");
  assert.equal(result.state.players.find((candidate) => candidate.id === "1")?.manageTokenHash, "new-hash");
  assert.ok(result.state.operationLogs?.some((log) => log.action === "reset-player-token"));
});

test("重置参赛码对不存在的选手失败", () => {
  const result = resetPlayerTokenAdminOp(fixture(), { playerId: "missing", tokenHash: "x", newToken: "y" });
  assert.equal(result.ok, false);
  assert.match(result.message, /不存在/);
});

test("删除未组队选手直接移除且清理相关请求", () => {
  const state = fixture();
  state.teamRequests = [{
    id: "TR-1",
    type: "application",
    teamId: "T-1",
    playerId: "6",
    role: "替补",
    initiatedByPlayerId: "6",
    status: "pending",
    createdAt: "2026-08-21T00:00:00.000Z",
  }];
  const result = deletePlayerAdminOp(state, { playerId: "6" });
  assert.equal(result.ok, true);
  assert.equal(result.state.players.some((candidate) => candidate.id === "6"), false);
  assert.equal(result.state.teamRequests?.length, 0);
  assert.ok(result.state.operationLogs?.some((log) => log.action === "delete-player"));
});

test("删除普通成员腾出队内位置", () => {
  const result = deletePlayerAdminOp(fixture(), { playerId: "3" });
  assert.equal(result.ok, true);
  const team = result.state.teams.find((candidate) => candidate.id === "T-1");
  assert.ok(team);
  assert.deepEqual(team.memberIds, ["1", "2", "4", "5"]);
  assert.equal(team.captainId, "1");
  assert.equal(team.status, "报名中");
  assert.equal(result.state.players.some((candidate) => candidate.id === "3"), false);
});

test("删除队长自动移交给队内首发", () => {
  const result = deletePlayerAdminOp(fixture(), { playerId: "1" });
  assert.equal(result.ok, true);
  const team = result.state.teams.find((candidate) => candidate.id === "T-1");
  assert.ok(team);
  assert.equal(team.memberIds.length, 4);
  assert.equal(team.captainId, "2");
});

test("删除最后一名成员队伍标记退赛", () => {
  const state = fixture();
  state.teams[0].memberIds = ["1"];
  state.players = state.players.filter((candidate) => candidate.id === "1");
  const result = deletePlayerAdminOp(state, { playerId: "1" });
  assert.equal(result.ok, true);
  assert.equal(result.state.teams.find((candidate) => candidate.id === "T-1")?.status, "已退赛");
  assert.equal(result.state.teams.find((candidate) => candidate.id === "T-1")?.captainId, "");
  assert.equal(result.state.players.length, 0);
});

test("删除选手连带清理其发起和收到的组队请求", () => {
  const state = fixture();
  state.teamRequests = [
    { id: "TR-1", type: "application", teamId: "T-1", playerId: "6", role: "替补", initiatedByPlayerId: "6", status: "pending", createdAt: "2026-08-21T00:00:00.000Z" },
    { id: "TR-2", type: "invitation", teamId: "T-1", playerId: "6", role: "首发", initiatedByPlayerId: "1", status: "pending", createdAt: "2026-08-21T00:00:00.000Z" },
    { id: "TR-3", type: "invitation", teamId: "T-1", playerId: "2", role: "替补", initiatedByPlayerId: "1", status: "pending", createdAt: "2026-08-21T00:00:00.000Z" },
  ];
  const result = deletePlayerAdminOp(state, { playerId: "1" });
  assert.equal(result.ok, true);
  // 队长发起的 TR-3 与收到的 TR-2（涉及被删队长）都清理，TR-1 不涉及队长本人则保留
  assert.deepEqual((result.state.teamRequests ?? []).map((request) => request.id), ["TR-1"]);
});

test("删除不存在的选手失败", () => {
  const result = deletePlayerAdminOp(fixture(), { playerId: "missing" });
  assert.equal(result.ok, false);
  assert.match(result.message, /不存在/);
});

test("一键全部通过恢复所有被标记的选手并只记一条记录", () => {
  const state = fixture();
  state.players = state.players.map((candidate) =>
    candidate.id === "2" || candidate.id === "3" ? { ...candidate, reviewStatus: "需修改" as const } : candidate,
  );
  state.players = [...state.players, player("7", { status: "已退赛", teamId: undefined, role: undefined, reviewStatus: "需修改" as const })];
  const result = approveAllPlayersAdminOp(state);
  assert.equal(result.ok, true);
  assert.equal(result.state.players.filter((candidate) => candidate.reviewStatus === "已通过").length, 6);
  // 已退赛选手不参与批量通过，保持被标记的状态
  assert.equal(result.state.players.find((candidate) => candidate.id === "7")?.reviewStatus, "需修改");
  assert.equal(result.state.operationLogs?.filter((log) => log.action === "approve-all-players").length, 1);
  assert.match(result.message, /批量通过 2 名/);
});

test("一键全部通过可一次撤销", () => {
  const state = fixture();
  state.players = state.players.map((candidate) => ({ ...candidate, reviewStatus: "需修改" as const }));
  const result = approveAllPlayersAdminOp(state);
  assert.equal(result.ok, true);
  const undone = undoRegistrationAdminOp(result.state, result.state.operationLogs?.[0].id ?? "");
  assert.equal(undone.ok, true);
  assert.equal(undone.state.players.filter((candidate) => candidate.reviewStatus === "需修改").length, 6);
});

test("没有被标记的选手时一键全部通过失败", () => {
  const result = approveAllPlayersAdminOp(fixture());
  assert.equal(result.ok, false);
  assert.match(result.message, /没有被标记为不通过/);
});

test("代建队伍可指定队长角色", () => {
  const state = fixture();
  state.players = state.players.map((candidate) => candidate.id === "6" ? { ...candidate, reviewStatus: "已通过" } : candidate);
  const result = createTeamAdminOp(state, { name: "新队", captainId: "6", captainRole: "替补" });
  assert.equal(result.ok, true);
  const team = result.state.teams.find((candidate) => candidate.name === "新队");
  assert.ok(team);
  assert.equal(result.state.players.find((candidate) => candidate.id === "6")?.role, "替补");
});

test("负责人可修改队名并记审计日志", () => {
  const result = renameTeamAdminOp(fixture(), { teamId: "T-1", name: "改名为瓦理之星", reason: "队长申请更名" });
  assert.equal(result.ok, true);
  assert.equal(result.state.teams[0].name, "改名为瓦理之星");
  assert.equal(result.state.operationLogs?.[0].action, "rename-team");
  assert.equal(result.state.operationLogs?.[0].reason, "队长申请更名");
});

test("负责人可调整成员角色并记审计日志", () => {
  const result = setMemberRoleAdminOp(fixture(), { playerId: "2", role: "替补", reason: "位置协商" });
  assert.equal(result.ok, true);
  assert.equal(result.state.players.find((candidate) => candidate.id === "2")?.role, "替补");
  assert.equal(result.state.operationLogs?.[0].action, "set-member-role");
});

// =====================
// 代录选手（开赛后临时加人）
// =====================

test("代录选手：补齐资料、默认已通过、可选直接编入队伍", () => {
  const state = fixture();
  // 先把队伍腾出一个替补位，避免受人数上限影响
  const result = createPlayerAdminOp(state, {
    name: "严晨怿",
    studentId: "Y40251577",
    gameId: "炫炫子#8961",
    rank: "铂金",
    qq: "10001",
    phone: "13817038442",
    positions: ["先锋"],
    teamId: "T-1",
    role: "替补",
    reason: "开赛后临时补位",
  });
  assert.equal(result.ok, true);
  const created = result.state.players.find((candidate) => candidate.gameId === "炫炫子#8961");
  assert.ok(created, "应生成新的选手记录");
  assert.equal(created?.name, "严晨怿");
  assert.equal(created?.studentId, "Y40251577");
  assert.equal(created?.reviewStatus, "已通过");
  assert.equal(created?.status, "已入队");
  assert.equal(created?.teamId, "T-1");
  assert.equal(created?.role, "替补");
  assert.deepEqual(created?.positions, ["先锋"]);
  // 队名单同步包含新选手
  assert.ok(result.state.teams[0].memberIds.includes(created!.id));
  // 审计日志写入，且带原因
  assert.equal(result.state.operationLogs?.[0].action, "create-player");
  assert.equal(result.state.operationLogs?.[0].reason, "开赛后临时补位");
});

test("代录选手：不编入队伍时只落在选手池", () => {
  const result = createPlayerAdminOp(fixture(), {
    name: "张三", studentId: "S1", gameId: "新人甲#1111", rank: "黄金", positions: ["烟位"],
  });
  assert.equal(result.ok, true);
  const created = result.state.players.find((candidate) => candidate.gameId === "新人甲#1111");
  assert.equal(created?.status, "已报名");
  assert.equal(created?.teamId, undefined);
  assert.equal(result.state.teams[0].memberIds.includes(created!.id), false);
});

test("代录选手：游戏 ID 重复时拒绝（大小写不敏感）", () => {
  const state = fixture();
  const result = createPlayerAdminOp(state, {
    name: "重复者", studentId: "S2", gameId: "PLAYER-1", rank: "黄金", positions: ["哨位"],
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /已被占用/);
});

test("代录选手：必填项缺失时拒绝", () => {
  const base = { name: "李四", studentId: "S3", gameId: "新人乙#2222", rank: "白银", positions: ["一突"] as string[] };
  assert.equal(createPlayerAdminOp(fixture(), { ...base, name: "" }).ok, false);
  assert.equal(createPlayerAdminOp(fixture(), { ...base, studentId: "" }).ok, false);
  assert.equal(createPlayerAdminOp(fixture(), { ...base, gameId: "" }).ok, false);
  assert.equal(createPlayerAdminOp(fixture(), { ...base, rank: "" }).ok, false);
  assert.equal(createPlayerAdminOp(fixture(), { ...base, positions: [] }).ok, false);
});

test("代录选手：入队失败时整条操作作废，不留半截记录", () => {
  const state = fixture();
  // T-1 是「报名中」，但首发已满 5 人；强行代录成「首发」必须被拦下
  const result = createPlayerAdminOp(state, {
    name: "越位者", studentId: "S4", gameId: "新人丙#3333", rank: "黄金",
    positions: ["二突"], teamId: "T-1", role: "首发",
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /首发已满/);
  // 关键：选手没有被半途写进去
  assert.equal(result.state.players.some((candidate) => candidate.gameId === "新人丙#3333"), false);
});

test("代录选手：队伍已冻结时不能直接编入（需先开放调整）", () => {
  const state = fixture();
  state.teams[0].status = "已冻结";
  const result = createPlayerAdminOp(state, {
    name: "迟到者", studentId: "S5", gameId: "新人丁#4444", rank: "黄金",
    positions: ["哨位"], teamId: "T-1", role: "替补",
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /入队失败/);
});

console.log(`\n${passed}/${passed} registration admin tests passed`);