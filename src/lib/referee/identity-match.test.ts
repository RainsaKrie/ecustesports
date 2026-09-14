// =====================
// 昵称身份匹配测试
// 运行：npm run test:identity-match
//
// 全部使用构造数据（虚构昵称），不依赖真实报名信息，也不访问网络。
// 真实数据只用于一次性人工核对，不进测试。
// =====================

import {
  buildRoster,
  matchTeamsByIdentity,
  normalizeGameId,
  type IdentityMatchInput,
  type TeamRoster,
} from "./identity-match";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

function roster(teamId: string, teamName: string, gameIds: string[]): TeamRoster {
  return { teamId, teamName, gameIds };
}

/** 标准 5v5：甲队与乙队 */
function standardInput(): IdentityMatchInput {
  return {
    readGroups: {
      first: ["甲一号", "甲二号", "甲三号", "甲四号", "甲五号"],
      second: ["乙一号", "乙二号", "乙三号", "乙四号", "乙五号"],
    },
    teams: {
      a: roster("T-A", "甲方", ["甲一号#1111", "甲二号#2222", "甲三号#3333", "甲四号#4444", "甲五号#5555"]),
      b: roster("T-B", "乙方", ["乙一号#6666", "乙二号#7777", "乙三号#8888", "乙四号#9999", "乙五号#0000"]),
    },
  };
}

console.log("\n== 组1 · 规范化（生产数据 94% 是「昵称#标签」，截图只显示昵称）==");
{
  check("去掉 # 及之后", normalizeGameId("花弄影#5103") === "花弄影", normalizeGameId("花弄影#5103"));
  check("全角井号同样处理", normalizeGameId("花弄影＃5103") === "花弄影", normalizeGameId("花弄影＃5103"));
  check("无 # 时原样返回", normalizeGameId("花弄影") === "花弄影");
  check("去掉首尾空格", normalizeGameId("  花弄影#5103  ") === "花弄影");
  check("去掉零宽字符", normalizeGameId("花\u200B弄影#5103") === "花弄影", normalizeGameId("花\u200B弄影#5103"));
  check("末尾就是 # 时取前半", normalizeGameId("abc#") === "abc", normalizeGameId("abc#"));
  check("以 # 开头不截成空串", normalizeGameId("#12345") === "#12345");
  check("空串返回空串", normalizeGameId("") === "");
  check("非字符串返回空串", normalizeGameId(undefined as unknown as string) === "");
  check("只有一个 # 且含标签时不保留标签", !normalizeGameId("a#1").includes("#"));
}

console.log("\n== 组2 · 基本匹配 ==");
{
  const r = matchTeamsByIdentity(standardInput());
  check("5v5 全命中 → matched", r.status === "matched", JSON.stringify(r.reasons));
  check("第一组判给甲队", r.first?.team === "a" && r.first?.teamId === "T-A");
  check("第二组判给乙队", r.second?.team === "b" && r.second?.teamId === "T-B");
  check("命中数被记录", r.first?.exactHits === 5 && r.second?.exactHits === 5);
  check("无未命中项", r.first?.unmatchedNames.length === 0);
  check("无理由告警", r.reasons.length === 0, r.reasons.join("；"));

  // 截图里两组顺序反过来，结论必须不变
  const swappedInput = standardInput();
  const t = swappedInput.readGroups.first;
  swappedInput.readGroups.first = swappedInput.readGroups.second;
  swappedInput.readGroups.second = t;
  const r2 = matchTeamsByIdentity(swappedInput);
  check("两组顺序对调后仍正确", r2.status === "matched" && r2.first?.team === "b" && r2.second?.team === "a");

  // 报名只有 1 人的队：阈值自动降到 1
  const tiny = standardInput();
  tiny.teams.b = roster("T-B", "乙方", ["乙一号#6666"]);
  tiny.readGroups.second = ["乙一号"];
  const r3 = matchTeamsByIdentity(tiny);
  check("对方只有 1 人报名时命中 1 个即通过", r3.status === "matched", JSON.stringify(r3.reasons));

  // 报名 3 人，命中 3 个
  const partial = standardInput();
  partial.teams.a = roster("T-A", "甲方", ["甲一号#1111", "甲二号#2222", "甲三号#3333"]);
  const r4 = matchTeamsByIdentity(partial);
  check("报名 3 人命中 3 个 → matched", r4.status === "matched", JSON.stringify(r4.reasons));
  check("名单人数被如实记录", r4.first?.rosterSize === 3 && r4.first?.readSize === 5);
  check("没报名的人也计入未命中", r4.first?.unmatchedNames.length === 2, JSON.stringify(r4.first?.unmatchedNames));

  // 截图多了个临时替补（不在名单里）
  const withSub = standardInput();
  withSub.readGroups.first = [...withSub.readGroups.first, "临时替补"];
  const r5 = matchTeamsByIdentity(withSub);
  check("多出未报名选手不影响判定", r5.status === "matched" && r5.first?.exactHits === 5);
  check("多出的人被记为未命中", r5.first?.unmatchedNames.includes("临时替补") === true);

  // 名单里存的是带 # 的完整 ID，截图只有昵称——这是主场景，必须通过
  check("名单带 # 标签、截图不带 → 仍匹配", r.first?.exactHits === 5);
}

