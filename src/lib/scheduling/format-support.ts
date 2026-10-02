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
    && stages[2]?.type === "gsl-groups"
    && stages[2].teamCount === 16
    && stages[2].groupCount === 4
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
    && stages[1]?.type === "gsl-groups"
    && stages[1].teamCount === 16
    && stages[1].groupCount === 4
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
