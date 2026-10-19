// =====================
// 瑞士轮配对（2026-10-19）
//
// **前提（由规则 R4 保证）**：队伍数必须是 2 的幂（8/16/32/64）。
// 这条规则把问题从"有轮空、可能配不出"变成了"无轮空、必然可解" ——
// 2^k 支队伍打 k 轮，一定存在一个每轮都不重赛的配对方案（经典结论），所以下面的搜索必然收敛。
//
// 接口与单败/循环不同：瑞士轮**不能预先算出全部对阵**，每轮依赖上一轮结果，
// 所以是「给当前战绩 + 已打过的对阵 → 产出本轮配对」，由排期层逐轮调用。
//
// 配对规则：按战绩降序 → 优先同分互配 → 若同档配不出（人数为奇数）就让一人下浮 →
// 全程不允许重赛。不做 Buchholz 等精细分（校园赛用不上，且会破坏确定性）。
// =====================

export interface SwissPairing {
  /** 本轮的配对；队伍数为 2 的幂时不会有轮空 */
  pairs: Array<[string, string]>;
  /** 轮空队伍。R4 保证不会出现，字段保留是为了接口稳定 */
  bye: string | null;
}

export interface SwissState {
  /** 队 id → 当前胜场数 */
  scores: Record<string, number>;
  /** 已打过的对阵（pairKey 规范化后） */
  played: string[];
  hadBye: string[];
}

/** 与顺序无关的对阵键 */
export const pairKey = (a: string, b: string): string => [a, b].sort().join("|");

/** 轮数 = ⌈log2(n)⌉（8→3、16→4、32→5） */
export function swissRoundCount(teamCount: number): number {
  if (teamCount < 2) return 0;
  return Math.ceil(Math.log2(teamCount));
}

const isPowerOfTwo = (n: number) => n >= 2 && (n & (n - 1)) === 0;

/**
 * 生成本轮配对。
 * @throws 队伍数不是 2 的幂（调用方应先过 validateStageChain 的 R4）
 */
export function pairSwissRound(teamIds: string[], state: SwissState, roundIndex = 0): SwissPairing {
  const ids = [...new Set(teamIds)].filter(Boolean);
  if (!isPowerOfTwo(ids.length)) {
    throw new Error(`瑞士轮要求队伍数是 2 的幂（8/16/32/64），当前 ${ids.length} 支。`);
  }

  // 第一轮：按给定顺序相邻配对（给定顺序即签位顺序），不做战绩排序
  if (roundIndex === 0) {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < ids.length; i += 2) pairs.push([ids[i], ids[i + 1]]);
    return { pairs, bye: null };
  }

  const played = new Set(state.played);
  const score = (id: string) => state.scores[id] ?? 0;
  // 排序：战绩降序 → id 升序（确定性：同一份战绩永远产出同一组对阵）
  const sorted = [...ids].sort((a, b) => score(b) - score(a) || a.localeCompare(b));

  let steps = 0;
  const BUDGET = 50000;
  /** 回溯配对：只接受没打过的组合；同分优先。2^k 队打 k 轮必然有解，预算只是保险。 */
  const match = (rest: string[]): Array<[string, string]> | null => {
    if (rest.length === 0) return [];
    if (steps > BUDGET) return null;
    const [a, ...others] = rest;
    const candidates = others
      .map((b, index) => ({ b, index, rank: score(a) === score(b) ? 0 : 1 }))
      .filter(({ b }) => !played.has(pairKey(a, b)))
      .sort((x, y) => x.rank - y.rank || x.b.localeCompare(y.b));
    for (const { b, index } of candidates) {
      steps += 1;
      if (steps > BUDGET) return null;
      const sub = match(others.filter((_, i) => i !== index));
      if (sub) return [[a, b], ...sub];
    }
    return null;
  };

  const pairs = match(sorted);
  if (!pairs) {
    // 理论上到不了这里（2^k 队 k 轮必有解）。真到了说明战绩数据异常，宁可报错也不静默重赛。
    throw new Error("瑞士轮配对无解：请检查已打过的对阵记录是否完整。");
  }
  return { pairs, bye: null };
}

/** 把本轮结果并入状态 */
export function applySwissRound(state: SwissState, pairing: SwissPairing, winners: string[]): SwissState {
  const scores = { ...state.scores };
  for (const id of winners) scores[id] = (scores[id] ?? 0) + 1;
  return {
    scores,
    played: [...state.played, ...pairing.pairs.map(([a, b]) => pairKey(a, b))],
    hadBye: state.hadBye,
  };
}
