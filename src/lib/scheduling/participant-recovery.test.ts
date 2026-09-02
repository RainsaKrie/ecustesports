import assert from "node:assert/strict";
import { initialRegistration, type RegistrationPlayer } from "./registration-data";
import { recoverParticipantAccess } from "./participant-recovery";

const player: RegistrationPlayer = {
  id: "player-1",
  name: "测试选手",
  studentId: "10260001",
  gameId: "Player#1001",
  rank: "黄金",
  phone: "138-0013-8000",
  submittedAt: "2026-09-01T00:00:00.000Z",
  status: "已报名",
  manageTokenHash: "old-hash",
};

const state = { ...initialRegistration(), players: [player] };

const recovered = recoverParticipantAccess(state, {
  studentId: " 10260001 ",
  phone: "13800138000",
  tokenHash: "new-hash",
});
assert.equal(recovered.player?.id, player.id);
assert.equal(recovered.state.players[0].manageTokenHash, "new-hash");

const rejected = recoverParticipantAccess(state, {
  studentId: "10260001",
  phone: "13900139000",
  tokenHash: "new-hash",
});
assert.equal(rejected.player, undefined);
assert.equal(rejected.state.players[0].manageTokenHash, "old-hash");

console.log("✓ 参赛身份可通过学号与报名手机号安全找回");
