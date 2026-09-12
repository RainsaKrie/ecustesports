// =====================
// AIE-02 评测框架：模型适配器
//
// 适配器只接收 CaseInput（**不含答案**），返回统一结构。换供应商只换适配器，
// 评分与门槛逻辑完全不动。
//
// 本文件不引入任何供应商 SDK，只用 fetch；`fetchImpl` 可注入，因此网络路径
// 也能在没有密钥、没有外网的情况下被测到。
// =====================

import { readFileSync } from "node:fs";
import path from "node:path";
import { validateParsedOutput } from "./schema";
import type { CaseInput, ParsedOutput, TokenUsage } from "./types";

export interface AdapterRunContext {
  datasetDir: string;
  timeoutMs: number;
}

export interface AdapterResult {
  refused: boolean;
  refusedReason?: string | null;
  parsed: ParsedOutput | null;
  parseError?: string | null;
  validatorErrors?: string[];
  raw?: string | null;
  usage?: TokenUsage;
}

export interface VisionAdapter {
  id: string;
  provider: string;
  model: string;
  promptVersion: string;
  /** false 表示对照组：不使用视觉模型 */
  usesVision: boolean;
  /** true 时运行器会先确认图片文件存在，缺失即失败（fail closed） */
  requiresImages: boolean;
  isConfigured(): { ok: boolean; reason?: string };
  run(input: CaseInput, ctx: AdapterRunContext): Promise<AdapterResult>;
}

/** 提示词版本号。改提示词必须同时改这个值，否则历史结果无法复现。 */
export const PROMPT_VERSION = "result-vision-prompt-v1";

/**
 * 期望模型输出的 JSON 结构说明。写进提示词，也是解析时的唯一依据。
 * 明确要求「不确定就拒答」——这是 Gate 里「不得猜测」的前置条件。
 */
export const OUTPUT_CONTRACT = [
  "只输出一个 JSON 对象，不要任何解释文字或代码块标记。",
  "字段：",
  '- "refuse": 布尔。看不清、图不对、关键信息缺失时为 true。**宁可拒答也不要猜。**',
  '- "reason": 字符串，仅在 refuse 为 true 时给出原因。',
  '- "series": {"a": 整数, "b": 整数}，系列赛大比分；不确定填 null。',
  '- "winnerSide": "A" 或 "B"，胜方；不确定填 null。',
  '- "games": 数组，每局 {"map": 地图名或 null, "teamAScore": 整数, "teamBScore": 整数}。',
  "A 指第一支队伍，B 指第二支。不允许编造图上没有的信息。",
].join("\n");

// ---------------------------------------------------------------
// mock 适配器：无密钥、无外网，用于框架自测
// ---------------------------------------------------------------

interface MockEntry {
  refused?: boolean;
  refusedReason?: string;
  parsed?: ParsedOutput;
  parseError?: string;
  validatorErrors?: string[];
  /** 人为延迟，用于验证超时处理 */
  delayMs?: number;
}

function readMockTable(datasetDir: string): Record<string, MockEntry> {
  const file = path.join(datasetDir, "mock.json");
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, MockEntry>;
    }
    return {};
  } catch {
    return {};
  }
}

/** mock 输出从数据集目录的 mock.json 读取，目录由 run 上下文提供，构造时不需要参数。 */
export function createMockAdapter(): VisionAdapter {
  return {
    id: "mock",
    provider: "mock",
    model: "mock-deterministic",
    promptVersion: PROMPT_VERSION,
    usesVision: false,
    requiresImages: false,
    isConfigured: () => ({ ok: true }),
    async run(input, ctx) {
      const table = readMockTable(ctx.datasetDir);
      const entry = table[input.caseId];
      if (!entry) {
        return { refused: false, parsed: null, parseError: `mock 未提供案例 ${input.caseId} 的输出` };
      }
      if (entry.delayMs) await new Promise((resolve) => setTimeout(resolve, entry.delayMs));
      if (entry.validatorErrors) {
        return {
          refused: false,
          parsed: null,
          validatorErrors: entry.validatorErrors,
          usage: { images: input.images.length },
        };
      }
      if (entry.parseError) {
        return { refused: false, parsed: null, parseError: entry.parseError, usage: { images: input.images.length } };
      }
      return {
        refused: entry.refused ?? false,
        refusedReason: entry.refusedReason ?? null,
        parsed: entry.parsed ?? null,
        usage: { images: input.images.length, inputTokens: 1200, outputTokens: 180 },
      };
    },
  };
}

// ---------------------------------------------------------------
// 对照组：不使用视觉模型的固定表单
//
// 代表「根本不用 AI」这一臂：没有任何预填，人按固定表单逐项填。
// 它的字段准确率由人工基线提供，不由本框架测量——这里只如实报告
// 「自动预填为 0」，从而让「用 AI 比不用 AI 好多少」有分母。
// ---------------------------------------------------------------

export function createFormBaselineAdapter(): VisionAdapter {
  return {
    id: "form-baseline",
    provider: "none",
    model: "human-fixed-form",
    promptVersion: "n/a",
    usesVision: false,
    requiresImages: false,
    isConfigured: () => ({ ok: true }),
    async run(input) {
      return {
        refused: false,
        parsed: { series: null, winnerSide: null, games: [] },
        usage: { images: input.images.length },
        raw: null,
      };
    },
  };
}

// ---------------------------------------------------------------
// OpenAI 兼容的视觉模型适配器
//
// 走 /chat/completions 的通用协议，因此可接多家供应商。配置全部来自参数或环境变量，
// 代码里不含密钥。未配置时 isConfigured() 返回 false，运行器会拒绝启动而不是静默降级。
// ---------------------------------------------------------------

