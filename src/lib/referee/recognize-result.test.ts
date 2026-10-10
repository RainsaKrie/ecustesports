// =====================
// 赛果识别建议层测试
// 运行：npm run test:recognize
//
// 全部离线：不访问网络、不读生产数据。
// 重点覆盖「用名单校正左右」——这是把识别结果变成可用预填的关键一步。
// =====================

import assert from "node:assert/strict";

import { buildRecognizeSuggestion, type RecognizeContext } from "./recognize-result";
import type { RecognizedResult } from "./result-vision";

const OUR = ["甲一", "甲二", "甲三", "甲四", "甲五"];
const THEIR = ["乙一", "乙二", "乙三", "乙四", "乙五"];

function context(overrides: Partial<RecognizeContext> = {}): RecognizeContext {
  return {
    matchId: "M24",
    gameIndex: 1,
    boType: "BO3",
    teams: { a: "甲方", b: "乙方" },
    mapSequence: ["森寒冬港", "微风岛屿", "莲华古城"],
    squads: { a: OUR, b: THEIR },
    ...overrides,
  };
}

/** 方向正确：模型认为的第一组就是真实 A 队 */
function alignedResult(): RecognizedResult {
  return {
    series: { a: 1, b: 0 },
    winnerGroup: "a",
    games: [{ map: "森寒冬港", winnerGroup: "a", winnerScore: 13, loserScore: 9 }],
    groups: { a: OUR, b: THEIR },
  };
}

