// =====================
// 从截图读到的昵称 → 确定属于哪支报名队伍
//
// 这是整条 AI 报分链路上**唯一从图上读不出来、又失败就无法判胜负**的环节：
// 结算表只有玩家昵称、没有队名，所以要靠昵称反查报名名单，才知道哪一组是哪支队。
//
// 这一层**不需要图片、不需要模型**：输入是「已经读出来的 5 个昵称」，
// 处理方式是字符串规范化 + 集合比对，结果是确定性的——要么匹配上，要么明确匹配不上。
// 因此它可以脱离图像部分独立完成、独立验证。
//
// 设计上的两条硬要求：
//   1. 撞名绝不猜。同一个昵称同时出现在两支队名单里时，直接判歧义、转人工。
//   2. 证据不足绝不猜。命中数不够时返回 insufficient，不返回一个「看起来最像」的答案。
//      这跟 AI 侧「宁可拒答也不要猜」是同一条原则。
// =====================

/** 报名数据里的一条队伍名单 */
export interface TeamRoster {
  teamId: string;
  teamName: string;
  /** 报名填写的游戏 ID，形如 `花弄影#5103`（截图只显示 `#` 之前的部分） */
  gameIds: string[];
}

export interface IdentityMatchInput {
  /** 从截图读到的两组昵称，原样传入（带 `#` 也行，内部会规范化） */
  readGroups: { first: string[]; second: string[] };
  /** 这场比赛的两支队伍，顺序无所谓，只是标识 */
  teams: { a: TeamRoster; b: TeamRoster };
}

export type IdentityMatchStatus =
  /** 明确匹配：两组各自唯一对应一支队 */
  | "matched"
  /** 歧义：撞名、或两组指向同一支队、或两种分配无法区分。必须转人工 */
  | "ambiguous"
  /** 证据不足：命中数达不到阈值 */
  | "insufficient";

export interface SideAssignment {
  /** 这一组对应名单上的哪支队（"a" 或 "b"） */
  team: "a" | "b";
  teamId: string;
  teamName: string;
  /** 完全相同的命中数 */
  exactHits: number;
  /** 仅忽略大小写后相同的命中数（可能是识别时大小写读错） */
  caseOnlyHits: number;
  /** 该队报名人数 */
  rosterSize: number;
  /** 该组读到的昵称数 */
  readSize: number;
  /** 命中该队的昵称（取自截图，原样保留，便于人工核对） */
  matchedNames: string[];
  /** 该组里没能命中该队的昵称（可能是识别错、或该选手未在名单中） */
  unmatchedNames: string[];
}

export interface IdentityMatchResult {
  status: IdentityMatchStatus;
  first: SideAssignment | null;
  second: SideAssignment | null;
  reasons: string[];
  /** 同时出现在两队名单里的昵称。非空即判歧义 */
  collidingNames: string[];
  /** 两种分配方案的得分，用于解释为什么无法区分 */
  scores: { straight: number; swapped: number };
}

export interface MatchOptions {
  /**
   * 认定一支队所需的最少「完全相同」命中数。
   * 实际会与「该队报名人数」取小——报名只有 1 人的队不该要求命中 2 个。
   */
  minExactHits?: number;
  /**
   * 是否允许「仅忽略大小写命中」作为证据。
   * 默认允许，但它**不能单独支撑一次判定**（至少要有 1 个完全相同命中）。
   * 理由：游戏 ID 的大小写有意义，只靠忽略大小写命中说明很可能读错了。
   */
  allowCaseOnly?: boolean;
}

const DEFAULT_MIN_EXACT_HITS = 2;

/**
 * 规范化游戏 ID：取 `#` 之前的部分。
 *
 * 必要性：报名填写的是无畏契约标准 ID（`昵称#4到5位数字`，实测生产数据 94% 如此），
 * 而结算表上**只显示 `#` 之前的部分**。不做这一步，精确匹配会全部失败。
 *
 * 顺带处理：全角井号、首尾空白、以及零宽字符。
 */
export function normalizeGameId(raw: string): string {
  if (typeof raw !== "string") return "";
  // 常见的井号变体，以及零宽字符
  const cleaned = raw
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[＃﹟]/g, "#")
    .trim();
  const hash = cleaned.lastIndexOf("#");
  const name = hash > 0 ? cleaned.slice(0, hash) : cleaned;
  return name.trim();
}

/** 比较用的键：忽略大小写与内部空白差异 */
function matchKey(name: string): string {
  return normalizeGameId(name).toLowerCase().replace(/\s+/g, "");
}

interface RosterIndex {
  /** matchKey → 拥有该昵称的队伍集合 */
  owners: Map<string, Set<"a" | "b">>;
  /** matchKey → 原样昵称（用于回报命中项） */
  display: Map<string, string>;
  sizes: { a: number; b: number };
}

