// =====================
// AIE-02 赛果识别离线评测框架：数据结构
//
// 三层数据严格分离：
//   1. CaseInput —— 喂给模型的输入（**不含任何答案**）
//   2. CaseTruth —— 人工标注答案（模型执行者不得读取）
//   3. CasePrediction —— 模型输出记录
//
// run 阶段只读 manifest（CaseInput）；score 阶段才读 truth。这是盲测的技术保障，
// 不是靠约定。
// =====================

export type BoType = "BO1" | "BO3" | "BO5";
export type Side = "A" | "B";

/** 数据拆分：开发集调提示词、验证集阶段比较、冻结集出 Gate 结论、影子集上线后产生 */
export type Split = "dev" | "validation" | "frozen" | "shadow";

/** 样本类别，对齐工作包 §3 的六类分层 */
export type CaseCategory =
  | "clear" // 标准清晰截图
  | "compressed" // 手机压缩/裁剪
  | "blurry" // 模糊、遮挡、缺字段
  | "multi-game" // 多局多图
  | "name-interference" // 队伍顺序相反、名称干扰
  | "invalid"; // 非赛果图片或错误游戏页面

export const CASE_CATEGORIES: readonly CaseCategory[] = [
  "clear",
  "compressed",
  "blurry",
  "multi-game",
  "name-interference",
  "invalid",
];

export const SPLITS: readonly Split[] = ["dev", "validation", "frozen", "shadow"];

/** 工作包 §3 要求的最低样本量，用于校验数据集是否够用 */
export const CATEGORY_MINIMUM: Record<CaseCategory, number> = {
  clear: 15,
  compressed: 10,
  blurry: 8,
  "multi-game": 8,
  "name-interference": 5,
  invalid: 4,
};

export interface CaseImage {
  /** 相对数据集 images/ 的文件名。图片本身不进仓库。 */
  file: string;
  /** 同一案例内的顺序，从 1 开始 */
  order: number;
  /** 由清晰图合成的退化样本（压缩/裁剪/模糊）须标记，避免被当成真实场景 */
  synthetic?: boolean;
}

/** 喂给模型的输入。**此结构不得包含任何答案字段。** */
export interface CaseInput {
  caseId: string;
  /** 同一场比赛、同一原图及其裁剪变体必须同组，防止数据泄漏 */
  groupId: string;
  split: Split;
  category: CaseCategory;
  game: string;
  pageType: string;
  boType: BoType;
  teams: { a: string; b: string };
  /**
   * 两队队员昵称，**已去掉 `#` 及之后的部分**。
   *
   * 结算表上只有玩家昵称、没有队名，底色只表明「谁和谁一队」而不表明「是哪支队」。
   * 模型必须靠昵称比对才能确定底色与 A/B 队的对应关系——这是判定胜负的必要输入。
   * 缺了它，队属无法确定，胜负也就无从得出。
   *
   * 报名数据里存的是 `昵称#标签`（如 `花弄影#12345`），而截图只显示 `花弄影`，
   * 所以传进来之前必须先规范化，否则匹配必然失败。
   */
  squads?: { a: string[]; b: string[] };
  /** BP 确定的完整地图序列，按局序排列。模型据此把截图上的地图名反查到局次。 */
  knownMaps?: string[];
  images: CaseImage[];
  privacy: {
    containsPii: boolean;
    /** 遮盖方式说明；不含 PII 时写「无」 */
    redaction: string;
  };
  /** 作业说明，例如「本图为无效输入，预期拒答」——只描述期望行为，不给答案 */
  note?: string;
}

export interface TruthGame {
  map: string | null;
  teamAScore: number;
  teamBScore: number;
}

/** 人工标注答案。**模型执行者不得读取。** */
export interface CaseTruth {
  caseId: string;
  /** 该案例是否应当拒答（无效输入、关键信息不足） */
  shouldRefuse: boolean;
  refusalReason?: string;
  /** 图中不可确定的字段名，如 "winnerSide" / "games[0].map" */
  undeterminable: string[];
  series: { a: number; b: number } | null;
  winnerSide: Side | null;
  games: TruthGame[];
  /** 该案例的比分本身违反 BO 规则（用于验证规则层必须拦下） */
  illegalBo: boolean;
  annotatedBy: string[];
  disagreements?: string;
  resolvedBy?: string;
}

export interface ParsedOutput {
  series: { a: number; b: number } | null;
  winnerSide: Side | null;
  games: TruthGame[];
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** 送进去的图片张数 */
  images?: number;
  /** 单案例成本（美元）。由价格表算出，不由模型自报。 */
  costUsd?: number;
}

export interface CasePrediction {
  caseId: string;
  armId: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  startedAt: string;
  latencyMs: number;
  usage: TokenUsage;
  /** 模型是否主动拒答 */
  refused: boolean;
  refusedReason?: string | null;
  /** 解析后的结构；null 表示解析失败 */
  parsed: ParsedOutput | null;
  parseError?: string | null;
  /** schema 校验发现的问题；**只记录，不修补** */
  validatorErrors: string[];
  /**
   * 模型原始输出。默认不保存——真实截图旁边往往带昵称与聊天，
   * 原样入库等于把个人信息抄一遍。仅在明确开启时保存。
   */
  raw?: string;
}

export interface RunMeta {
  runId: string;
  armId: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  datasetId: string;
  datasetDir: string;
  startedAt: string;
  finishedAt?: string;
  caseCount: number;
  storeRawOutput: boolean;
  timeoutMs: number;
}

export interface RunFailure {
  caseId: string;
  armId: string;
  kind: "adapterError" | "timeout" | "missingImage";
  message: string;
  at: string;
}

export interface Manifest {
  schemaVersion: number;
  datasetId: string;
  /** 冻结集打包时间；未冻结时为空 */
  frozenAt?: string;
  notes?: string;
  cases: CaseInput[];
}

export interface TruthFile {
  schemaVersion: number;
  cases: CaseTruth[];
}
