// =====================
// AIE-02 评测框架：模型适配器
//
// 适配器只接收 CaseInput（**不含答案**），返回统一结构。换供应商只换适配器，
// 评分与门槛逻辑完全不动。
//
// 本文件不引入任何供应商 SDK，只用 fetch；`fetchImpl` 可注入，因此网络路径
// 也能在没有密钥、没有外网的情况下被测到。
//
// ★ 提示词与解析逻辑不在本文件，而是从生产模块 `@/lib/referee/result-vision` 引入。
//   理由：评测要回答的是「生产环境下准确率如何」。若两处各写一套提示词，
//   早晚会漂移，那时评测量到的就不是生产行为了。
//   依赖方向是 tools → src（已有先例：tools/seed-registration.ts）。
// =====================

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  callVisionModel,
  normalizeModelJson as normalizeFromProduction,
  PROMPT_VERSION,
  type VisionCallOptions,
} from "@/lib/referee/result-vision";
import { validateParsedOutput } from "./schema";
import type { CaseInput, ParsedOutput, TokenUsage } from "./types";

// 提示词是生产模块的唯一来源，这里只做转出，方便调用方与测试引用。
// 改提示词请改 @/lib/referee/result-vision，并同时升 PROMPT_VERSION。
export { PROMPT_VERSION };

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
        parsed: { series: null, winnerGroup: null, games: [] },
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
  /**
   * 是否让模型做「思考」（链式推理）。
   *
   * 为什么必须能关掉：部分模型（实测 deepseek-v4-flash-vision-exp）默认开启思考，
   * 而**思考 token 计入 max_tokens 预算**。读图这类任务的正式答案通常很短，
   * 但如果思考过程把预算吃光，接口依然返回 200，`content` 却是空字符串、
   * `finish_reason` 为 `length`——调用方拿不到任何数据，是静默失败。
   * 实测同一个模型同一个任务：开思考返回空 content，关思考返回完整结果。
   * （参照 deepseek-ai/DeepSeek-V3 issue #1610。）
   *
   * 关掉还有两个附带好处：更快、更省（思考 token 同样计费）。
   * 留空表示不发送该参数，用供应商的默认行为。
   */
  thinking?: "enabled" | "disabled";
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
// 解析与规范化复用生产实现，保证「评测口径 = 生产口径」。
// 这里只做类型转出：生产返回 RecognizedResult，评测用的是本目录的 ParsedOutput，
// 两者结构一致（series / winnerSide / games / groups），故可直接赋值。
export { extractJson } from "@/lib/referee/result-vision";

export function normalizeModelJson(value: unknown): { parsed: ParsedOutput | null; problems: string[] } {
  const result = normalizeFromProduction(value);
  return { parsed: result.parsed, problems: result.problems };
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
      // 评测框架从数据集目录读图，转成 data URL 后交给生产侧的调用函数，
      // 从而与生产走同一条请求构造、提示词与解析路径。
      const dataUrls = images.map((image) =>
        toDataUrl(path.join(ctx.datasetDir, "images", image.file), guessMime(image.file)),
      );

      const options: VisionCallOptions = {
        model: config.model,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        thinking: config.thinking,
        maxOutputTokens: config.maxOutputTokens,
        temperature: config.temperature,
        timeoutMs: ctx.timeoutMs,
        inputPerMillionUsd: config.inputPerMillionUsd,
        outputPerMillionUsd: config.outputPerMillionUsd,
      };

      const outcome = await callVisionModel(
        {
          caseId: input.caseId,
          teams: input.teams,
          boType: input.boType,
          game: input.game,
          pageType: input.pageType,
          knownMaps: input.knownMaps,
          squads: input.squads ?? null,
          note: input.note,
          images: dataUrls,
        },
        options,
        fetchImpl,
      );

      // 结构校验仍在评测侧做：它用的是本框架自己的 schema，
      // 与生产侧的「类型规范化」是两层不同的检查，不能互相替代。
      const problems = outcome.parsed ? validateParsedOutput(outcome.parsed) : (outcome.problems ?? []);

      return {
        refused: outcome.refused,
        refusedReason: outcome.refusedReason ?? null,
        parsed: outcome.parsed,
        parseError: outcome.parseError ?? null,
        validatorErrors: problems,
        raw: outcome.raw ?? null,
        usage: outcome.usage,
      };
    },
  };
}

/**
 * 从环境变量构造视觉适配器。变量名集中在这里，便于「文档提到环境变量时先 grep 实际读取的名字」。
 * 未设置 PROVIDER 时返回 null，由调用方明确报错。
 *
 * RESULT_VISION_THINKING 建议在 DeepSeek 上设为 disabled：该模型默认开思考，
 * 思考 token 计入 max_tokens，读图任务容易因此返回空的 content（静默失败）。
 */
export function visionAdapterFromEnv(env: NodeJS.ProcessEnv = process.env): VisionAdapter | null {
  const provider = env.RESULT_VISION_PROVIDER?.trim();
  if (!provider) return null;
  const thinkingRaw = env.RESULT_VISION_THINKING?.trim();
  const thinking = thinkingRaw === "enabled" || thinkingRaw === "disabled" ? thinkingRaw : undefined;
  return createVisionAdapter({
    provider,
    model: env.RESULT_VISION_MODEL?.trim() ?? "",
    baseUrl: env.RESULT_VISION_BASE_URL?.trim() ?? "",
    apiKey: env.RESULT_VISION_API_KEY?.trim() ?? "",
    thinking,
    maxOutputTokens: env.RESULT_VISION_MAX_TOKENS ? Number(env.RESULT_VISION_MAX_TOKENS) : undefined,
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
