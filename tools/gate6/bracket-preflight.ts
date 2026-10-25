// =====================
// 淘汰赛开赛前体检（2026-10-25，审查 4.5）
//
// 为什么单独一个脚本：2026-10-22 那批问题全是"比赛中途才发现"——
// 场次对不上、名次取不到、局制被判不一致、对阵图整块不显示。
// 这些都该在**开赛前**就能看出来。
//
// 只读：只打公开接口，不写库、不需要凭证。
// 运行：npm run ops:preflight
// =====================

const BASE = process.env.EVENT_BASE_URL ?? "https://ecustesports.top";
const EVENT_ID = process.env.EVENT_ID ?? "event-1";

type Match = {
  id: string; phase: string; round?: string; status: string; boType: string;
  teamAId?: string; teamBId?: string; teamAName?: string; teamBName?: string;
  winnerTeamId?: string; startTime?: string; nextMatchId?: string;
};

const problems: string[] = [];
const facts: string[] = [];

async function main() {
  const res = await fetch(`${BASE}/api/public/schedule?eventId=${EVENT_ID}&t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) { console.log(`读取赛程失败：HTTP ${res.status}`); process.exit(1); }
  const data = await res.json() as { version: number; matches: Match[] };
  const matches = data.matches;

  console.log(`淘汰赛体检 · ${BASE} · ${EVENT_ID}`);
  console.log(`赛程版本 ${data.version} · 共 ${matches.length} 场\n`);

  const byPhase = new Map<string, Match[]>();
  for (const m of matches) {
    const list = byPhase.get(m.phase) ?? [];
    list.push(m);
    byPhase.set(m.phase, list);
  }

  for (const [phase, list] of byPhase) {
    const done = list.filter((m) => m.status === "已完成").length;
    facts.push(`${phase}：${done}/${list.length} 已完成`);
  }

  const ko = [...byPhase.entries()].find(([name]) => name.includes("淘汰"))?.[1] ?? [];
  if (ko.length === 0) {
    problems.push("赛程里没有淘汰赛阶段 —— 抽签还没生成？");
  } else {
    // ① 必填字段
    const noRound = ko.filter((m) => !m.round);
    if (noRound.length) problems.push(`淘汰赛有 ${noRound.length} 场缺少轮次（round），对阵图无法渲染`);

    // ② 局制分布（双败：BO3 为主，败者组决赛/总决赛升 BO5）
    const bo = ko.reduce<Record<string, number>>((acc, m) => { acc[m.boType] = (acc[m.boType] ?? 0) + 1; return acc; }, {});
    facts.push(`淘汰赛局制分布：${Object.entries(bo).map(([k, v]) => `${k}×${v}`).join(" / ")}`);
    const bo5 = ko.filter((m) => m.boType === "BO5").map((m) => m.round);
    const unexpectedBo5 = bo5.filter((r) => r !== "败者组决赛" && r !== "总决赛");
    if (unexpectedBo5.length) {
      problems.push(`有非预期轮次在用 BO5：${[...new Set(unexpectedBo5)].join("、")}（约定只有败者组决赛 / 总决赛）`);
    }

    // ③ 首轮对阵是否已确定（抽签落地）
    // 只认**胜者组**第一轮：败者组第一轮本来就要等胜者组打完后才有队伍掉下来，
    // 它显示「待定 vs 待定」是正常的，不能算"抽签未落地"。
    const firstRound = ko.filter((m) => (m.round ?? "") === "胜者组第一轮");
    const undecided = firstRound.filter((m) => !m.teamAId || !m.teamBId || m.teamAName === "待定");
    if (firstRound.length && undecided.length) {
      problems.push(`首轮有 ${undecided.length} 场对阵未确定（抽签未落地或名额不足）`);
    }
    if (firstRound.length) {
      const ids = new Set(firstRound.flatMap((m) => [m.teamAId, m.teamBId]).filter(Boolean));
      facts.push(`首轮参赛队 ${ids.size} 支`);
      if (ids.size !== firstRound.length * 2) {
        problems.push(`首轮队伍数异常：${ids.size} 支，应为 ${firstRound.length * 2} 支（有重复或缺失）`);
      }
    }

    // ④ 晋级链完整性
    const ids = new Set(ko.map((m) => m.id));
    const dangling = ko.filter((m) => m.nextMatchId && !ids.has(m.nextMatchId));
    if (dangling.length) {
      problems.push(`有 ${dangling.length} 场的晋级目标不在赛程里（悬空引用）`);
    }

    // ⑤ 排期覆盖
    const unscheduled = ko.filter((m) => m.status === "待排期").length;
    facts.push(`待排期 ${unscheduled} 场 / 共 ${ko.length} 场`);
  }

  console.log("── 事实 ──");
  facts.forEach((f) => console.log(`  · ${f}`));

  console.log("");
  if (problems.length === 0) {
    console.log("── 问题 ──\n  无，可以开赛\n");
  } else {
    console.log("── 问题 ──");
    problems.forEach((p) => console.log(`  ✗ ${p}`));
    console.log("");
    process.exitCode = 1;
  }
}

void main();
