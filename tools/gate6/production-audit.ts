// =====================
// 线上赛事数据 · 只读一致性巡检
//
// 只读：只用两个公开接口（公开赛程 / 公开报名），只发 GET，不写任何东西、不带任何凭据。
// **因此它在任何能上网的机器上都能跑** —— 包括比赛进行中、包括没装 Supabase 凭据的地方。
//
// 它找的是界面看不出来、但会随晋级一路传下去的问题：赛果与逐局比分不一致、胜者不在两队里、
// 单败阶段同一队出现两次、资格赛胜者没进下一阶段、同队时间撞车、赛程引用了报名名单里不存在的队伍。
//
// 用法：
//   npm run ops:audit-production                 （默认查 ecustesports.top / event-1）
//   npm run ops:audit-production -- event-1 https://其他域名
//   npm run ops:audit-production -- --selftest   自检这套检查本身（不联网）
//
// 退出码：0 = 没有发现问题；1 = 有问题（或自检未通过）；2 = 取数据失败
//
// 注意：公开报名接口在公布期只返回**已冻结**队伍，队名相关的检查以「公开可见名单」为准。
// =====================

const DEFAULT_BASE = "https://ecustesports.top";
const DEFAULT_EVENT = "event-1";

const WIN_TARGET: Record<string, number> = { BO1: 1, BO3: 2, BO5: 3 };
/** 单败阶段：同一支队伍在同一个阶段里最多出现一次。 */
const SINGLE_ELIMINATION_PHASES = ["资格赛", "入围赛"];
/** 资格赛的胜者应当出现在这个阶段里。 */
const NEXT_PHASE_AFTER_QUALIFIER = "入围赛";
const QUALIFIER_PHASE = "资格赛";

export interface MatchLike {
  id: string;
  phase?: string;
  boType?: string;
  status?: string;
  startTime?: string | null;
  endTime?: string | null;
  teamAId?: string | null;
  teamBId?: string | null;
  teamAName?: string | null;
  teamBName?: string | null;
  winnerTeamId?: string | null;
  gameResults?: Array<{ teamAScore?: number; teamBScore?: number }>;
}

export interface TeamLike {
  id?: string;
  name?: string;
}

export interface PlayerLike {
  id?: string;
  role?: string;
  teamName?: string;
}

export interface AuditInput {
  matches: MatchLike[];
  teams: TeamLike[];
  players: PlayerLike[];
}

export interface AuditResult {
  /** 数据自相矛盾的地方；空数组才表示干净。 */
  problems: string[];
  /** 有信息量但不构成错误的事实（口径、分布、数量）。 */
  notes: string[];
}

/**
 * 全部检查都是这段纯函数，一行网络代码都没有 ——
 * 这样才可能拿合成夹具把**每一组检查**分别弄红（见 --selftest），
 * 而不是只能对着线上说一句「跑下来没问题」。
 */
