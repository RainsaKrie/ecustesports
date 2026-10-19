// =====================
// 赛段链规则校验（2026-10-19）
//
// 依据 `docs/10-后续开发规划/27-赛制规则设计_v2.0.md`：
// 办赛者可以自由编排「段类型 × BO × 段数」，但不可能的组合必须**在画对阵前就被拒绝**，
// 而且要说清"哪一段、哪条规则、为什么"。
//
// 纯函数：不读库、不碰 HTTP。problems = 不成立；warnings = 成立但不合常规（如决赛 BO1）。
// 规则编号与文档一致，报错里带 R# 便于对照。
// =====================

export type StageType = "single-elim" | "double-elim" | "swiss" | "round-robin" | "gsl-groups" | "group-single-elim";
export type BoFormat = 1 | 3 | 5;

export interface StageSpec {
  name: string;
  type: StageType;
  /** 进入本段的队伍数 */
  entrants: number;
  /** 本段晋级多少支 */
  advance: number;
  /** 本段默认 BO */
  bo: BoFormat;
  /** 分组类段：小组数（每组固定 4 队） */
  groups?: number;
  /**
   * 直进名额（2026-10-19 加）：本段除了接上一段的晋级队，还有多少支**直接进入**。
   * 用于"资格赛并入正赛"这类汇合：如 28 支直进 + 4 支从资格赛打进 = 32 强。
   * 不填视为 0（纯链条）。
   */
  directEntries?: number;
  /** 双败：败者组的 BO（不填则同 bo） */
  loserBo?: BoFormat;
}

export interface StageChain {
  /** 报名确认的队伍数 */
  entrants: number;
  stages: StageSpec[];
}

export interface StageChainIssue {
  rule: string;
  /** 第几段（0 基），null 表示整条链的问题 */
  stage: number | null;
  message: string;
}

export interface StageChainResult {
  problems: StageChainIssue[];
  warnings: StageChainIssue[];
}

const POWER_OF_TWO = [2, 4, 8, 16, 32, 64];
const isPowerOfTwo = (n: number) => POWER_OF_TWO.includes(n);

/** 每种段类型在本段会打多少场（下界）。用于 R9「每段至少 4 场」。 */
function matchesOf(stage: StageSpec): number {
  const eliminated = stage.entrants - stage.advance;
  switch (stage.type) {
    case "single-elim":
      return eliminated;
    case "double-elim":
      // 每淘汰一队大致打 2 场（胜者组 1 + 败者组 1 的量级），取下界保守判断
      return eliminated * 2 - 1;
    case "swiss":
      // 轮数 ≈ log2(entrants)，每轮 entrants/2 场
      return Math.round(Math.log2(stage.entrants)) * Math.floor(stage.entrants / 2);
    case "round-robin": {
      const n = stage.entrants;
      return (n * (n - 1)) / 2;
    }
    case "gsl-groups":
    case "group-single-elim": {
      const groups = stage.groups ?? Math.floor(stage.entrants / 4);
      // GSL 每组 5 场（2 揭幕 + 胜者组决赛 + 败者组首轮 + 败者组决赛）；
      // 小组单败是组内循环：每组 C(4,2) = 6 场。初版把两者写成 4/3，估少了。
      const perGroup = stage.type === "gsl-groups" ? 5 : 6;
      return groups * perGroup + Math.max(0, eliminated - groups);
    }
  }
}

/** R8 的段数上限（与队伍数相关） */
function maxStagesFor(entrants: number): number {
  if (entrants <= 15) return 3;
  if (entrants <= 48) return 4;
  return 0;
}

