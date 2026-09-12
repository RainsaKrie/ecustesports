// =====================
// AIE-02 评测框架：schema 校验
//
// 原则：**只报问题，不修补**。任何字段缺失或类型不对都进 problems 数组，
// 由评分端按「结构错误」归类，不允许静默填默认值——静默修补会让评分虚高。
// =====================

import {
  CASE_CATEGORIES,
  CATEGORY_MINIMUM,
  SPLITS,
  type BoType,
  type CaseCategory,
  type CaseInput,
  type CasePrediction,
  type CaseTruth,
  type Manifest,
  type ParsedOutput,
  type Side,
  type Split,
  type TruthFile,
} from "./types";

export const MANIFEST_SCHEMA_VERSION = 1;
export const TRUTH_SCHEMA_VERSION = 1;
export const PREDICTION_SCHEMA_VERSION = "result-vision-1";

const BO_TYPES: readonly string[] = ["BO1", "BO3", "BO5"];

/** 输入里绝不能出现的字段名——它们属于答案层 */
const ANSWER_KEYS = ["series", "winnerSide", "winner", "games", "gameResults", "truth", "answer", "score"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isSafeScore(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function checkGamesShape(games: unknown, label: string, problems: string[], allowNullMap: boolean): void {
  if (!Array.isArray(games)) {
    problems.push(`${label} 不是数组`);
    return;
  }
  games.forEach((game, index) => {
    if (!isRecord(game)) {
      problems.push(`${label}[${index}] 不是对象`);
      return;
    }
    if (!isSafeScore(game.teamAScore)) problems.push(`${label}[${index}].teamAScore 不是非负整数`);
    if (!isSafeScore(game.teamBScore)) problems.push(`${label}[${index}].teamBScore 不是非负整数`);
    const map = game.map;
    if (allowNullMap) {
      if (map !== null && !isNonEmptyString(map)) problems.push(`${label}[${index}].map 必须是字符串或 null`);
    } else if (!isNonEmptyString(map)) {
      problems.push(`${label}[${index}].map 不能为空`);
    }
  });
}

function checkPair(value: unknown, label: string, problems: string[]): void {
  if (value === null) return;
  if (!isRecord(value)) {
    problems.push(`${label} 必须是对象或 null`);
    return;
  }
  if (!isSafeScore(value.a)) problems.push(`${label}.a 不是非负整数`);
  if (!isSafeScore(value.b)) problems.push(`${label}.b 不是非负整数`);
}

/**
 * 校验一条案例输入。
 * `requireImages` 由适配器声明——mock 适配器不读图片，示例集也不含图片文件，
 * 因此这里允许在自测场景下放宽；真实适配器必须要求图片存在。
 */
export function validateCaseInput(input: unknown, index: number, requireImages = true): string[] {
  const problems: string[] = [];
  const label = `cases[${index}]`;
  if (!isRecord(input)) return [`${label} 不是对象`];

  if (!isNonEmptyString(input.caseId)) problems.push(`${label}.caseId 缺失`);
  if (!isNonEmptyString(input.groupId)) problems.push(`${label}.groupId 缺失`);
  if (!SPLITS.includes(input.split as Split)) problems.push(`${label}.split 非法：${String(input.split)}`);
  if (!CASE_CATEGORIES.includes(input.category as CaseCategory)) {
    problems.push(`${label}.category 非法：${String(input.category)}`);
  }
  if (!isNonEmptyString(input.game)) problems.push(`${label}.game 缺失`);
  if (!isNonEmptyString(input.pageType)) problems.push(`${label}.pageType 缺失`);
  if (!BO_TYPES.includes(String(input.boType))) problems.push(`${label}.boType 非法：${String(input.boType)}`);

  if (!isRecord(input.teams)) {
    problems.push(`${label}.teams 缺失`);
  } else {
    if (!isNonEmptyString(input.teams.a)) problems.push(`${label}.teams.a 缺失`);
    if (!isNonEmptyString(input.teams.b)) problems.push(`${label}.teams.b 缺失`);
  }

  if (input.knownMaps !== undefined) {
    if (!Array.isArray(input.knownMaps)) problems.push(`${label}.knownMaps 必须是数组`);
    else if (input.knownMaps.some((m) => !isNonEmptyString(m))) problems.push(`${label}.knownMaps 含非法项`);
  }

  if (!Array.isArray(input.images)) {
    problems.push(`${label}.images 必须是数组`);
  } else {
    if (requireImages && input.images.length === 0) problems.push(`${label}.images 为空`);
    const orders = new Set<number>();
    input.images.forEach((image, imageIndex) => {
      if (!isRecord(image)) {
        problems.push(`${label}.images[${imageIndex}] 不是对象`);
        return;
      }
      if (!isNonEmptyString(image.file)) problems.push(`${label}.images[${imageIndex}].file 缺失`);
      if (typeof image.order !== "number" || !Number.isSafeInteger(image.order) || image.order < 1) {
        problems.push(`${label}.images[${imageIndex}].order 必须是 >=1 的整数`);
      } else if (orders.has(image.order)) {
        problems.push(`${label}.images[${imageIndex}].order 重复：${image.order}`);
      } else {
        orders.add(image.order);
      }
      if (image.synthetic !== undefined && typeof image.synthetic !== "boolean") {
        problems.push(`${label}.images[${imageIndex}].synthetic 必须是布尔值`);
      }
    });
  }

  if (!isRecord(input.privacy)) {
    problems.push(`${label}.privacy 缺失`);
  } else {
    if (typeof input.privacy.containsPii !== "boolean") problems.push(`${label}.privacy.containsPii 必须是布尔值`);
    if (!isNonEmptyString(input.privacy.redaction)) problems.push(`${label}.privacy.redaction 缺失`);
  }

  // 盲测护栏：输入里出现答案字段说明数据被污染
  for (const key of ANSWER_KEYS) {
    if (key in input) problems.push(`${label} 含疑似答案字段「${key}」——输入层不得携带答案`);
  }

  return problems;
}

export function validateManifest(input: unknown, requireImages = true): string[] {
  const problems: string[] = [];
  if (!isRecord(input)) return ["manifest 不是对象"];
  if (input.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    problems.push(`schemaVersion 应为 ${MANIFEST_SCHEMA_VERSION}，实际 ${String(input.schemaVersion)}`);
  }
  if (!isNonEmptyString(input.datasetId)) problems.push("datasetId 缺失");
  if (!Array.isArray(input.cases)) {
    problems.push("cases 不是数组");
    return problems;
  }
  if (input.cases.length === 0) problems.push("cases 为空");

  const seenIds = new Set<string>();
  input.cases.forEach((item, index) => {
    problems.push(...validateCaseInput(item, index, requireImages));
    if (isRecord(item) && isNonEmptyString(item.caseId)) {
      if (seenIds.has(item.caseId)) problems.push(`caseId 重复：${item.caseId}`);
      seenIds.add(item.caseId);
    }
  });
  return problems;
}

export function validateTruthFile(input: unknown, knownCaseIds?: Set<string>): string[] {
  const problems: string[] = [];
  if (!isRecord(input)) return ["truth 文件不是对象"];
  if (input.schemaVersion !== TRUTH_SCHEMA_VERSION) {
    problems.push(`truth.schemaVersion 应为 ${TRUTH_SCHEMA_VERSION}，实际 ${String(input.schemaVersion)}`);
  }
  if (!Array.isArray(input.cases)) return ["truth.cases 不是数组"];

  const seen = new Set<string>();
  input.cases.forEach((item, index) => {
    const label = `truth.cases[${index}]`;
    if (!isRecord(item)) {
      problems.push(`${label} 不是对象`);
      return;
    }
    const caseId = item.caseId;
    if (!isNonEmptyString(caseId)) {
      problems.push(`${label}.caseId 缺失`);
    } else {
      if (seen.has(caseId)) problems.push(`${label}.caseId 重复：${caseId}`);
      seen.add(caseId);
      if (knownCaseIds && !knownCaseIds.has(caseId)) problems.push(`${label}.caseId 不在 manifest 中：${caseId}`);
    }
    if (typeof item.shouldRefuse !== "boolean") problems.push(`${label}.shouldRefuse 必须是布尔值`);
    if (!Array.isArray(item.undeterminable)) problems.push(`${label}.undeterminable 必须是数组`);
    else if (item.undeterminable.some((x) => !isNonEmptyString(x))) problems.push(`${label}.undeterminable 含非法项`);
    if (typeof item.illegalBo !== "boolean") problems.push(`${label}.illegalBo 必须是布尔值`);
    checkPair(item.series, `${label}.series`, problems);
    if (item.winnerSide !== null && item.winnerSide !== "A" && item.winnerSide !== "B") {
      problems.push(`${label}.winnerSide 必须是 "A" / "B" / null`);
    }
    if (!Array.isArray(item.annotatedBy)) problems.push(`${label}.annotatedBy 必须是数组`);
    else if (item.annotatedBy.some((x) => !isNonEmptyString(x))) problems.push(`${label}.annotatedBy 含非法项`);
    checkGamesShape(item.games, `${label}.games`, problems, true);

    if (item.shouldRefuse === true && item.games && Array.isArray(item.games) && item.games.length > 0) {
      problems.push(`${label} 标为应拒答，却又给了逐局答案——标注自相矛盾`);
    }
  });

  return problems;
}

export function validateParsedOutput(input: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(input)) return ["parsed 不是对象"];
  checkPair(input.series, "parsed.series", problems);
  if (input.winnerSide !== null && input.winnerSide !== "A" && input.winnerSide !== "B") {
    problems.push(`parsed.winnerSide 必须是 "A" / "B" / null`);
  }
  checkGamesShape(input.games, "parsed.games", problems, true);
  return problems;
}

export function validatePrediction(input: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(input)) return ["prediction 不是对象"];
  if (!isNonEmptyString(input.caseId)) problems.push("prediction.caseId 缺失");
  if (!isNonEmptyString(input.armId)) problems.push("prediction.armId 缺失");
  if (typeof input.refused !== "boolean") problems.push("prediction.refused 必须是布尔值");
  if (typeof input.latencyMs !== "number" || Number.isNaN(input.latencyMs)) {
    problems.push("prediction.latencyMs 必须是数字");
  }
  if (input.parsed !== null) problems.push(...validateParsedOutput(input.parsed));
  if (!Array.isArray(input.validatorErrors)) problems.push("prediction.validatorErrors 必须是数组");
  return problems;
}

/**
 * 数据集是否达到工作包要求的最低样本量。
 * 只报缺口，不阻止运行——自测数据集必然不达标，但真实评测前应看这个结论。
 */
export function checkDatasetCoverage(cases: CaseInput[]): { byCategory: Record<string, number>; shortfall: string[] } {
  const byCategory: Record<string, number> = {};
  for (const category of CASE_CATEGORIES) byCategory[category] = 0;
  for (const item of cases) byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;

  const shortfall: string[] = [];
  for (const category of CASE_CATEGORIES) {
    const need = CATEGORY_MINIMUM[category];
    const have = byCategory[category] ?? 0;
    if (have < need) shortfall.push(`${category} 需 ${need} 例，现有 ${have} 例`);
  }
  const groups = new Set(cases.map((c) => c.groupId));
  if (groups.size !== cases.length) {
    shortfall.push(`案例数 ${cases.length}，分组数 ${groups.size}——同组案例会互相泄漏，需确认分组是否正确`);
  }
  return { byCategory, shortfall };
}

export type { BoType, Side, Split, CaseCategory, CaseInput, CaseTruth, CasePrediction, Manifest, TruthFile, ParsedOutput };
