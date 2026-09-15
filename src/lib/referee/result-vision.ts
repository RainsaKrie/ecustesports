// =====================
// 赛果截图识别（生产侧）
//
// 这一层负责「图片 → 结构化赛果」的全部逻辑：提示词、请求构造、结果解析。
//
// ★ 为什么放在 src 而不是 tools：评测框架（tools/ai-eval/result-vision）要复用这里的
//   提示词与解析逻辑。依赖方向是 tools → src（已有先例：tools/seed-registration.ts）。
//   两处各写一套提示词，早晚会漂移，那时评测结果就不能代表生产行为了。
//
// ★ 本文件刻意不引 "server-only"：评测框架要在 node 里直接跑它。
// =====================

/** 提示词版本号。改提示词必须同时改这个值，否则历史结果无法复现。 */
export const PROMPT_VERSION = "result-vision-prompt-v4";

/** 期望模型输出的结构。写进提示词，解析时也按它校验。 */
export const OUTPUT_CONTRACT = [
  "只输出一个 JSON 对象，不要任何解释文字或代码块标记。",
  "字段：",
  '- "refuse": 布尔。看不清、图不对、关键信息缺失时为 true。**宁可拒答也不要猜。**',
  '- "reason": 字符串，仅在 refuse 为 true 时给出原因。',
  '- "rows": 数组，结算表每一行一项，**按图上从上到下的顺序**，每项形如',
  '  {"index": 1, "name": "昵称原文", "side": "a" 或 "b"}。',
  "  **必须先逐行判定 side，再汇总出 groups；groups 只能由 rows 汇总，不得另行判断。**",
  '- "groups": {"a": [昵称...], "b": [昵称...]}，把结算表上的 10 个昵称按队伍分成两组，',
  "  每侧各 5 个。**必须与 rows 中同 side 的昵称完全一致。**",
  '- "series": {"a": 整数, "b": 整数}，系列赛大比分；不确定填 null。',
  '- "winnerSide": "A" 或 "B"，胜方；不确定填 null。',
  '- "games": 数组，每局 {"map": 地图名或 null, "teamAScore": 整数, "teamBScore": 整数}。',
  "A 指第一支队伍，B 指第二支。不允许编造图上没有的信息。",
].join("\n");

/**
 * 读图方法的提示。这些是「怎么看」，不涉及答案。
 *
 * 每一条都对应一个真实踩过的坑（2026-09-12 与 09-14 依据真实截图确定）：
 *   · 结算表按平均战斗评分降序**跨队排列**，两队成员交错，
 *     靠「前几行是哪队」会判错，必须看行底色。实测模型确实会犯这个错，
 *     所以 OUTPUT_CONTRACT 里要求「先逐行判 side 再汇总」——实测分组准确率 70%→90%。
 *   · **底色有三种不是两种**：除两队各自的颜色外，截图者自己那一行是另一种高亮色，
 *     容易误判成第三支队伍。那行属于截图者所在的队伍，不是独立队伍。
 *   · 图上没有局次标识。局次只能靠地图名反查给出的地图序列。
 *   · 图上没有队名，只有玩家昵称。
 *   · 大数字是**本局比分**（单局 13 分制），不是系列赛大比分。
 */