export function auditProduction(input: AuditInput): AuditResult {
  const { matches, teams, players } = input;
  const problems: string[] = [];
  const notes: string[] = [];
  const problem = (text: string) => problems.push(text);

  const teamById = new Map<string, TeamLike>();
  for (const team of teams) if (team.id) teamById.set(team.id, team);
  const nameById = new Map<string, string | undefined>();
  for (const team of teams) if (team.id) nameById.set(team.id, team.name);

  // ── A. 结构 ──────────────────────────────────────────────
  const seenIds = new Set<string>();
  for (const m of matches) {
    if (seenIds.has(m.id)) problem(`比赛 ID 重复：${m.id}`);
    seenIds.add(m.id);
    if (!m.teamAId || !m.teamBId) problem(`${m.id}：缺少队伍 ID`);
    if (m.teamAId && m.teamAId === m.teamBId) problem(`${m.id}：两队是同一支（${m.teamAId}）`);
    if (!m.teamAName || !m.teamBName) problem(`${m.id}：队名为空`);
    if (!(m.boType && m.boType in WIN_TARGET)) problem(`${m.id}：赛制无法识别（${m.boType}）`);
  }

  // ── B. 时间 ──────────────────────────────────────────────
  for (const m of matches) {
    if (m.status === "已排期" && !m.startTime) problem(`${m.id}：状态是已排期，但没有开始时间`);
    if (m.startTime && m.endTime && !(new Date(m.endTime) > new Date(m.startTime))) {
      problem(`${m.id}：结束时间不晚于开始时间（${m.startTime} → ${m.endTime}）`);
    }
  }
  const doneWithoutStart = matches.filter((m) => m.status === "已完成" && !m.startTime);
  if (doneWithoutStart.length > 0) {
    notes.push(`已完成但没有排期时间的场次 ${doneWithoutStart.length} 场：${doneWithoutStart.map((m) => m.id).join(", ")}`);
  }

  // ── C. 赛果 ──────────────────────────────────────────────
  for (const m of matches) {
    const isDone = m.status === "已完成";
    const games = Array.isArray(m.gameResults) ? m.gameResults : [];
    if (!isDone) {
      if (games.length > 0) problem(`${m.id}：状态是「${m.status}」却带着逐局比分`);
      if (m.winnerTeamId) problem(`${m.id}：状态是「${m.status}」却带着胜者`);
      continue;
    }

    if (games.length === 0) {
      problem(`${m.id}：已完成但没有逐局比分`);
      continue;
    }
    if (!m.winnerTeamId) problem(`${m.id}：已完成但没有胜者`);
    else if (m.winnerTeamId !== m.teamAId && m.winnerTeamId !== m.teamBId) {
      problem(`${m.id}：胜者不属于这两支队伍（${m.winnerTeamId}）`);
    }

    let unusable = false;
    for (const [index, g] of games.entries()) {
      const a = g.teamAScore;
      const b = g.teamBScore;
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        problem(`${m.id} 第 ${index + 1} 局：比分不是整数`); unusable = true; continue;
      }
      if ((a as number) < 0 || (b as number) < 0) { problem(`${m.id} 第 ${index + 1} 局：比分为负`); unusable = true; }
      if (a === b) { problem(`${m.id} 第 ${index + 1} 局：平局（${a}:${b}）`); unusable = true; }
    }
    if (unusable) continue;

    const target = m.boType ? WIN_TARGET[m.boType] : undefined;
    const winsA = games.filter((g) => (g.teamAScore as number) > (g.teamBScore as number)).length;
    const winsB = games.length - winsA;
    if (target && winsA !== target && winsB !== target) {
      problem(`${m.id}：${m.boType} 的逐局比分没有决出胜负（A ${winsA} 胜 / B ${winsB} 胜）`);
      continue;
    }
    const derived = winsA > winsB ? m.teamAId : m.teamBId;
    if (m.winnerTeamId && derived !== m.winnerTeamId) {
      problem(`${m.id}：胜者与逐局比分不符 —— 记的是 ${m.winnerTeamId}，逐局算出来是 ${derived}`);
    }
  }

  // ── D. 队伍引用 ──────────────────────────────────────────
  for (const m of matches) {
    for (const [idKey, nameKey] of [["teamAId", "teamAName"], ["teamBId", "teamBName"]] as const) {
      const id = m[idKey];
      if (!id) continue;
      if (!teamById.has(id)) {
        problem(`${m.id}：引用的队伍 ${id}（${m[nameKey]}）不在报名名单里`);
        continue;
      }
      if (nameById.get(id) !== m[nameKey]) {
        problem(`${m.id}：队名与名单不一致 —— 赛程写「${m[nameKey]}」，名单是「${nameById.get(id)}」`);
      }
    }
  }

  // ── E. 单败阶段：同一队最多出现一次 ──────────────────────
  for (const phase of SINGLE_ELIMINATION_PHASES) {
    const inPhase = matches.filter((m) => m.phase === phase);
    if (inPhase.length === 0) continue;
    const count = new Map<string, number>();
    for (const m of inPhase) {
      for (const id of [m.teamAId, m.teamBId]) {
        if (id) count.set(id, (count.get(id) ?? 0) + 1);
      }
    }
    const dup = [...count].filter(([, n]) => n > 1);
    if (dup.length > 0) {
      problem(`${phase}（单败）里有队伍出现多次：${dup.map(([id, n]) => `${nameById.get(id) ?? id}×${n}`).join(", ")}`);
    }
    notes.push(`${phase}：${inPhase.length} 场，涉及 ${count.size} 支队伍`);
  }

  // ── F. 跨阶段：资格赛胜者应进入入围赛 ────────────────────
  const qualifiers = matches.filter((m) => m.phase === QUALIFIER_PHASE && m.status === "已完成" && m.winnerTeamId);
  const playin = matches.filter((m) => m.phase === NEXT_PHASE_AFTER_QUALIFIER);
  if (qualifiers.length > 0 && playin.length > 0) {
    const playinIds = new Set(playin.flatMap((m) => [m.teamAId, m.teamBId]).filter(Boolean));
    const missing = qualifiers.filter((m) => !playinIds.has(m.winnerTeamId as string));
    if (missing.length > 0) {
      problem(`资格赛胜者没有进入入围赛：${missing.map((m) => `${m.id} 的胜者 ${nameById.get(m.winnerTeamId as string) ?? m.winnerTeamId}`).join(", ")}`);
    } else {
      notes.push(`资格赛 ${qualifiers.length} 名胜者全部出现在入围赛里`);
    }
  }

  // ── G. 同队时间冲突 ─────────────────────────────────────
  const timed = matches
    .filter((m) => typeof m.startTime === "string" && m.startTime)
    .map((m) => ({
      id: m.id,
      a: m.teamAId ?? null,
      b: m.teamBId ?? null,
      from: new Date(m.startTime as string),
      to: new Date((m.endTime || m.startTime) as string),
    }));
  for (let i = 0; i < timed.length; i += 1) {
    for (let j = i + 1; j < timed.length; j += 1) {
      const x = timed[i];
      const y = timed[j];
      if (x.to <= y.from || y.to <= x.from) continue;
      const shared = [x.a, x.b].filter((id) => id && (id === y.a || id === y.b));
      if (shared.length > 0) {
        problem(`同一队时间撞车：${nameById.get(shared[0] as string) ?? shared[0]} 同时出现在 ${x.id}（${x.from.toISOString()}）与 ${y.id}（${y.from.toISOString()}）`);
      }
    }
  }

  // ── H. 报名口径 ─────────────────────────────────────────
  const roleCount = new Map<string, number>();
  for (const p of players) {
    const role = p.role ?? "(未填角色)";
    roleCount.set(role, (roleCount.get(role) ?? 0) + 1);
  }
  notes.push(`角色分布：${[...roleCount].map(([r, n]) => `${r} ${n}`).join(" / ")}`);

  const starterRole = [...roleCount].filter(([r]) => r !== "替补" && r !== "教练").map(([r]) => r)[0] ?? "首发";
  const byTeam = new Map<string, { total: number; starters: number }>();
  for (const p of players) {
    const teamName = p.teamName ?? "(未填队名)";
    const bucket = byTeam.get(teamName) ?? { total: 0, starters: 0 };
    bucket.total += 1;
    if (p.role === starterRole) bucket.starters += 1;
    byTeam.set(teamName, bucket);
  }
  const oddSquads = [...byTeam].filter(([, v]) => v.starters !== 5);
  notes.push(`按「${starterRole}」统计：${byTeam.size} 支队伍，首发数不等于 5 的有 ${oddSquads.length} 支`);
  if (oddSquads.length > 0) {
    notes.push(`  首发数异常：${oddSquads.map(([name, v]) => `${name}(${v.starters})`).join(", ")}`);
  }
  const rosterNames = new Set(byTeam.keys());
  const scheduledNames = new Set(matches.flatMap((m) => [m.teamAName, m.teamBName]).filter(Boolean) as string[]);
  const notInRoster = [...scheduledNames].filter((n) => !rosterNames.has(n));
  if (notInRoster.length > 0) problem(`赛程里有队名不在报名名单中：${notInRoster.join(", ")}`);

  return { problems, notes };
}

