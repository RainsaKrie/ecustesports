// =====================
// 身份匹配用的昵称键（2026-10-19 从 `identity-match.ts` 抽出）
//
// 这两个函数是纯字符串处理，与"匹配算法"没有耦合 —— 抽出来之后 `identity-match.ts`
// 回到 400 行以下（架构守卫的硬线），同时匹配逻辑本身一行未改。
//
// `identity-match.ts` 会 re-export `normalizeGameId`，所以调用方不需要改 import。
// =====================

/** 把游戏 ID 归一成"昵称"部分：去掉井号后缀、零宽字符，统一井号变体 */
export function normalizeGameId(raw: string): string {
  if (typeof raw !== "string") return "";
  // 常见的井号变体，以及零宽字符
  const cleaned = raw
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[＃﹟]/g, "#")
    .trim();
  const hash = cleaned.lastIndexOf("#");
  const name = hash > 0 ? cleaned.slice(0, hash) : cleaned;
  return name.trim();
}

/** 比较用的键：忽略大小写与内部空白差异 */
export function matchKey(name: string): string {
  return normalizeGameId(name).toLowerCase().replace(/\s+/g, "");
}