console.log("\n== 组3 · 大小写误读 ==");
{
  const input = standardInput();
  input.teams.a = roster("T-A", "甲方", ["iCc#1111", "Da1uM#2222", "甲三号#3333", "甲四号#4444", "甲五号#5555"]);
  input.readGroups.first = ["icc", "Da1uM", "甲三号", "甲四号", "甲五号"];
  const r = matchTeamsByIdentity(input);
  check("大小写读错但其余命中 → 仍 matched", r.status === "matched", JSON.stringify(r.reasons));
  check("区分「完全相同」与「仅忽略大小写」", r.first?.exactHits === 4 && r.first?.caseOnlyHits === 1,
    `exact=${r.first?.exactHits} caseOnly=${r.first?.caseOnlyHits}`);
  check("给出大小写核对提示", r.reasons.some((x) => x.includes("大小写")), r.reasons.join("；"));

  // 全靠忽略大小写命中，不足以定案
  const weak = standardInput();
  weak.teams.a = roster("T-A", "甲方", ["AAA#1", "BBB#2", "CCC#3", "DDD#4", "EEE#5"]);
  weak.readGroups.first = ["aaa", "bbb", "ccc", "ddd", "eee"];
  const rw = matchTeamsByIdentity(weak);
  check("只有大小写命中时判证据不足", rw.status === "insufficient", `${rw.status} / ${rw.reasons.join("；")}`);

  // 关闭该容忍后，大小写不同就不算命中
  const strict = matchTeamsByIdentity(input, { allowCaseOnly: false });
  check("关闭大小写容忍后 exact 减少", strict.first?.exactHits === 4 || strict.status !== "matched");
}

console.log("\n== 组4 · 歧义（必须转人工，不许猜）==");
{
  // 两队名单里有同名昵称
  const dup = standardInput();
  dup.teams.b = roster("T-B", "乙方", ["甲二号#8888", "乙二号#7777", "乙三号#8888", "乙四号#9999", "乙五号#0000"]);
  const r = matchTeamsByIdentity(dup);
  check("撞名 → ambiguous", r.status === "ambiguous", r.status);
  check("列出撞名的昵称", r.collidingNames.includes("甲二号"), JSON.stringify(r.collidingNames));
  check("理由是撞名", r.reasons.some((x) => x.includes("同时出现")), r.reasons.join("；"));
  check("撞名时不给出归属", r.first === null && r.second === null);

  // 两组都被判成同一支队（模型把两队的人混着分了）
  const mixed = standardInput();
  mixed.readGroups.second = ["甲一号", "甲二号", "甲三号", "甲四号", "甲五号"];
  const r2 = matchTeamsByIdentity(mixed);
  check("两组指向同一队 → ambiguous", r2.status === "ambiguous", r2.status);
  check("理由是分组有误", r2.reasons.some((x) => x.includes("都指向")), r2.reasons.join("；"));

  // 某一组对两队命中数相同
  const tie = standardInput();
  tie.readGroups.first = ["甲一号", "乙一号"];
  tie.readGroups.second = ["乙二号", "乙三号", "乙四号", "乙五号"];
  const r3 = matchTeamsByIdentity(tie);
  check("某组对两队命中数相同 → ambiguous", r3.status === "ambiguous", `${r3.status} / ${r3.reasons.join("；")}`);
  check("理由指明是哪一组", r3.reasons.some((x) => x.includes("第一组")), r3.reasons.join("；"));
}

