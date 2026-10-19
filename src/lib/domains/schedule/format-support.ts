import type { StageConfig } from "./format-templates.ts";

export type SupportedFormat =
  | { kind: "slot-draw"; bracket: "single-elim" | "double-elim"; stage: StageConfig; requiredTeams: number }
  | { kind: "gsl-double-elim"; groupStage: StageConfig; knockoutStage: StageConfig; requiredTeams: 16 }
  | { kind: "staged-32-gsl-double-elim"; stages: [StageConfig, StageConfig, StageConfig]; requiredTeams: 32; minTeams: number }
  | {
      kind: "staged-playin";
      /** 资格赛（并入型阶段：胜者并入下一阶段，不是「本阶段的前 N 名」） */
      playInStage: StageConfig;
      /** 入围赛 / 小组赛 / 淘汰赛 */
      stages: [StageConfig, StageConfig, StageConfig];
      /** 参赛总队伍数 = 入围赛席位 + 资格赛淘汰数 */
      requiredTeams: number;
      /** 参加资格赛的队伍数（恒为偶数，一半晋级） */
      playInTeams: number;
    }
  /** 单段瑞士轮：只生成第 1 轮（相邻配对），后续轮次依赖战绩、报分后逐轮生成 */
  | { kind: "swiss"; stage: StageConfig; requiredTeams: number }
  /** 单段循环赛：全部队伍两两都打 */
  | { kind: "round-robin"; stage: StageConfig; requiredTeams: number }
  | { kind: "unsupported"; message: string; requiredTeams: number };

/** 32 队入围赛允许的最少真实队伍数：不足 17 队时应降级到 16 队赛制，而非用大量轮空硬凑 32 强。 */
export const QUALIFIER_MIN_TEAMS = 17;

function isPowerOfTwo(value: number): boolean {
  return value >= 2 && (value & (value - 1)) === 0;
}

/**
 * 当前真正完成“抽签 → 对阵 → 晋级”的赛制边界。
 * 未落地的结构明确拦截，避免后台看似可配、发布后却生成错误赛程。
 */
/**
 * 16 队小组赛的两种合法形态：**GSL 小组双败** 与 **组内单败**（2026-10-14 新增）。
 * 两者都是「4 组 × 4 队、每组前 2 名晋级」，只是组内打法不同（5 场 vs 3 场），
 * 因此进入淘汰赛的队数与后续抽签规则完全一致 —— 这是「不改已生成阶段就能换小组赛打法」的前提。
 */
function isSupportedGroupStage(stage: StageConfig | undefined): boolean {
  if (!stage) return false;
  if (stage.type !== "gsl-groups" && stage.type !== "single-elim-groups") return false;
  return stage.teamCount === 16 && stage.groupCount === 4;
}

/**
 * 「现在能不能换赛制」的判定，返回拒绝理由；`null` 表示可以改。
 *
 * 判据演进过两次，值得写下来：
 *   · 第一版：「只要赛程里有比赛就不许改」—— 太粗，连「换还没抽签的小组赛打法」都挡；
 *   · 第二版（2026-10-14 上午）：「已经生成过对阵的阶段不许改」—— 仍然太粗：
 *     **生成了对阵 ≠ 用上了**。一届赛事里小组赛刚抽完签、20 场全是「待排期」（没排时间、
 *     没有赛果），换个赛制把那批骨架换掉完全安全 —— 可第二版会拒绝，于是负责人点了
 *     「调整赛制」什么也做不成（他就是这样碰到墙的）。
 *   · 第三版（现在）：**只有出现过「已排期 / 已完成」的比赛，那个阶段才算不可动**；
 *     纯「待排期」骨架可以改，改完由 `unplayedStagesToClear` 指出要把哪几个阶段的骨架清掉。
 *
 * 要守的两条不变：
 *   ① 已被使用（排过期或有赛果）的阶段，配置与晋级人数不得改变；
 *   ② 已经打完的阶段不能被删掉。
 */