export function validateStageChain(chain: StageChain): StageChainResult {
  const problems: StageChainIssue[] = [];
  const warnings: StageChainIssue[] = [];
  const add = (rule: string, stage: number | null, message: string) =>
    problems.push({ rule, stage, message });

  // ——— 顺序按文档 §4：先边界，再末段，再逐段，再段数，再 BO，再全局 ———

  // R8 边界：4–48 队。下限原本写 8，会误杀现有「6 队 · 单循环积分赛」模板 ——
  // 回归样本（从真实模板生成）当场抓到。下方各类型规则另有各自的下限。
  if (chain.entrants < 4 || chain.entrants > 48) {
    add("R8", null, `参赛队伍数需在 4–48 之间（当前 ${chain.entrants}）。49 队以上请拆成预选与正赛两届。`);
  }
  if (chain.stages.length === 0) {
    add("R8", null, "至少要有一个赛段。");
    return { problems, warnings };
  }

  // R7 出口守恒：末段晋级必须 1
  const last = chain.stages[chain.stages.length - 1];
  if (last.advance !== 1) {
    add("R7", chain.stages.length - 1, `最后一段晋级 ${last.advance} 支 —— 这样赛制没有决出冠军。`);
  }

  // R6 入口守恒 + 段内规则
  chain.stages.forEach((stage, index) => {
    const direct = Math.max(0, stage.directEntries ?? 0);
    // 首段的"应进入数"：报名数扣掉第 2 段声明的直进名额。
    // 汇合型下报名数 ≠ 首段进入数（36 队里 8 支打资格赛、28 支直进入围赛）。
    const firstStageShare = chain.entrants - Math.max(0, chain.stages[1]?.directEntries ?? 0);
    const expected = index === 0 ? firstStageShare : chain.stages[index - 1].advance + direct;
    if (stage.entrants !== expected) {
      const source = index === 0
        ? `报名 ${expected} 支`
        : direct > 0
          ? `第 ${index} 段晋级 ${chain.stages[index - 1].advance} 支 + 直进 ${direct} 支`
          : `第 ${index} 段只晋级 ${expected} 支`;
      add("R6", index, `第 ${index + 1} 段要求 ${stage.entrants} 支，但${source}。`);
      return; // 入口不对时，后面的段内判定没有意义
    }
    // 首段不该有直进（它的来源就是报名）
    if (index === 0 && direct > 0) {
      add("R6", 0, "第 1 段的进入数就是报名数，不需要再设直进名额。");
      return;
    }
    if (stage.advance < 1 || stage.advance >= stage.entrants) {
      add("R6", index, `第 ${index + 1} 段晋级数必须是 1 到 ${stage.entrants - 1} 之间（当前 ${stage.advance}）。`);
      return;
    }

    // R1 双败必须是 2 的幂
    if (stage.type === "double-elim" && !isPowerOfTwo(stage.entrants)) {
      add("R1", index, `双败赛要求队伍数是 2 的幂（8/16/32/64）。第 ${index + 1} 段有 ${stage.entrants} 支 —— 请先筛到 16/32，或改用单败/瑞士轮。`);
    }

    // R2 单败：晋级数必须是 2 的幂（或 1）。
    // 初版写成 `entrants ≤ 2×advance`，那是**单轮**的算术 —— 但"8 进 1"是整整三轮，
    // 会被误判成"凭空补队"。回归样本（现有四套赛制）当场打红了这条。
    // 真正的约束是：签位数必须是 2 的幂，否则对阵图拼不出来。
    if (stage.type === "single-elim" && stage.advance !== 1 && !isPowerOfTwo(stage.advance)) {
      add("R2", index, `单败段晋级 ${stage.advance} 支不成立：晋级数必须是 2 的幂（2/4/8/16/32）或 1。`);
    }

    // R3 分组类：entrants = 4 × groups
    if (stage.type === "gsl-groups" || stage.type === "group-single-elim") {
      const groups = stage.groups;
      if (!groups || groups < 1) {
        add("R3", index, `第 ${index + 1} 段是分组赛，需要指定小组数。`);
      } else if (stage.entrants !== groups * 4) {
        add("R3", index, `小组赛按 4 队一组：${groups} 组需要 ${groups * 4} 支，当前 ${stage.entrants} 支。`);
      }
    }

    // R4 瑞士轮：队伍数必须是 2 的幂（8/16/32/64），且全局最多一段
    // 负责人 2026-10-19 收紧：不是"随便什么队数都能进瑞士轮" ——
    // 非 2 的幂会有轮空，配对时"谁轮空"会影响能否避免重赛，规则上直接禁止更干净。
    if (stage.type === "swiss") {
      if (!isPowerOfTwo(stage.entrants) || stage.entrants < 8) {
        add("R4", index, `瑞士轮要求队伍数是 2 的幂（8/16/32/64）。第 ${index + 1} 段是 ${stage.entrants} 支 —— 请先筛到 8/16/32，或改用单败/循环。`);
      }
      if (chain.stages.filter((s) => s.type === "swiss").length > 1) {
        add("R4", index, "一个赛事只能有一段瑞士轮（它本身已经是多轮）。");
      }
    }

    // R5 循环：组内 3–6 队
    if (stage.type === "round-robin" && (stage.entrants < 3 || stage.entrants > 6)) {
      add("R5", index, `循环赛只用于小组内部，每组 3–6 队。第 ${index + 1} 段是 ${stage.entrants} 支。`);
    }

    // R9 每段至少 4 场 —— **只约束非末段**。
    // 末段的职责是产出冠军而不是凑场次：4 进 1 只有 3 场，但那是正常的决赛段。
    // （写回归样本时才发现这条：existing single-elim-groups-8 的末段正是 4→1。）
    const isFinalStage = index === chain.stages.length - 1;
    const matches = matchesOf(stage);
    if (!isFinalStage && matches < 4) {
      add("R9", index, `第 ${index + 1} 段只有 ${matches} 场 —— 建议并入上一段，单独成段没有观赛价值。`);
    }

    // R10 瑞士 / 循环：BO 只能 1 或 3
    if ((stage.type === "swiss" || stage.type === "round-robin") && stage.bo === 5) {
      add("R10", index, `第 ${index + 1} 段是${stage.type === "swiss" ? "瑞士轮" : "循环赛"}，只能 BO1 或 BO3（BO5 会让总场次翻倍）。`);
    }

    // R12 双败的败者组不超过 BO3
    const loserBo = stage.loserBo ?? stage.bo;
    if (stage.type === "double-elim" && loserBo === 5) {
      add("R12", index, `第 ${index + 1} 段双败的败者组不能是 BO5（败者组场次约为胜者组 1.5 倍，赛期会失控）。`);
    }
  });

  // R8 段数上限
  const maxStages = maxStagesFor(chain.entrants);
  if (maxStages > 0 && chain.stages.length > maxStages) {
    add("R8", null, `${chain.entrants} 支队伍最多排 ${maxStages} 段（每段至少 4 场），当前 ${chain.stages.length} 段。`);
  }

  // R11 强度不倒挂 —— **只警告不禁止**（负责人 2026-10-19 决定保留办赛者裁量）
  for (let i = 1; i < chain.stages.length; i += 1) {
    if (chain.stages[i].bo < chain.stages[i - 1].bo) {
      warnings.push({
        rule: "R11",
        stage: i,
        message: `第 ${i + 1} 段是 BO${chain.stages[i].bo}，低于第 ${i} 段的 BO${chain.stages[i - 1].bo} —— 不符合常规强度递增，确认是你想要的可以忽略。`,
      });
    }
  }

  // R13 循环 + 瑞士不能同时出现
  const hasSwiss = chain.stages.some((s) => s.type === "swiss");
  const hasRoundRobin = chain.stages.some((s) => s.type === "round-robin");
  if (hasSwiss && hasRoundRobin) {
    add("R13", null, "瑞士轮与循环赛不要同时用 —— 两者都是多轮积分，叠加等于同一个目的做两遍。");
  }

  return { problems, warnings };
}