function buildIndex(teams: IdentityMatchInput["teams"]): RosterIndex {
  const owners = new Map<string, Set<"a" | "b">>();
  const display = new Map<string, string>();
  const sizes = { a: 0, b: 0 };
  for (const side of ["a", "b"] as const) {
    const seen = new Set<string>();
    for (const raw of teams[side].gameIds) {
      const key = matchKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      sizes[side] += 1;
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key)!.add(side);
      if (!display.has(key)) display.set(key, normalizeGameId(raw));
    }
  }
  return { owners, display, sizes };
}

/** 一组昵称对某支队的命中情况 */
function scoreAgainst(
  group: string[],
  side: "a" | "b",
  index: RosterIndex,
): { exact: number; caseOnly: number; matched: string[]; unmatched: string[] } {
  let exact = 0;
  let caseOnly = 0;
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const raw of group) {
    const key = matchKey(raw);
    if (!key) continue;
    const owners = index.owners.get(key);
    if (owners && owners.has(side)) {
      matched.push(raw);
      // 与名单原文比较判断是完全一致还是仅忽略大小写
      const original = index.display.get(key) ?? "";
      if (normalizeGameId(raw) === original) exact += 1;
      else caseOnly += 1;
    } else {
      unmatched.push(raw);
    }
  }
  return { exact, caseOnly, matched, unmatched };
}

function toAssignment(
  team: "a" | "b",
  roster: TeamRoster,
  readSize: number,
  rosterSize: number,
  scored: { exact: number; caseOnly: number; matched: string[]; unmatched: string[] },
): SideAssignment {
  return {
    team,
    teamId: roster.teamId,
    teamName: roster.teamName,
    exactHits: scored.exact,
    caseOnlyHits: scored.caseOnly,
    rosterSize,
    readSize,
    matchedNames: scored.matched,
    unmatchedNames: scored.unmatched,
  };
}

/**
 * 判定读到的两组昵称分别属于哪支队。
 *
 * 判定顺序（顺序本身是设计的一部分，每一步都对应一种真实的出错方式）：
 *   1. 名单为空 → 证据不足。无从比对，不去猜。
 *   2. 撞名 → 歧义。只要有一个昵称同时出现在两队名单里，就不进入打分。
 *   3. 两组都一个都没命中 → 证据不足。可能传错图、或这些人都不在名单里。
 *   4. 逐组定归属：取该组命中的那支队。若一组对两队的命中数相同（含都命中 0 个）→
 *      这一组定不了，判歧义。
 *   5. 两组各自指向同一支队 → 歧义。说明分组本身有问题（模型把两队的人混分了）。
 *   6. 命中数达不到阈值 → 证据不足。
 *   7. 全部通过 → 匹配成功。
 *
 * 这里刻意**不返回「看起来最像」的答案**。定不了就是定不了，交给人工。
 * 与 AI 侧「宁可拒答也不要猜」是同一条原则。
 */