export const READING_GUIDE = [
  "读图方法（务必遵守）：",
  "1. 左上角有本局地图名，顶部中央是本局比分（形如「13 胜利 6」）。",
  "   这一行是「本方比分 / 结果 / 对方比分」：**左边那个数所属的队伍，就是截图者那一队**。",
  "   中间的字（胜利 / 败北）描述的是截图者那一队的输赢。",
  "   两个数字是**带颜色的**（一个偏绿、一个偏红），**数字的颜色与下方列表的行底色相对应**，",
  "   据此可以确定哪种底色是「左侧那个数」的队伍。",
  "2. 玩家列表每行有行底色，**底色代表队伍**。列表按个人评分从高到低排序，",
  "   两队成员会交错出现，所以**绝不能按「前几行是哪队」判断，必须看底色**。",
  "3. **底色有三种，不是两种**：除了两队各自的颜色，还会有一行是截图者「自己」的高亮色。",
  "   那一行属于截图者所在的队伍，**不是第三支队伍**，不要单独成组。",
  "   自检：分完应该是 5 人对 5 人；若出现 4 / 5 / 1，说明把自己那行单算了。",
  "4. 图上没有写这是第几局。请用左上角的地图名，去比对下面给出的地图序列，",
  "   找到它的位置（第几个就是第几局）。",
  "5. 图上没有队名，只有玩家昵称。若下面提供了双方队员昵称，用它判断哪一组对应 A 队、哪一组对应 B 队。",
  "6. 系列赛大比分 = 各局胜负数一数，不要直接读图上那个大数字（那是单局比分）。",
].join("\n");

export type Side = "A" | "B";

export interface RecognizedGame {
  map: string | null;
  teamAScore: number;
  teamBScore: number;
}

export interface RecognizedResult {
  series: { a: number; b: number } | null;
  winnerSide: Side | null;
  games: RecognizedGame[];
  /**
   * 模型把每个昵称归到哪一侧。
   *
   * 为什么必须有：结算表用行底色区分队伍，但**底色有三种不是两种**——
   * 除了两队各自的颜色，截图者自己那一行是另一种高亮色。
   * 只输出「谁赢了」会掩盖「分错了队」这类错误：读对比分但把队分反，结果同样是错的，
   * 但两者的修法完全不同。
   */
  groups: { a: string[]; b: string[] } | null;
}

export interface VisionUsage {
  inputTokens?: number;
  outputTokens?: number;
  /**
   * 其中用于「思考」的 token 数。
   * 单独记录的原因：思考 token 计入 outputTokens 也就是 max_tokens 预算，
   * 是「接口 200 但 content 为空」这种静默失败的根因。
   */
  reasoningTokens?: number;
  images?: number;
  costUsd?: number;
}

/** 一次识别请求的输入。图片以 data URL 形式传入，便于复用于评测框架。 */
export interface VisionRequestInput {
  caseId: string;
  teams: { a: string; b: string };
  boType: string;
  game: string;
  pageType: string;
  /** BP 已确定的地图序列（按局序）。空数组表示未做 BP。 */
  knownMaps?: string[];
  /** 双方登场队员昵称（已去掉 # 标签）。null 表示拿不到名单。 */
  squads?: { a: string[]; b: string[] } | null;
  note?: string;
  /** 图片的 data URL 列表，按局序 */
  images: string[];
}

export interface VisionCallOptions {
  model: string;
  baseUrl: string;
  apiKey: string;
  /**
   * 是否让模型做「思考」（链式推理）。
   *
   * 为什么必须能关掉：部分模型默认开启思考，而**思考 token 计入 max_tokens 预算**。
   * 读图这类任务的正式答案通常很短，但如果思考过程把预算吃光，接口依然返回 200，
   * `content` 却是空字符串、`finish_reason` 为 `length`——调用方拿不到任何数据，是静默失败。
   * 实测同一模型同一任务：开思考返回空 content，关思考返回完整结果。
   * （参照 deepseek-ai/DeepSeek-V3 issue #1610。）
   */
  thinking?: "enabled" | "disabled";
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs: number;
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
}

export interface VisionCallOutcome {
  refused: boolean;
  refusedReason?: string | null;
  parsed: RecognizedResult | null;
  parseError?: string | null;
  /** 结构不合规的具体问题；非空表示模型输出格式有问题 */
  problems?: string[];
  raw?: string | null;
  usage: VisionUsage;
}