/** 方向反了：模型认为的第一组其实是真实 B 队 */
function flippedResult(): RecognizedResult {
  return {
    series: { a: 1, b: 0 },
    winnerGroup: "a",
    games: [{ map: "森寒冬港", winnerGroup: "a", winnerScore: 13, loserScore: 9 }],
    groups: { a: THEIR, b: OUR },
  };
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

console.log("\n== 组1 · 方向正确时不改动 ==");
{
  const s = buildRecognizeSuggestion(alignedResult(), context());
  check("比分原样保留", s.game?.teamAScore === 13 && s.game?.teamBScore === 9, JSON.stringify(s.game));
  check("判定为未交换", s.identity?.swapped === false);
  check("身份匹配成功", s.identity?.status === "matched");
  check("第一组确认为 A 队", s.identity?.firstGroupTeam === "a");
  check("地图核对通过", s.mapMatchesBp === true);
  check("无提示", s.issues.length === 0, s.issues.join("；"));
}

console.log("\n== 组2 · ★ 模型把左右搞反时自动交换 ==");
{
  const s = buildRecognizeSuggestion(flippedResult(), context());
  check("比分被交换", s.game?.teamAScore === 9 && s.game?.teamBScore === 13, JSON.stringify(s.game));
  check("标记为已交换", s.identity?.swapped === true);
  check("第一组确认属于 B 队", s.identity?.firstGroupTeam === "b");
  check("给出已校正提示", s.issues.some((x) => x.includes("校正左右")), s.issues.join("；"));
  // 关键：交换后 A 队是输的一方，与「模型说 A 赢」相反——这正是校正的价值
  check("交换后 A 队比分低于 B 队", (s.game?.teamAScore ?? 99) < (s.game?.teamBScore ?? 0));
}

console.log("\n== 组3 · 拿不到名单时不猜 ==");
{
  const s = buildRecognizeSuggestion(alignedResult(), context({ squads: null }));
  check("不交换", s.identity === null && s.game?.teamAScore === 13);
  check("提示需自行核对左右", s.issues.some((x) => x.includes("无法自动确定")), s.issues.join("；"));
}

console.log("\n== 组4 · 名单匹配不上时不猜 ==");
{
  const result = alignedResult();
  result.groups = { a: ["路人甲", "路人乙", "路人丙", "路人丁", "路人戊"], b: THEIROTHER() };
  const s = buildRecognizeSuggestion(result, context());
  check("不交换", s.identity?.swapped === false);
  check("状态非 matched", s.identity?.status !== "matched", String(s.identity?.status));
  check("带出匹配失败原因", s.issues.length > 0, s.issues.join("；"));
  function THEIROTHER() { return ["路人己", "路人庚", "路人辛", "路人壬", "路人癸"]; }
}

console.log("\n== 组5 · 撞名时转人工 ==");
{
  const result = alignedResult();
  // 一个昵称同时出现在两队名单里
  const ctx = context({ squads: { a: [...OUR], b: [...THEIR, "甲一"] } });
  const s = buildRecognizeSuggestion(result, ctx);
  check("判为歧义", s.identity?.status === "ambiguous", String(s.identity?.status));
  check("不交换", s.identity?.swapped === false);
  check("列出撞名", s.issues.some((x) => x.includes("同时出现")), s.issues.join("；"));
}

console.log("\n== 组6 · 地图核对 ==");
{
  const wrongMap = alignedResult();
  wrongMap.games = [{ map: "莲华古城", winnerGroup: "a", winnerScore: 13, loserScore: 9 }];
  const s = buildRecognizeSuggestion(wrongMap, context({ gameIndex: 1 }));
  check("判为不一致", s.mapMatchesBp === false);
  check("提示可能传错图", s.issues.some((x) => x.includes("传错")), s.issues.join("；"));
  check("建议地图仍取 BP 序列", s.suggestedMap === "森寒冬港", String(s.suggestedMap));

  // BP 未完成（序列为空）时无法核对
  const noBp = alignedResult();
  noBp.games = [{ map: null, winnerGroup: "a", winnerScore: 13, loserScore: 9 }];
  const s2 = buildRecognizeSuggestion(noBp, context({ mapSequence: [] }));
  check("无 BP 序列时核对结果为 null", s2.mapMatchesBp === null);
  check("建议地图退化为图上读到的", s2.suggestedMap === null || s2.suggestedMap === undefined);
}

console.log("\n== 组7 · 局次与上传位对应 ==");
{
  // 第 2 局：模型只返回一局时，仍按本局填入但要提示
  const s = buildRecognizeSuggestion(alignedResult(), context({ gameIndex: 2 }));
  check("按本局填入", s.game?.teamAScore === 13);
  check("提示局数对不上", s.issues.some((x) => x.includes("只读到 1 局")), s.issues.join("；"));
  check("建议地图取第 2 局", s.suggestedMap === "微风岛屿", String(s.suggestedMap));

  // 模型返回多局：取第 2 局
  const multi = alignedResult();
  multi.games = [
    { map: "森寒冬港", winnerGroup: "a", winnerScore: 13, loserScore: 9 },
    { map: "微风岛屿", winnerGroup: "a", winnerScore: 13, loserScore: 7 },
    { map: "莲华古城", winnerGroup: "a", winnerScore: 13, loserScore: 11 },
  ];
  const s2 = buildRecognizeSuggestion(multi, context({ gameIndex: 2 }));
  check("取第 2 局比分", s2.game?.teamAScore === 13 && s2.game?.teamBScore === 7, JSON.stringify(s2.game));
  check("第 2 局地图核对通过", s2.mapMatchesBp === true);

  const s3 = buildRecognizeSuggestion(multi, context({ gameIndex: 3 }));
  check("取第 3 局比分", s3.game?.teamAScore === 13 && s3.game?.teamBScore === 11);
}

console.log("\n== 组8 · 分组人数异常要提示 ==");
{
  const bad = alignedResult();
  // 把「截图者自己」当成第三组：本组只剩 4 人
  bad.groups = { a: OUR.slice(0, 4), b: THEIR };
  const s = buildRecognizeSuggestion(bad, context());
  check("提示不是 5 对 5", s.issues.some((x) => x.includes("5 人对 5 人")), s.issues.join("；"));
  // 人数不对时身份匹配大概率证据不足，不应静默校正
  check("人数异常时不静默交换", s.identity?.swapped === false);
}

console.log("\n== 组9 · 模型拒答或没结果 ==");
{
  const s = buildRecognizeSuggestion(null, context());
  check("提示手工填写", s.issues.some((x) => x.includes("手工填写")), s.issues.join("；"));
  check("不产出比分", s.game === null);

  const noGames = alignedResult();
  noGames.games = [];
  const s2 = buildRecognizeSuggestion(noGames, context());
  check("没读到比分时不产出建议比分", s2.game === null);
}

console.log("\n== 组10 · 确定性 ==");
{
  const a = buildRecognizeSuggestion(flippedResult(), context());
  const b = buildRecognizeSuggestion(flippedResult(), context());
  check("同一输入结论一致", JSON.stringify(a) === JSON.stringify(b));
}

console.log("\n== 组11 · 地图名读错要校正（实测「蔚海悬城」） ==");
{
  // 没有 BP 记录时，模型读到的地图名会直接成为预填值——正是错名字流进赛果的路径
  const misread = alignedResult();
  misread.games = [{ map: "蔚海悬城", winnerGroup: "a", winnerScore: 13, loserScore: 10 }];
  const s = buildRecognizeSuggestion(misread, context({ mapSequence: [] }));
  check("错名字被校正为官方名", s.suggestedMap === "亚海悬城", String(s.suggestedMap));
  check("预填比分也带正确的图名", s.game?.map === "亚海悬城", String(s.game?.map));
  check("提示已校正", s.issues.some((x) => x.includes("校正为「亚海悬城」")), s.issues.join("；"));
}

console.log("\n== 组12 · 地图名对不上官方表时不猜 ==");
{
  const unknown = alignedResult();
  unknown.games = [{ map: "完全不存在的图", winnerGroup: "a", winnerScore: 13, loserScore: 10 }];
  const s = buildRecognizeSuggestion(unknown, context({ mapSequence: [] }));
  check("不认识的名字原样保留", s.suggestedMap === "完全不存在的图", String(s.suggestedMap));
  check("提示手工核对", s.issues.some((x) => x.includes("不在官方地图表里")), s.issues.join("；"));
}

console.log("\n== 组13 · 官方写法的图名不产生多余提示 ==");
{
  const clean = buildRecognizeSuggestion(alignedResult(), context());
  check("没有地图相关提示", !clean.issues.some((x) => x.includes("地图") || x.includes("校正")), clean.issues.join("；"));
  check("地图核对通过", clean.mapMatchesBp === true);
}

console.log("\n== 组14 · BP 存在时仍以 BP 记录为准 ==");
{
  // 即使图上读错名字，只要 BP 有记录，预填应该用 BP 的那张图
  const misread = alignedResult();
  misread.games = [{ map: "蔚海悬城", winnerGroup: "a", winnerScore: 13, loserScore: 9 }];
  const s = buildRecognizeSuggestion(misread, context());
  check("预填取 BP 序列", s.suggestedMap === "森寒冬港", String(s.suggestedMap));
  // 校正后是「亚海悬城」，与 BP 的「森寒冬港」仍不一致 —— 这是真信号：
  // 要么传错图，要么这一局打的就不是 BP 记的图。必须报出来，不能被校正掩盖。
  check("校正后仍与 BP 不一致，如实报出", s.mapMatchesBp === false, String(s.mapMatchesBp));
  check("提示传错图", s.issues.some((x) => x.includes("传错了图")), s.issues.join("；"));
}

console.log(`\n结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
