// =====================
// 对阵调整（交换签位）守卫（2026-10-16）
// 运行：npm run test:team-swap
//
// 这个函数会**直接改对阵**，改错了就是"两队白准备一场"。四条判据逐条钉死。
// =====================

import { teamSwapRefusal, swapTeamSlots, type TeamSlot } from "./team-swap";
import type { ScheduleMatch } from "./schedule-data";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}
function group(title: string) {
  console.log("");
  console.log(`== ${title} ==`);
}

function match(id: string, over: Partial<ScheduleMatch> = {}): ScheduleMatch {
  return {
    id,
    phase: "小组赛",
    round: "A 组 半决赛",
    boType: "BO3",
    teamAId: `${id}-A`,
    teamBId: `${id}-B`,
    teamAName: `${id} 甲`,
    teamBName: `${id} 乙`,
    startTime: "",
    endTime: "",
    status: "待排期",
    frozen: false,
    ...over,
  };
}

const slot = (matchId: string, side: "A" | "B"): TeamSlot => ({ matchId, side });

group("组1 · 正常交换");

const base = [match("M1"), match("M2"), match("M3", { phase: "淘汰赛" })];
const swapped = swapTeamSlots(base, slot("M1", "A"), slot("M2", "B"));
check("M1 的 A 位换成了 M2 的 B 队", swapped[0].teamAId === "M2-B" && swapped[0].teamAName === "M2 乙");
check("M2 的 B 位换成了 M1 的 A 队", swapped[1].teamBId === "M1-A" && swapped[1].teamBName === "M1 甲");
check("没被点到的场次原样不动", swapped[2] === base[2]);
check("场次数不变", swapped.length === base.length);
check(
  "★ 晋级连线一律不碰（只换队伍，不改结构）",
  swapTeamSlots([{ ...base[0], nextMatchId: "M9", nextSide: "A" }, base[1]], slot("M1", "A"), slot("M2", "A"))[0].nextMatchId === "M9",
);

group("组2 · 四条拒绝判据（每条都要能红）");

check("同一场不接受", (teamSwapRefusal(base, slot("M1", "A"), slot("M1", "B")) ?? "").includes("同一场"));
check("找不到场次时拒绝", (teamSwapRefusal(base, slot("M1", "A"), slot("X9", "A")) ?? "").includes("找不到"));
check(
  "★ 跨阶段拒绝（会破坏晋级关系）",
  (teamSwapRefusal(base, slot("M1", "A"), slot("M3", "A")) ?? "").includes("同一个阶段"),
);
check(
  "★ 已排期的场次拒绝",
  (teamSwapRefusal([match("M1", { startTime: "2026-10-20T12:00:00", status: "已排期" }), match("M2")], slot("M1", "A"), slot("M2", "A")) ?? "").includes("排期或赛果"),
);
check(
  "★ 已有赛果的场次拒绝",
  (teamSwapRefusal([match("M1", { status: "已完成", winnerTeamId: "M1-A" }), match("M2")], slot("M1", "A"), slot("M2", "A")) ?? "").includes("排期或赛果"),
);
check(
  "待定队伍拒绝（前序还没出结果）",
  (teamSwapRefusal([match("M1", { teamAId: "TBD", teamAName: "待定" }), match("M2")], slot("M1", "A"), slot("M2", "A")) ?? "").includes("还没确定"),
);
check("可换时返回 null", teamSwapRefusal(base, slot("M1", "A"), slot("M2", "A")) === null);

group("组3 · 不能换时必须抛错，而不是悄悄返回原样");

let threw = "";
try {
  swapTeamSlots(base, slot("M1", "A"), slot("M3", "A"));
} catch (error) {
  threw = error instanceof Error ? error.message : String(error);
}
check("★ 跨阶段直接抛错（防止绕过判据静默改数据）", threw.includes("同一个阶段"));

group("组4 · 确定性");

check(
  "同输入同输出",
  JSON.stringify(swapTeamSlots(base, slot("M1", "A"), slot("M2", "A"))) === JSON.stringify(swapTeamSlots(base, slot("M1", "A"), slot("M2", "A"))),
);

console.log("");
console.log(`结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) {
  console.error(`${fail} 项未通过`);
  process.exit(1);
}
