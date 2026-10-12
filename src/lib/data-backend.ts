// =====================
// 「用哪个数据后端」的唯一判断处（2026-10-12）
//
// 为什么单独一份：这个判断原先在 **4 个**文件里各写了一份 ——
//   `data-store.ts`（数据层）、`asset-store.ts`（图片）、
//   `referee/evidence-store.ts`（裁判截图）、`rate-limit.ts`（限流计数）。
// 它们读的是同一个环境变量、回答的是同一个问题，**但行为并不一致**：
// `data-store` 那一份遇到无法识别的值时直接抛错（`不支持的数据后端：xxx`），
// 另外三份**没有这一分支** —— 于是同一个配错的值，有的模块当场报错、
// 有的静默退回 `file`。而「两套数据后端」正是本仓库最容易踩的坑（见 MEMORY.md）。
//
// → 收成一份，并统一取**最严的那一档**：无法识别的值一律当场抛错，
//   不让任何一个模块在「我到底在用哪个后端」这件事上偷偷降级。
//
// 守卫：`src/lib/data-backend.test.ts`（既逐档验行为，也断言全仓库只有这一处读 `DATA_BACKEND`）。
// =====================

import { isHostedRuntime } from "@/lib/deployment";

export type DataBackend = "file" | "supabase";

/** 读环境变量的那一处 —— 全仓库只有这里可以读 `DATA_BACKEND`。 */
function configuredBackend(): string | undefined {
  return process.env.DATA_BACKEND?.trim().toLowerCase();
}

/**
 * 决定当前用哪个后端。三档语义：
 *
 * 1. 显式 `file` / `supabase`（忽略大小写与首尾空白）→ 用它；
 * 2. **其它非空值 → 抛错**（不静默降级：写错一个字母就应当在启动时就暴露）；
 * 3. 未设置 → 托管环境必须显式设置（防止误写临时文件系统）；本地开发退回 `file`。
 */
export function resolveDataBackend(): DataBackend {
  const configured = configuredBackend();
  if (configured === "file" || configured === "supabase") return configured;
  if (configured) throw new Error(`不支持的数据后端：${configured}`);
  if (isHostedRuntime()) throw new Error("托管环境必须显式设置 DATA_BACKEND=supabase");
  return "file";
}
