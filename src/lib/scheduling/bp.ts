// =====================
// BP 核心纯函数（可测试）
// 顺序生成（VCT 标准，按地图池大小通用化）+ 结果推导
// 对齐 docs/04-产品定义/BP系统设计_v0.1.md 第 3 节
// =====================

import type { BOType } from "./rule-engine";

/** 操作侧（以先手方视角） */
export type BPSide = "first" | "second";

export interface BPStep {
  side: BPSide;
  action: "ban" | "pick";
}

export interface BPAction {
  mapId: string;
  side: BPSide;
  action: "ban" | "pick";
  operatorRole: "team" | "referee";
  at: string; // ISO 时间
}

/** 各 BO 需要的最终地图数 */
const MAPS_NEEDED: Record<BOType, number> = { BO1: 1, BO3: 3, BO5: 5 };

/** 各 BO 的 Pick 次数（BO3 选 2 剩 1 决胜；BO5 选满；BO1 无 Pick） */
const PICKS: Record<BOType, number> = { BO1: 0, BO3: 2, BO5: 5 };

/**
 * 按 BO 类型与地图池大小生成 BP 步骤：
 * - Ban 阶段：双方交替 Ban（先手方开始），直到剩余地图数 = 该 BO 需要数
 * - Pick 阶段：双方交替 Pick（先手方开始）
 * 地图池不足时返回空数组（该 BO 无法进行 BP）。
 */
export function buildBPOrder(boType: BOType, poolSize: number): BPStep[] {
  if (poolSize < MAPS_NEEDED[boType]) return [];
  const steps: BPStep[] = [];
  let remaining = poolSize;
  while (remaining > MAPS_NEEDED[boType]) {
    steps.push({ side: steps.length % 2 === 0 ? "first" : "second", action: "ban" });
    remaining--;
  }
  for (let i = 0; i < PICKS[boType]; i++) {
    steps.push({ side: steps.length % 2 === 0 ? "first" : "second", action: "pick" });
  }
  return steps;
}

/** 剩余可选地图（未 Ban 未 Pick） */
export function remainingMaps(pool: string[], actions: BPAction[]): string[] {
  const used = new Set(actions.map((a) => a.mapId));
  return pool.filter((m) => !used.has(m));
}

/** 当前步骤（steps 全部完成返回 null） */
export function currentStep(order: BPStep[], actions: BPAction[]): BPStep | null {
  return order[actions.length] ?? null;
}

/** 是否完成全部步骤 */
export function isBPComplete(order: BPStep[], actions: BPAction[]): boolean {
  return actions.length >= order.length && order.length > 0;
}

/**
 * 由操作记录推导最终比赛地图列表（按比赛局序）：
 * - BO1：剩余唯一图
 * - BO3：两张 Pick 图 + 剩余决胜图
 * - BO5：五张 Pick 图
 */
export function bpResultMaps(
  pool: string[],
  boType: BOType,
  actions: BPAction[],
): string[] {
  const picked = actions.filter((a) => a.action === "pick").map((a) => a.mapId);
  const rest = remainingMaps(pool, actions);
  if (boType === "BO1") return rest.slice(0, 1);
  if (boType === "BO3") return [...picked.slice(0, 2), ...rest.slice(0, 1)];
  return picked.slice(0, MAPS_NEEDED.BO5);
}