export function matchTeamsByIdentity(
  input: IdentityMatchInput,
  options: MatchOptions = {},
): IdentityMatchResult {
  const minExact = options.minExactHits ?? DEFAULT_MIN_EXACT_HITS;
  const allowCaseOnly = options.allowCaseOnly ?? true;
  const index = buildIndex(input.teams);
  const reasons: string[] = [];

  const weight = (s: { exact: number; caseOnly: number }) =>
    allowCaseOnly ? s.exact + 0.5 * s.caseOnly : s.exact;

  const firstA = scoreAgainst(input.readGroups.first, "a", index);
  const firstB = scoreAgainst(input.readGroups.first, "b", index);
  const secondA = scoreAgainst(input.readGroups.second, "a", index);
  const secondB = scoreAgainst(input.readGroups.second, "b", index);

  const scores = {
    straight: weight(firstA) + weight(secondB),
    swapped: weight(firstB) + weight(secondA),
  };

  // 1. 名单为空
  const absent = (["a", "b"] as const).filter((s) => input.teams[s].gameIds.length === 0);
  if (absent.length > 0) {
    return {
      status: "insufficient",
      first: null,
      second: null,
      reasons: [`队伍 ${absent.join("、")} 没有任何报名游戏 ID，无法比对`],
      collidingNames: [],
      scores,
    };
  }

  // 2. 撞名
  const colliding = new Set<string>();
  for (const group of [input.readGroups.first, input.readGroups.second]) {
    for (const raw of group) {
      const owners = index.owners.get(matchKey(raw));
      if (owners && owners.size > 1) colliding.add(raw);
    }
  }
  if (colliding.size > 0) {
    return {
      status: "ambiguous",
      first: null,
      second: null,
      reasons: [
        `以下昵称同时出现在两支队伍的报名名单里，无法判断归属：${[...colliding].join("、")}。需要人工确认`,
      ],
      collidingNames: [...colliding],
      scores,
    };
  }

  // 3. 两组都完全没命中
  const totalHits = firstA.exact + firstB.exact + secondA.exact + secondB.exact;
  if (totalHits === 0) {
    return {
      status: "insufficient",
      first: null,
      second: null,
      reasons: ["两组昵称都没有命中任何一支队伍的报名名单，可能传错了图或这些选手未报名"],
      collidingNames: [],
      scores,
    };
  }

  // 4. 逐组定归属
  const decide = (
    label: string,
    forA: { exact: number; caseOnly: number },
    forB: { exact: number; caseOnly: number },
  ): "a" | "b" | null => {
    const wa = weight(forA);
    const wb = weight(forB);
    if (wa === wb) {
      reasons.push(
        `${label}对两支队伍的命中数相同（${input.teams.a.teamName} ${forA.exact} 个、` +
          `${input.teams.b.teamName} ${forB.exact} 个），无法确定属于哪一支`,
      );
      return null;
    }
    return wa > wb ? "a" : "b";
  };

  const firstSide = decide("第一组", firstA, firstB);
  const secondSide = decide("第二组", secondA, secondB);
  if (firstSide === null || secondSide === null) {
    return { status: "ambiguous", first: null, second: null, reasons, collidingNames: [], scores };
  }

  // 5. 两组指向同一支队
  if (firstSide === secondSide) {
    return {
      status: "ambiguous",
      first: null,
      second: null,
      reasons: [
        ...reasons,
        `读到的两组昵称都指向「${input.teams[firstSide].teamName}」，说明分组有误或匹配异常`,
      ],
      collidingNames: [],
      scores,
    };
  }

  // 6. 阈值检查。与「该队报名人数」取小——报名只有 1 人的队不该要求命中 2 个。
  const firstScored = firstSide === "a" ? firstA : firstB;
  const secondScored = secondSide === "a" ? secondA : secondB;
  const requiredFor = (side: "a" | "b") => Math.max(1, Math.min(minExact, index.sizes[side]));

  const shortfalls: string[] = [];
  for (const [label, scored, side] of [
    ["第一组", firstScored, firstSide],
    ["第二组", secondScored, secondSide],
  ] as const) {
    const need = requiredFor(side);
    if (scored.exact < need) {
      shortfalls.push(
        `${label}对「${input.teams[side].teamName}」完全相同命中 ${scored.exact} 个（要求至少 ${need} 个）`,
      );
    }
  }
  if (shortfalls.length > 0) {
    return {
      status: "insufficient",
      first: null,
      second: null,
      reasons: [...reasons, ...shortfalls, "证据不足，不猜归属，请人工确认"],
      collidingNames: [],
      scores,
    };
  }

  if (allowCaseOnly) {
    const caseOnlyTotal = firstScored.caseOnly + secondScored.caseOnly;
    if (caseOnlyTotal > 0) {
      reasons.push(`有 ${caseOnlyTotal} 个昵称只在忽略大小写后命中，可能是识别时大小写读错，建议核对`);
    }
  }

  return {
    status: "matched",
    first: toAssignment(firstSide, input.teams[firstSide], input.readGroups.first.length, index.sizes[firstSide], firstScored),
    second: toAssignment(secondSide, input.teams[secondSide], input.readGroups.second.length, index.sizes[secondSide], secondScored),
    reasons,
    collidingNames: [],
    scores,
  };
}

/**
 * 从报名快照构造两支队名单。调用方传进来的是已经过滤好「属于这场比赛」的选手。
 * 只取首发与替补（教练不上场），且忽略已退赛的。
 */
export function buildRoster(input: {
  teamId: string;
  teamName: string;
  players: Array<{ gameId: string; role?: string; status?: string }>;
}): TeamRoster {
  const gameIds = input.players
    .filter((p) => p.role !== "教练")
    .filter((p) => p.status !== "已退赛")
    .map((p) => p.gameId)
    .filter((g) => typeof g === "string" && g.trim() !== "");
  return { teamId: input.teamId, teamName: input.teamName, gameIds };
}

/** 报名选手的最小形状。只声明本模块用到的字段，避免与报名模块耦合。 */
export interface SquadPlayerLike {
  gameId?: string;
  teamId?: string;
  role?: string;
  status?: string;
}

/**
 * 把报名选手列表整理成「队伍 ID → 该队登场队员昵称」。
 *
 * 三件必须做的事：
 *   1. **排除教练** —— 教练不上场，结算表里不会出现，留着会干扰匹配。
 *   2. **排除已退赛** —— 退赛选手不计入名单。
 *   3. **规范化昵称**（取 `#` 之前）—— 截图只显示昵称，带标签的 ID 匹配不上。
 *
 * 顺序保持报名顺序，便于人工核对时一一对应。
 */
export function buildSquadsByTeamId(players: SquadPlayerLike[]): Map<string, string[]> {
  const byTeam = new Map<string, string[]>();
  for (const player of players) {
    if (!player.teamId) continue;
    if (player.role === "教练") continue;
    if (player.status === "已退赛") continue;
    const name = normalizeGameId(player.gameId ?? "");
    if (!name) continue;
    const list = byTeam.get(player.teamId) ?? [];
    if (!list.includes(name)) list.push(name);
    byTeam.set(player.teamId, list);
  }
  return byTeam;
}