/** 组装给模型的文字部分。 */
export function buildVisionPrompt(input: VisionRequestInput): string {
  return [
    `比赛：${input.teams.a}（A）对 ${input.teams.b}（B）`,
    `赛制：${input.boType}`,
    `游戏：${input.game}　页面：${input.pageType}`,
    input.knownMaps?.length
      ? [
          "BP 已确定地图（按局序，用来反查截图的局次）：",
          ...input.knownMaps.map((map, index) => `  第 ${index + 1} 局：${map}`),
        ].join("\n")
      : "BP 地图未知，无法据此判断局次",
    input.squads
      ? [
          "双方队员昵称（已去掉 # 标签，与截图上的显示一致）：",
          `  A 队 ${input.teams.a}：${input.squads.a.join("、")}`,
          `  B 队 ${input.teams.b}：${input.squads.b.join("、")}`,
        ].join("\n")
      : "未提供双方队员昵称，无法确定底色对应哪支队",
    input.note ? `作业说明：${input.note}` : "",
    "",
    "请从下面这些截图里读出赛果。",
    READING_GUIDE,
    OUTPUT_CONTRACT,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 从模型返回的文本里取出 JSON。取不到就返回 null，由上层记为解析错误。 */
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return { ok: false, error: "输出中找不到 JSON 对象" };
  try {
    return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "JSON 解析失败" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeGroups(value: unknown): RecognizedResult["groups"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const pick = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
      : [];
  return { a: pick(rec.a), b: pick(rec.b) };
}

/**
 * 把模型输出的 JSON 规范成 RecognizedResult。结构不对时如实报错，不做修补。
 *
 * ⚠️ 这里**只做类型层面的规范化**，不做业务合理性判断（例如「分组是不是 5 人对 5 人」）。
 * 理由：评测框架把「结构不合规」与「内容判错」分成两类失败，用不同的分母统计。
 * 如果把业务判断混进来，「分组人数不对」会被记成结构错误，掩盖真实的准确率问题。
 * 业务层面的检查放在 checkGroupSanity，由调用方按需使用。
 */
export function normalizeModelJson(value: unknown): { parsed: RecognizedResult | null; problems: string[] } {
  if (!isRecord(value)) return { parsed: null, problems: ["模型输出不是 JSON 对象"] };
  // 明确拒答时不产出结果——这是「宁可拒答也不要猜」的落点
  if (value.refuse === true) return { parsed: null, problems: [] };
  const problems: string[] = [];

  const seriesRaw = value.series;
  let series: RecognizedResult["series"] = null;
  if (seriesRaw !== null && seriesRaw !== undefined) {
    if (isRecord(seriesRaw)) {
      series = { a: Number(seriesRaw.a), b: Number(seriesRaw.b) };
      if (!Number.isFinite(series.a) || !Number.isFinite(series.b)) {
        problems.push("series 不是两个数字");
        series = null;
      }
    } else {
      problems.push("series 必须是对象或 null");
    }
  }

  const winnerRaw = value.winnerSide;
  let winnerSide: RecognizedResult["winnerSide"] = null;
  if (winnerRaw !== null && winnerRaw !== undefined) {
    if (winnerRaw === "A" || winnerRaw === "B") winnerSide = winnerRaw;
    else problems.push(`winnerSide 必须是 "A" / "B" / null，实际是 ${JSON.stringify(winnerRaw)}`);
  }

  const gamesRaw = value.games;
  const games: RecognizedGame[] = [];
  if (gamesRaw !== null && gamesRaw !== undefined) {
    if (Array.isArray(gamesRaw)) {
      for (const g of gamesRaw) {
        if (!isRecord(g)) {
          problems.push("games 含非对象项");
          continue;
        }
        const a = Number(g.teamAScore);
        const b = Number(g.teamBScore);
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
          problems.push("games 含非数字比分");
          continue;
        }
        games.push({ map: typeof g.map === "string" && g.map.trim() ? g.map.trim() : null, teamAScore: a, teamBScore: b });
      }
    } else {
      problems.push("games 必须是数组");
    }
  }

  const groups = normalizeGroups(value.groups);
  if (groups) {
    const aSet = new Set(groups.a);
    const dup = groups.b.filter((n) => aSet.has(n));
    if (dup.length > 0) problems.push(`同一昵称出现在两侧：${dup.join("、")}`);
  }

  return { parsed: { series, winnerSide, games, groups }, problems };
}

/** 人数自检的阈值：标准对局是 5 人对 5 人。 */
export const EXPECTED_SIDE_SIZE = 5;

/**
 * 业务层面的分组自检，返回需要提示给人的问题清单。
 *
 * 与 normalizeModelJson 的分工：这里判断的是「结果可不可信」，
 * 而不是「结构合不合规」。典型用途是裁判界面上的一句提醒。
 *
 * 最重要的一条是人数：结算表行底色有**三种**（两队 + 截图者自己那行），
 * 若把「自己」那行当成第三支队伍，就会出现 4 / 5 / 1 这类分布，比分会填反。
 * 判据很简单也很硬：分完必须是 5 人对 5 人。
 */
export function checkGroupSanity(
  groups: RecognizedResult["groups"],
  options: { expectedSideSize?: number } = {},
): string[] {
  if (!groups) return ["模型没有给出行归属，无法核对哪一组是哪支队"];
  const expected = options.expectedSideSize ?? EXPECTED_SIDE_SIZE;
  const issues: string[] = [];
  if (groups.a.length !== expected || groups.b.length !== expected) {
    issues.push(
      `分组不是 ${expected} 人对 ${expected} 人（A ${groups.a.length} 人、B ${groups.b.length} 人）——` +
        "可能是把截图者「自己」那一行当成了第三支队伍，请核对",
    );
  }
  const aSet = new Set(groups.a);
  const dup = groups.b.filter((n) => aSet.has(n));
  if (dup.length > 0) issues.push(`同一昵称出现在两侧：${dup.join("、")}`);
  return issues;
}

/** 调一次视觉模型。网络错误以异常抛出，由调用方决定是否重试。 */
export async function callVisionModel(
  input: VisionRequestInput,
  options: VisionCallOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<VisionCallOutcome> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: buildVisionPrompt(input) }];
  for (const url of input.images) {
    content.push({ type: "image_url", image_url: { url } });
  }

  const maxTokens = options.maxOutputTokens ?? 4096;
  const response = await fetchImpl(`${options.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
    body: JSON.stringify({
      model: options.model,
      temperature: options.temperature ?? 0,
      // 默认给足预算：思考型模型的思考 token 也算在这里，给少了会返回空结果
      max_tokens: maxTokens,
      ...(options.thinking ? { thinking: { type: options.thinking } } : {}),
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(options.timeoutMs),
  });

  const baseUsage: VisionUsage = { images: input.images.length };
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // 不回显响应体全文，避免把供应商侧可能的回显内容带进日志
    return {
      refused: false,
      parsed: null,
      parseError: `供应商返回 HTTP ${response.status}（${detail.slice(0, 120)}）`,
      usage: baseUsage,
    };
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  const choice = body.choices?.[0];
  const text = choice?.message?.content ?? "";
  const usage: VisionUsage = {
    ...baseUsage,
    inputTokens: body.usage?.prompt_tokens,
    outputTokens: body.usage?.completion_tokens,
    reasoningTokens: body.usage?.completion_tokens_details?.reasoning_tokens,
  };
  if (options.inputPerMillionUsd !== undefined && options.outputPerMillionUsd !== undefined) {
    usage.costUsd =
      ((usage.inputTokens ?? 0) / 1_000_000) * options.inputPerMillionUsd
      + ((usage.outputTokens ?? 0) / 1_000_000) * options.outputPerMillionUsd;
  }

  // 输出被截断要单独报出来，不能退化成一句含糊的「解析失败」。
  // 最常见的原因是思考 token 把 max_tokens 预算吃光了——此时 content 为空字符串，
  // 若只记「找不到 JSON 对象」，排查时会误以为是提示词或格式问题。
  if (choice?.finish_reason === "length") {
    const reasoning = usage.reasoningTokens ?? 0;
    return {
      refused: false,
      parsed: null,
      parseError:
        `模型输出被截断（finish_reason=length，预算 ${maxTokens} tokens，其中思考占用 ${reasoning}）` +
        (reasoning >= maxTokens * 0.9
          ? "。思考把预算吃光了——需要改用 thinking:\"disabled\"，或调大 maxOutputTokens。"
          : "。需要调大 maxOutputTokens。"),
      raw: text,
      usage,
    };
  }

  const extracted = extractJson(text);
  if (!extracted.ok) {
    return { refused: false, parsed: null, parseError: extracted.error, raw: text, usage };
  }
  const object = extracted.value as Record<string, unknown>;
  if (object.refuse === true) {
    return {
      refused: true,
      refusedReason: typeof object.reason === "string" ? object.reason : null,
      parsed: null,
      raw: text,
      usage,
    };
  }
  const normalized = normalizeModelJson(object);
  return {
    refused: false,
    parsed: normalized.parsed,
    problems: normalized.problems,
    raw: text,
    usage,
  };
}

/** 从 data URL 里取出原始 MIME 与字节，供上传校验复用。 */
export function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

/** 把字节转成 data URL。生产从上传的 File 读，评测从数据集目录读。 */
export function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/**
 * 从环境变量读取视觉模型配置。变量名集中在这里，
 * 便于「文档提到环境变量时先 grep 实际读取的名字再采信」。
 *
 * 未配置 PROVIDER 或缺少 API_KEY 时返回 null——由调用方明确降级，
 * 不做「静默改用别的模型」这种事。
 */
export function visionOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): VisionCallOptions | null {
  const model = env.RESULT_VISION_MODEL?.trim();
  const baseUrl = env.RESULT_VISION_BASE_URL?.trim();
  const apiKey = env.RESULT_VISION_API_KEY?.trim();
  if (!model || !baseUrl || !apiKey) return null;

  const thinkingRaw = env.RESULT_VISION_THINKING?.trim();
  const thinking = thinkingRaw === "enabled" || thinkingRaw === "disabled" ? thinkingRaw : undefined;
  const maxTokens = env.RESULT_VISION_MAX_TOKENS ? Number(env.RESULT_VISION_MAX_TOKENS) : undefined;
  const timeout = env.RESULT_VISION_TIMEOUT_MS ? Number(env.RESULT_VISION_TIMEOUT_MS) : undefined;

  return {
    model,
    baseUrl,
    apiKey,
    thinking,
    maxOutputTokens: Number.isFinite(maxTokens) ? maxTokens : undefined,
    timeoutMs: Number.isFinite(timeout) && timeout! > 0 ? timeout! : 60_000,
    inputPerMillionUsd: env.RESULT_VISION_INPUT_PRICE ? Number(env.RESULT_VISION_INPUT_PRICE) : undefined,
    outputPerMillionUsd: env.RESULT_VISION_OUTPUT_PRICE ? Number(env.RESULT_VISION_OUTPUT_PRICE) : undefined,
  };
}

/** 未配置时给调用方的说明。用于在界面上如实告知「识别不可用」而不是静默失败。 */
export function visionConfigHint(env: NodeJS.ProcessEnv = process.env): string {
  const missing = [
    ["RESULT_VISION_MODEL", env.RESULT_VISION_MODEL],
    ["RESULT_VISION_BASE_URL", env.RESULT_VISION_BASE_URL],
    ["RESULT_VISION_API_KEY", env.RESULT_VISION_API_KEY],
  ]
    .filter(([, v]) => !v || String(v).trim() === "")
    .map(([k]) => k);
  return missing.length > 0
    ? `识别功能未配置（缺少 ${missing.join(" / ")}）`
    : "识别功能未配置";
}
