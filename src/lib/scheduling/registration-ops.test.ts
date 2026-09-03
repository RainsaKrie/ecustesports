import assert from "node:assert/strict";

import { addMemberOp } from "./registration-ops";
import type { RegistrationPlayer, RegistrationState } from "./registration-data";

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
    frozen: false,
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
