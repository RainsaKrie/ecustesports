// =====================
// RPT-07a 裁判报分功能开关（对齐 ADR v1.0 第 8 节「决策 10」+ 工作包 02 §6 验收「服务端功能开关」）
//
// 语义（与 data-store 的「本地宽松 / 托管严格」模式保持一致）：
//   - 托管环境：默认关闭，仅显式 REFEREE_REPORTING_ENABLED=1 开启。裁判写操作不可用，管理员手工报分保持可用。
//   - 本地隔离环境：默认开启（便于 RPT-07 隔离回放），可显式 =0 关闭以验证「关闭时现有平台不受影响」。
//
// 开关只在「题述的写操作」处拦截（submit / upload），登录与「我的比赛」等读取不动。
// 开启二字永远由产品负责人确认，不由代码自行放开。
// =====================

import "server-only";

import { isHostedRuntime } from "@/lib/deployment";

/** 裁判报分写操作是否开放。未显式配置时回退：本地开 / 托管关。 */
export function refereeReportingEnabled(): boolean {
  const value = process.env.REFEREE_REPORTING_ENABLED?.trim();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return !isHostedRuntime();
}
