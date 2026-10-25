// =====================
// 阶段角色（2026-10-25，审查 P0-2）
//
// 问题：判断"这个阶段是不是小组赛/淘汰赛"有两套判据 ——
//   group-standings.ts 用白名单 `["小组赛","组内","GSL"]`
//   PublicSchedule.tsx 用子串 `phase.includes("淘汰")`
// 两套口径不同，而且**都靠阶段名**。用户把阶段改名为「分组赛」，分组积分就静默消失。
//
// 解法：用**角色**表达语义，名字只用来显示。
// 角色优先级：显式 `role` 字段 > 阶段类型 `type` > 名字兜底（兼容旧配置）。
// =====================

import type { StageConfig } from "./format-templates.ts";

/** 阶段在赛制里的角色。界面与门控只看它，不看名字。 */
export type StageRole = "qualifier" | "group" | "knockout";

/**
 * 从阶段配置推断角色。
 *
 * 为什么不直接读 `stage.role`：现有线上配置没有这个字段，
 * 强行要求会让旧赛事全部失效。所以按 **role → type → 名字** 三级回退，
 * 旧配置行为不变，新配置可以显式声明。
 */
export function roleOf(stage: Pick<StageConfig, "name" | "type"> & { role?: StageRole }): StageRole {
  if (stage.role) return stage.role;
  // 类型本身就是强语义，优先于名字
  if (stage.type === "gsl-groups" || stage.type === "single-elim-groups" || stage.type === "round-robin") {
    return "group";
  }
  if (stage.type === "double-elim") return "knockout";
  // `single-elim` 既可能是资格赛（并入型）也可能是淘汰赛，只能看名字 —— 这是最后的兜底
  return stage.name.includes("淘汰") || stage.name.includes("决赛") ? "knockout" : "qualifier";
}

/** 这个阶段是不是小组赛（含组内单败 / GSL / 单循环）。 */
export function isGroupStage(stage: Pick<StageConfig, "name" | "type"> & { role?: StageRole }): boolean {
  return roleOf(stage) === "group";
}

/**
 * 赛程里是否存在小组阶段（按阶段配置判断，不看比赛数据的 phase 字符串）。
 * 找不到配置时退回"比赛数据的 phase 名字里含小组类关键词"。
 */
export function hasGroupPhase(
  matches: { phase: string }[],
  stages: (Pick<StageConfig, "name" | "type"> & { role?: StageRole })[] | undefined,
): boolean {
  if (stages && stages.length > 0) return stages.some(isGroupStage);
  const HINTS = ["小组赛", "组内", "GSL"];
  return matches.some((m) => HINTS.some((hint) => m.phase.includes(hint)));
}
