import type { StageConfig } from "./format-templates";

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
 * 「现在能不能换赛制」的判定，返回拒绝理由；`null` 表示可以改（2026-10-14）。
 *
 * 原先的守卫是「只要赛程里有比赛就不许改」，**比必要的严**：它把「已经打完的阶段」与
 * 「还没生成对阵的阶段」当成一回事。真正要守的是两件事：
 *   ① **已经生成过对阵的阶段**，它的配置（名称 / 类型 / 队数 / 分组数 / BO）不得改变 —— 改了那些比赛就成了孤儿；
 *   ② 已生成阶段的**晋级人数**不得改变（体现为下一阶段的参赛队数不变）——
 *      改了就会出现「16 强赛打完了却没有 16 支队伍」。
 * 没生成对阵的阶段允许自由调整；这正是「小组赛从 GSL 改成组内单败」能安全放行的依据
 * （两者都是 16 进 8，前面已打完的资格赛与入围赛完全不受影响）。
 */
export function formatChangeRefusal(
  current: StageConfig[],
  next: StageConfig[],
  matches: Array<{ phase: string }>,
): string | null {
  const playedPhases = new Set(matches.map((match) => match.phase));

  // 先判「整个阶段被删掉」：这一条放在逐项比对之前，报错才能点出是哪个阶段没了。
  // （放在后面的话，会先撞上「上一阶段的晋级人数变了」这种二手症状，指错地方。）
  const nextNames = new Set(next.map((stage) => stage.name));
  const orphan = [...playedPhases].filter((name) => !nextNames.has(name));
  if (orphan.length > 0) {
    return `这些阶段已经有比赛，但新赛制里没有它们：${orphan.join("、")}。`;
  }

  for (const [index, stage] of current.entries()) {
    if (!playedPhases.has(stage.name)) continue;
    const replacement = next[index];
    if (!replacement) return `「${stage.name}」已经打过比赛，新赛制里没有这一阶段，不能这样改。`;
    const unchanged = replacement.name === stage.name
      && replacement.type === stage.type
      && replacement.teamCount === stage.teamCount
      && (replacement.groupCount ?? 0) === (stage.groupCount ?? 0)
      && replacement.boType === stage.boType;
    if (!unchanged) {
      return `「${stage.name}」已经打过比赛，它的赛制不能改；请只调整尚未开打的阶段。`;
    }
    const remainedNext = current[index + 1];
    const nextNext = next[index + 1];
    if (remainedNext && nextNext && nextNext.teamCount !== remainedNext.teamCount) {
      return `「${stage.name}」的晋级人数会跟着变（下一阶段应仍是 ${remainedNext.teamCount} 支），不能这样改。`;
    }
  }

  return null;
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