console.log("\n== 组5 · 证据不足 ==");
{
  const none = standardInput();
  none.readGroups.first = ["路人甲", "路人乙"];
  none.readGroups.second = ["路人丙", "路人丁"];
  const r = matchTeamsByIdentity(none);
  check("全不命中 → insufficient", r.status === "insufficient", r.status);
  check("理由是没命中任何名单", r.reasons.some((x) => x.includes("没有命中")), r.reasons.join("；"));

  const few = standardInput();
  few.readGroups.first = ["甲一号", "路人甲", "路人乙", "路人丙", "路人丁"];
  few.readGroups.second = ["乙一号", "路人戊", "路人己", "路人庚", "路人辛"];
  const r2 = matchTeamsByIdentity(few);
  check("命中数不足（各 1 个）→ insufficient", r2.status === "insufficient", r2.status);
  check("报出实际命中数与要求", r2.reasons.some((x) => x.includes("要求至少")), r2.reasons.join("；"));

  const empty = standardInput();
  empty.teams.b = roster("T-B", "乙方", []);
  const r3 = matchTeamsByIdentity(empty);
  check("某队名单为空 → insufficient", r3.status === "insufficient", r3.status);
  check("指出是哪一队为空", r3.reasons.some((x) => x.includes("没有任何报名游戏 ID")), r3.reasons.join("；"));

  // 阈值超过名单人数：自动限制到名单人数（否则小队永远不可能通过）
  const capped = matchTeamsByIdentity(standardInput(), { minExactHits: 6 });
  check("阈值超过名单人数时自动限制，仍判定成功", capped.status === "matched", capped.status);

  // 名单有 6 人（多一个没上场的替补），阈值要求 6 → 只命中 5 个，不够
  const sixRoster = standardInput();
  sixRoster.teams.a = roster("T-A", "甲方", [
    "甲一号#1111", "甲二号#2222", "甲三号#3333", "甲四号#4444", "甲五号#5555", "没上场的替补#9999",
  ]);
  const r5 = matchTeamsByIdentity(sixRoster, { minExactHits: 6 });
  check("阈值高于实际上场人数时判证据不足", r5.status === "insufficient", `${r5.status} / ${r5.reasons.join("；")}`);
  check("理由报出 5 个命中与 6 个要求", r5.reasons.some((x) => x.includes("命中 5 个") && x.includes("至少 6 个")), r5.reasons.join("；"));
}

console.log("\n== 组6 · 名单构造 ==");
{
  const r = buildRoster({
    teamId: "T-A",
    teamName: "甲方",
    players: [
      { gameId: "首发一号#1111", role: "首发" },
      { gameId: "首发二号#2222", role: "首发" },
      { gameId: "替补一号#3333", role: "替补" },
      { gameId: "教练一号#4444", role: "教练" },
      { gameId: "退赛的人#5555", role: "首发", status: "已退赛" },
      { gameId: "  ", role: "首发" },
    ],
  });
  check("排除教练（不上场）", !r.gameIds.some((g) => g.startsWith("教练")), JSON.stringify(r.gameIds));
  check("排除已退赛", !r.gameIds.some((g) => g.startsWith("退赛")), JSON.stringify(r.gameIds));
  check("保留首发与替补", r.gameIds.length === 3, JSON.stringify(r.gameIds));
  check("忽略空白项", r.gameIds.every((g) => g.trim() !== ""));
}

console.log("\n== 组7 · 确定性（同一输入必须同一结论）==");
{
  const a = matchTeamsByIdentity(standardInput());
  const b = matchTeamsByIdentity(standardInput());
  check("两次结果完全一致", JSON.stringify(a) === JSON.stringify(b));
  // 名单顺序不影响结论
  const reordered = standardInput();
  reordered.teams.a = roster("T-A", "甲方", [...reordered.teams.a.gameIds].reverse());
  const c = matchTeamsByIdentity(reordered);
  check("名单内部顺序不影响结论", c.status === "matched" && c.first?.team === "a");
}

console.log(`\n结果：通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);
