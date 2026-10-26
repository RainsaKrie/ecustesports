// 个人数据清理（2026-10-26，计划 A1）
import { scrubPersonalDataOp } from "../../src/lib/domains/registration/scrub-personal";
import type { RegistrationState, RegistrationPlayer } from "../../src/lib/domains/registration/data";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "：" + detail : ""}`); }
}

const p = (id: string): RegistrationPlayer => ({
  id, name: "张三", studentId: "22123456", gameId: "Zed#1234", rank: "钻石",
  qq: "12345678", phone: "13800138000", positions: ["决斗"], intro: "我是谁",
  submittedAt: "2026-09-01T10:00:00", status: "已入队", teamId: "T1",
} as unknown as RegistrationPlayer);

const state = (players: RegistrationPlayer[]): RegistrationState =>
  ({ players, teams: [{ id: "T1", name: "测试队" }] } as unknown as RegistrationState);

console.log("个人数据清理");

const r1 = scrubPersonalDataOp(state([p("P1"), p("P2")]));
check("统计清理人数", r1.scrubbedPlayers === 2, String(r1.scrubbedPlayers));

const after = r1.state.players[0];
check("姓名被清", after.name === "已清理", after.name);
check("学号被清", after.studentId === "", after.studentId);
check("QQ 被清", after.qq === undefined);
check("手机号被清", after.phone === undefined);
check("擅长位置被清", after.positions === undefined);
check("自我介绍被清", after.intro === undefined);

// 保留项：赛事记录相关
check("游戏 ID 保留", after.gameId === "Zed#1234", after.gameId);
check("段位保留", after.rank === "钻石", after.rank);
check("队伍归属保留", after.teamId === "T1", String(after.teamId));
check("报名状态保留", after.status === "已入队", after.status);
check("队伍列表未被改动", r1.state.teams.length === 1, String(r1.state.teams.length));

// 幂等
const r2 = scrubPersonalDataOp(r1.state);
check("重复执行不重复计数", r2.scrubbedPlayers === 0, String(r2.scrubbedPlayers));
check("重复执行内容不变", r2.state.players[0].name === "已清理");

console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
if (failed > 0) process.exit(1);
