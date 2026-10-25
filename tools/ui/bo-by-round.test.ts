// 局制按轮次覆盖（2026-10-25，审查 P2-7）
import { DOUBLE_ELIM_BO } from "../../src/lib/domains/schedule/bracket-engine";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "：" + detail : ""}`); }
}

console.log("局制按轮次");

// ① 双败只有败者组决赛和总决赛升 BO5
check("败者组决赛 BO5", DOUBLE_ELIM_BO["败者组决赛"] === "BO5");
check("总决赛 BO5", DOUBLE_ELIM_BO["总决赛"] === "BO5");

// ② 胜者组决赛**不在**覆盖表里 —— 它实际是 BO3
//    （2026-10-22 我把它加进"例外名单"是多余的，当时没核对实际生成数据）
check("胜者组决赛不在覆盖表（实际是 BO3）", DOUBLE_ELIM_BO["胜者组决赛"] === undefined);

// ③ 覆盖表只应有两项，多出来说明有人又往里加
check("覆盖表恰好 2 项", Object.keys(DOUBLE_ELIM_BO).length === 2, Object.keys(DOUBLE_ELIM_BO).join(","));

console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
if (failed > 0) process.exit(1);