export interface VisionAdapterConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** 价格表，用于估算成本；缺省则不计成本 */
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
}

export interface VisionAdapterDeps {
  /** 注入 fetch 以便在测试中覆盖网络路径 */
  fetchImpl?: typeof fetch;
}

function toDataUrl(filePath: string, mime: string): string {
  const bytes = readFileSync(filePath);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function guessMime(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
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

/** 把模型输出的 JSON 规范成 ParsedOutput。结构不对时如实报错，不做修补。 */
export function normalizeModelJson(value: unknown): { parsed: ParsedOutput | null; problems: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { parsed: null, problems: ["模型输出不是 JSON 对象"] };
  }
  const record = value as Record<string, unknown>;
  if (record.refuse === true) {
    return { parsed: null, problems: [] };
  }
  const parsed: ParsedOutput = {
    series: (record.series as ParsedOutput["series"]) ?? null,
    winnerSide: (record.winnerSide as ParsedOutput["winnerSide"]) ?? null,
    games: Array.isArray(record.games)
      ? (record.games as ParsedOutput["games"]).map((g) => ({
          map: typeof g?.map === "string" ? g.map : null,
          teamAScore: Number(g?.teamAScore),
          teamBScore: Number(g?.teamBScore),
        }))
      : [],
  };
  return { parsed, problems: validateParsedOutput(parsed) };
}

export function createVisionAdapter(
  config: VisionAdapterConfig,
  deps: VisionAdapterDeps = {},
): VisionAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    id: `${config.provider}:${config.model}`,
    provider: config.provider,
    model: config.model,
    promptVersion: PROMPT_VERSION,
    usesVision: true,
    requiresImages: true,
    isConfigured: () => {
      if (!config.baseUrl) return { ok: false, reason: "缺少 baseUrl" };
      if (!config.apiKey) return { ok: false, reason: "缺少 apiKey（不写入代码，只从环境变量读取）" };
      if (!config.model) return { ok: false, reason: "缺少 model" };
      return { ok: true };
    },
    async run(input, ctx) {
      const images = [...input.images].sort((a, b) => a.order - b.order);
      const content: Array<Record<string, unknown>> = [
        {
          type: "text",
          text: [
            `比赛：${input.teams.a}（A）对 ${input.teams.b}（B）`,
            `赛制：${input.boType}`,
            `游戏：${input.game}　页面：${input.pageType}`,
            input.knownMaps?.length ? `BP 已确定地图：${input.knownMaps.join("、")}` : "BP 地图未知",
            input.note ? `作业说明：${input.note}` : "",
            "",
            "请从下面这些截图里读出赛果。",
            OUTPUT_CONTRACT,
          ].filter(Boolean).join("\n"),
        },
      ];
      for (const image of images) {
        const filePath = path.join(ctx.datasetDir, "images", image.file);
        content.push({ type: "image_url", image_url: { url: toDataUrl(filePath, guessMime(image.file)) } });
      }

      const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          temperature: config.temperature ?? 0,
          max_tokens: config.maxOutputTokens ?? 1024,
          messages: [{ role: "user", content }],
        }),
        signal: AbortSignal.timeout(ctx.timeoutMs),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        // 不回显响应体全文，避免把供应商侧可能的回显内容带进日志
        return {
          refused: false,
          parsed: null,
          parseError: `供应商返回 HTTP ${response.status}（${detail.slice(0, 80)}）`,
          usage: { images: images.length },
        };
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = body.choices?.[0]?.message?.content ?? "";
      const usage: TokenUsage = {
        images: images.length,
        inputTokens: body.usage?.prompt_tokens,
        outputTokens: body.usage?.completion_tokens,
      };
      if (config.inputPerMillionUsd !== undefined && config.outputPerMillionUsd !== undefined) {
        usage.costUsd =
          ((usage.inputTokens ?? 0) / 1_000_000) * config.inputPerMillionUsd
          + ((usage.outputTokens ?? 0) / 1_000_000) * config.outputPerMillionUsd;
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
        validatorErrors: normalized.problems,
        raw: text,
        usage,
      };
    },
  };
}

/**
 * 从环境变量构造视觉适配器。变量名集中在这里，便于「文档提到环境变量时先 grep 实际读取的名字」。
 * 未设置 PROVIDER 时返回 null，由调用方明确报错。
 */
export function visionAdapterFromEnv(env: NodeJS.ProcessEnv = process.env): VisionAdapter | null {
  const provider = env.RESULT_VISION_PROVIDER?.trim();
  if (!provider) return null;
  return createVisionAdapter({
    provider,
    model: env.RESULT_VISION_MODEL?.trim() ?? "",
    baseUrl: env.RESULT_VISION_BASE_URL?.trim() ?? "",
    apiKey: env.RESULT_VISION_API_KEY?.trim() ?? "",
    inputPerMillionUsd: env.RESULT_VISION_INPUT_PRICE ? Number(env.RESULT_VISION_INPUT_PRICE) : undefined,
    outputPerMillionUsd: env.RESULT_VISION_OUTPUT_PRICE ? Number(env.RESULT_VISION_OUTPUT_PRICE) : undefined,
  });
}

export function resolveAdapter(armId: string): VisionAdapter {
  if (armId === "mock") return createMockAdapter();
  if (armId === "form-baseline") return createFormBaselineAdapter();
  if (armId === "vision") {
    const adapter = visionAdapterFromEnv();
    if (!adapter) {
      throw new Error(
        "未配置视觉适配器。需要环境变量 RESULT_VISION_PROVIDER / RESULT_VISION_MODEL / RESULT_VISION_BASE_URL / RESULT_VISION_API_KEY。",
      );
    }
    return adapter;
  }
  throw new Error(`未知的 armId：${armId}（可选 mock / form-baseline / vision）`);
}