export function formatChangeRefusal(
  current: StageConfig[],
  next: StageConfig[],
  matches: Array<{ phase: string; status?: string; startTime?: string }>,
): string | null {
  /** 已被「用起来」的阶段：排过期或有赛果。纯待排期骨架不算。 */
  const usedPhases = new Set(
    matches
      // 缺 status 的老数据按「已使用」保守处理，宁可拒绝也不误删
      .filter((match) => match.status === undefined || match.status !== "待排期" || Boolean(match.startTime))
      .map((match) => match.phase),
  );

  // 先判「把已使用的阶段删掉」：这一条放在逐项比对之前，报错才能点出是哪个阶段没了。
  // （放在后面的话，会先撞上「上一阶段的晋级人数变了」这种二手症状，指错地方。）
  const nextNames = new Set(next.map((stage) => stage.name));
  const orphan = [...usedPhases].filter((name) => !nextNames.has(name));
  if (orphan.length > 0) {
    return `这些阶段已经排过期或有赛果，但新赛制里没有它们：${orphan.join("、")}。`;
  }

  for (const [index, stage] of current.entries()) {
    if (!usedPhases.has(stage.name)) continue;
    const replacement = next[index];
    if (!replacement) return `「${stage.name}」已经打过比赛，新赛制里没有这一阶段，不能这样改。`;
    const unchanged = replacement.name === stage.name
      && replacement.type === stage.type
      && replacement.teamCount === stage.teamCount
      && (replacement.groupCount ?? 0) === (stage.groupCount ?? 0)
      && replacement.boType === stage.boType;
    if (!unchanged) {
      return `「${stage.name}」已经排过期或有赛果，它的赛制不能改；请只调整尚未开打的阶段。`;
    }
    const remainedNext = current[index + 1];
    const nextNext = next[index + 1];
    if (remainedNext && nextNext && nextNext.teamCount !== remainedNext.teamCount) {
      return `「${stage.name}」的晋级人数会跟着变（下一阶段应仍是 ${remainedNext.teamCount} 支），不能这样改。`;
    }
  }

  return null;
}

/**
 * 换赛制之后需要清掉的「未开打骨架」：既出现在**旧**赛制里、又出现在**新**赛制里、
 * 但配置变了（类型/队数/分组数/BO）且**一场都没排期也没打**的阶段。
 *
 * 用途：小组赛抽完签但一场没打时，把 GSL 换成组内单败 —— 那 20 场待排期骨架要先清掉，
 * 否则抽签页会判「小组赛应有 12 场，当前赛程为 20 场」直接把新赛制堵死。
 * 只清「待排期且没有开赛时间」的，任何排过期的比赛都不会被碰。
 */
export function unplayedStagesToClear(
  current: StageConfig[],
  next: StageConfig[],
  matches: Array<{ phase: string; status?: string; startTime?: string }>,
): string[] {
  const nextByName = new Map(next.map((stage) => [stage.name, stage]));
  const clearable = new Set<string>();
  for (const stage of current) {
    const replacement = nextByName.get(stage.name);
    if (!replacement) continue;
    const sameShape = replacement.type === stage.type
      && replacement.teamCount === stage.teamCount
      && (replacement.groupCount ?? 0) === (stage.groupCount ?? 0)
      && replacement.boType === stage.boType;
    if (sameShape) continue;
    const own = matches.filter((match) => match.phase === stage.name);
    if (own.length === 0) continue;
    // 缺 status 的老数据按「已使用」处理：宁可不清，也不能误删
    if (own.every((match) => match.status === "待排期" && !match.startTime)) clearable.add(stage.name);
  }
  return [...clearable];
}