// ── 取数据（只读、GET）────────────────────────────────────────────────────

async function fetchJson(base: string, pathname: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}${pathname}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${pathname} → HTTP ${response.status}`);
  const parsed = (await response.json()) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error(`${pathname} 返回的不是对象`);
  return parsed as Record<string, unknown>;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) {
    process.exitCode = selftest();
    return;
  }
  const positional = argv.filter((raw) => !raw.startsWith("--"));
  const eventId = positional[0] ?? DEFAULT_EVENT;
  const base = (positional[1] ?? DEFAULT_BASE).replace(/\/$/, "");

  let schedule: Record<string, unknown>;
  let registration: Record<string, unknown>;
  try {
    schedule = await fetchJson(base, `/api/public/schedule?eventId=${eventId}`);
    registration = await fetchJson(base, `/api/public/registration?eventId=${eventId}`);
  } catch (error) {
    console.error(`取数据失败：${error instanceof Error ? error.message : String(error)}`);
    console.error("（这说的是「拿不到数据」，不是「数据有问题」——别混为一谈。）");
    process.exitCode = 2;
    return;
  }

  const input: AuditInput = {
    matches: asArray<MatchLike>(schedule.matches),
    teams: asArray<TeamLike>(registration.teams),
    players: asArray<PlayerLike>(registration.players),
  };

  console.log(`线上数据巡检 · ${base} · 赛事 ${eventId}`);
  console.log(`赛程版本 ${schedule.version} · 共 ${input.matches.length} 场 · 队伍 ${input.teams.length} 支 · 选手 ${input.players.length} 人`);
  console.log("");

  const { problems, notes } = auditProduction(input);
  console.log("── 发现的问题 ──");
  if (problems.length === 0) console.log("  无");
  else for (const text of problems) console.log(`  ✗ ${text}`);
  console.log("");
  console.log("── 顺带的事实 ──");
  for (const text of notes) console.log(`  · ${text}`);
  console.log("");
  console.log(`结果：${problems.length} 个问题`);
  process.exitCode = problems.length > 0 ? 1 : 0;
}

// ── 自检：每组检查都要能被单独弄红 ────────────────────────────────────────
//
// 这一步不是走形式。「跑下来没问题」有两种可能：数据真的干净，或者检查根本不会报错。
// 所以先造一份**干净夹具**（断言 0 问题），再逐组塞一个毛病进去（断言只有该组报警）。

function selftest(): number {
  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
    else { fail += 1; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
  };
  const group = (title: string) => { console.log(""); console.log(`== ${title} ==`); };

  const TEAM_NAMES = ["甲队", "乙队", "丙队", "丁队"];
  const TEAMS: TeamLike[] = TEAM_NAMES.map((name, i) => ({ id: `T-${i + 1}`, name }));
  const PLAYERS: PlayerLike[] = TEAMS.flatMap((team) =>
    ["一", "二", "三", "四", "五"].map((suffix, i) => ({
      id: `${team.id}-P${i}`, role: "首发", teamName: team.name,
    })),
  );

  const MATCH = (patch: Partial<MatchLike>): MatchLike => ({
    id: "M-Q1", phase: "资格赛", boType: "BO3", status: "已完成",
    startTime: "2026-10-06T10:00:00.000Z", endTime: "2026-10-06T11:00:00.000Z",
    teamAId: "T-1", teamBId: "T-2", teamAName: "甲队", teamBName: "乙队",
    gameResults: [{ teamAScore: 13, teamBScore: 5 }, { teamAScore: 13, teamBScore: 9 }],
    winnerTeamId: "T-1",
    ...patch,
  });

  /** 干净夹具：资格赛一场打完、入围赛一场待打，胜者已进下一阶段。 */
  const CLEAN: MatchLike[] = [
    MATCH({}),
    MATCH({
      id: "M-P1", phase: "入围赛", boType: "BO3", status: "已排期",
      startTime: "2026-10-07T10:00:00.000Z", endTime: "2026-10-07T11:00:00.000Z",
      teamAId: "T-1", teamBId: "T-3", teamAName: "甲队", teamBName: "丙队",
      gameResults: [], winnerTeamId: null,
    }),
  ];

  /** 只把某一场的某个字段换掉，其余不动。 */
  const auditOne = (patch: Partial<MatchLike>, index = 0) => {
    const matches = CLEAN.map((m, i) => (i === index ? MATCH({ ...CLEAN[index], ...patch }) : m));
    return auditProduction({ matches, teams: TEAMS, players: PLAYERS });
  };
  const hit = (result: AuditResult, fragment: string) => result.problems.some((p) => p.includes(fragment));
  const run = (result: AuditResult, name: string, fragment: string) =>
    check(name, hit(result, fragment), result.problems.join(" | ") || "（一个都没报）");

  group("组0 · 干净夹具必须零问题（否则后面每组都可能恒真）");
  {
    const clean = auditProduction({ matches: CLEAN, teams: TEAMS, players: PLAYERS });
    check("干净夹具 → 0 个问题", clean.problems.length === 0, clean.problems.join(" | "));
    check("干净夹具仍给出事实说明", clean.notes.length > 0, String(clean.notes.length));
    check("资格赛胜者进入入围赛的事实被记下", clean.notes.some((n) => n.includes("全部出现在入围赛里")), clean.notes.join(" | "));
  }

  group("组A · 结构");
  run(auditOne({ id: "M-Q1" }, 1), "比赛 ID 重复能被发现", "比赛 ID 重复");
  run(auditOne({ teamAId: "" }), "缺队伍 ID 能被发现", "缺少队伍 ID");
  run(auditOne({ teamBId: "T-1" }), "两队是同一支能被发现", "两队是同一支");
  run(auditOne({ boType: "BO7" }), "赛制无法识别能被发现", "赛制无法识别");
  run(auditOne({ teamAName: "" }), "队名为空能被发现", "队名为空");

  group("组B · 时间");
  run(auditOne({ status: "已排期", startTime: null }, 1), "已排期却没有开始时间能被发现", "没有开始时间");
  run(auditOne({ endTime: "2026-10-06T09:00:00.000Z" }), "结束早于开始能被发现", "结束时间不晚于开始时间");

  group("组C · 赛果");
  run(auditOne({ gameResults: [] }), "已完成却没有逐局比分能被发现", "已完成但没有逐局比分");
  run(auditOne({ winnerTeamId: "T-4" }), "胜者不属于这两队能被发现", "胜者不属于这两支队伍");
  run(auditOne({ gameResults: [{ teamAScore: 13, teamBScore: 13 }] }), "平局能被发现", "平局");
  run(auditOne({ gameResults: [{ teamAScore: 12.5, teamBScore: 5 }] }), "比分不是整数能被发现", "比分不是整数");
  run(auditOne({ gameResults: [{ teamAScore: -1, teamBScore: 5 }] }), "比分为负能被发现", "比分为负");
  run(auditOne({ gameResults: [{ teamAScore: 13, teamBScore: 5 }] }), "BO3 只打一局能被发现", "没有决出胜负");
  run(auditOne({ winnerTeamId: "T-2" }), "胜者与逐局比分不符能被发现", "胜者与逐局比分不符");
  {
    const notDone = auditOne({ status: "进行中", gameResults: [], winnerTeamId: null });
    check("进行中却不报问题", notDone.problems.length === 0, notDone.problems.join(" | "));
    // 注意这两条要连比分一起换：那一场本来就没有比分，只改状态是不该报错的。
    run(auditOne({ status: "进行中", gameResults: [{ teamAScore: 13, teamBScore: 5 }] }, 1), "未完成却带比分能被发现", "却带着逐局比分");
    run(auditOne({ status: "进行中", gameResults: [], winnerTeamId: "T-1" }, 1), "未完成却带胜者能被发现", "却带着胜者");
  }

  group("组D · 队伍引用");
  run(auditOne({ teamAId: "T-9" }), "引用不存在的队伍能被发现", "不在报名名单里");
  run(auditOne({ teamAName: "写错了的队名" }), "队名与名单不一致能被发现", "队名与名单不一致");

  group("组E · 单败阶段同一队出现两次");
  {
    // 时间刻意挪开：这条只测「同一队出现两次」，不该顺手把时间撞车那条也点亮。
    const duplicated = [...CLEAN, MATCH({
      id: "M-Q2", teamAId: "T-1", teamBId: "T-4", teamAName: "甲队", teamBName: "丁队",
      startTime: "2026-10-06T14:00:00.000Z", endTime: "2026-10-06T15:00:00.000Z",
      winnerTeamId: "T-1",
    })];
    const result = auditProduction({ matches: duplicated, teams: TEAMS, players: PLAYERS });
    run(result, "同一队在资格赛出现两次能被发现", "有队伍出现多次");
    check("只报了这一组，没顺手点亮时间撞车", !hit(result, "同一队时间撞车"), result.problems.join(" | "));
  }

  group("组F · 资格赛胜者要进入围赛");
  {
    const lostWinner = CLEAN.map((m, i) => (i === 1 ? MATCH({ ...m, teamAId: "T-2" }) : m));
    run(auditProduction({ matches: lostWinner, teams: TEAMS, players: PLAYERS }), "胜者掉链子能被发现", "没有进入入围赛");
  }

  group("组G · 同队时间撞车");
  {
    // 把入围赛挪到与资格赛同一时段，且沿用同一支队伍 T-1
    const collided = CLEAN.map((m, i) => (i === 1 ? MATCH({ ...m, startTime: "2026-10-06T10:30:00.000Z", endTime: "2026-10-06T11:30:00.000Z" }) : m));
    run(auditProduction({ matches: collided, teams: TEAMS, players: PLAYERS }), "同队时间撞车能被发现", "同一队时间撞车");
  }

  group("组H · 报名口径");
  {
    const wrongRosterName = CLEAN.map((m, i) => (i === 1 ? MATCH({ ...m, teamAName: "甲队", teamBName: "幽灵队" }) : m));
    run(auditProduction({ matches: wrongRosterName, teams: TEAMS, players: PLAYERS }), "赛程里出现名单外的队名能被发现", "不在报名名单中");

    const shortSquad = PLAYERS.filter((p) => p.teamName !== "甲队" || p.id !== "T-1-P0");
    const result = auditProduction({ matches: CLEAN, teams: TEAMS, players: shortSquad });
    check("首发不满 5 人被记成事实（不是错误）", result.problems.length === 0 && result.notes.some((n) => n.includes("首发数异常")), result.problems.join(" | "));
  }

  console.log("");
  console.log(`结果：通过 ${pass} / ${pass + fail}`);
  return fail > 0 ? 1 : 0;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "线上数据巡检失败");
  process.exitCode = 2;
});