export function resolveSupportedFormat(stages: StageConfig[]): SupportedFormat {
  const requiredTeams = stages[0]?.teamCount ?? 0;

  // 四阶段：资格赛（并入）→ 入围赛 → 小组赛 → 淘汰赛。
  // 用于报名队伍数超过入围赛席位的情况（如 36 队 → 资格赛收敛到 32）。
  // 识别条件只看「后三个阶段是既有的 32 进 16 进 8 结构」，
  // 资格赛规模由 stages[0].teamCount 决定（必须为偶数，一半晋级）。
  if (
    stages.length === 4
    && stages[0]?.type === "single-elim"
    && stages[0].teamCount > 0
    && stages[0].teamCount % 2 === 0
    && stages[1]?.type === "single-elim"
    && stages[1].teamCount === 32
    && isSupportedGroupStage(stages[2])
    && stages[3]?.type === "double-elim"
    && stages[3].teamCount === 8
  ) {
    const playInTeams = stages[0].teamCount;
    return {
      kind: "staged-playin",
      playInStage: stages[0],
      stages: [stages[1], stages[2], stages[3]],
      // 入围赛席位 32 = (总队伍 − 资格赛队伍) + 资格赛队伍的一半
      // → 总队伍 = 32 + 资格赛队伍的一半
      requiredTeams: stages[1].teamCount + playInTeams / 2,
      playInTeams,
    };
  }

  if (
    stages.length === 3
    && stages[0]?.type === "single-elim"
    && stages[0].teamCount === 32
    && isSupportedGroupStage(stages[1])
    && stages[2]?.type === "double-elim"
    && stages[2].teamCount === 8
  ) {
    return {
      kind: "staged-32-gsl-double-elim",
      stages: [stages[0], stages[1], stages[2]],
      requiredTeams: 32,
      minTeams: QUALIFIER_MIN_TEAMS,
    };
  }
  // 单段瑞士轮：队伍数必须是 2 的幂且 ≥8（与 R4 同口径）。
  // 注意它与单败/循环的语义差别：**抽签只出第 1 轮**，后续靠报分逐轮生成。
  if (stages.length === 1 && stages[0]?.type === "swiss") {
    const n = stages[0].teamCount;
    if (!isPowerOfTwo(n) || n < 8) {
      return { kind: "unsupported", requiredTeams: n, message: "瑞士轮要求队伍数是 2 的幂且不少于 8 支（8/16/32）。" };
    }
    return { kind: "swiss", stage: stages[0], requiredTeams: n };
  }

  // 单段循环赛：3–6 队（与 R5 同口径；队再多场次会爆）
  if (stages.length === 1 && stages[0]?.type === "round-robin") {
    const n = stages[0].teamCount;
    if (n < 3 || n > 6) {
      return { kind: "unsupported", requiredTeams: n, message: "循环赛只支持 3–6 支队伍；更多队伍请改用小组赛。" };
    }
    return { kind: "round-robin", stage: stages[0], requiredTeams: n };
  }

  if (stages.length === 1 && stages[0]?.type === "single-elim") {
    if (!isPowerOfTwo(stages[0].teamCount)) {
      return { kind: "unsupported", requiredTeams, message: "单败淘汰的队伍数需为 2 的幂，例如 4、8、16 或 32 支。" };
    }
    return { kind: "slot-draw", bracket: "single-elim", stage: stages[0], requiredTeams };
  }

  if (stages.length === 1 && stages[0]?.type === "double-elim") {
    if (stages[0].teamCount !== 8) {
      return { kind: "unsupported", requiredTeams, message: "双败淘汰当前先支持 8 支队伍；其他规模需要补充对应的晋级拓扑。" };
    }
    return { kind: "slot-draw", bracket: "double-elim", stage: stages[0], requiredTeams: 8 };
  }

  if (
    stages.length === 2
    && stages[0]?.type === "gsl-groups"
    && stages[0].teamCount === 16
    && stages[0].groupCount === 4
    && stages[1]?.type === "double-elim"
    && stages[1].teamCount === 8
  ) {
    return {
      kind: "gsl-double-elim",
      groupStage: stages[0],
      knockoutStage: stages[1],
      requiredTeams: 16,
    };
  }

  return {
    kind: "unsupported",
    requiredTeams,
    message: "这套多阶段赛制还没有完成可执行的晋级连接。当前可发布：单阶段单败、8 队双败、16 队 GSL 接 8 队双败、32 队入围赛接 16 队 GSL 再接 8 队双败，以及资格赛（8 队）接上述 32 队结构的四阶段赛制。",
  };
}
