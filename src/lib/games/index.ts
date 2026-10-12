// =====================
// 游戏配置层 · 取值入口
//
// 消费者一律从这里取游戏数据，不要各自维护一份 ——
// 这正是本层存在的理由：段位阶梯曾经在 3 个文件里各写一遍。
//
// ★ 关于「哪一场赛事用哪款游戏」：
//   `getGameConfig(gameId)` 已经支持按赛事配置的 `game` 字段解析
//   （含中文显示名等别名）。**但调用点目前还没把它接上** ——
//   默认款的取值与统一之前完全一致，所以现在的行为没有任何变化。
//   接上只是「在已经拿到赛事配置的那几处把 `event.game` 传进来」，
//   属于下一步，见 `getGameConfig` 的注释。
// =====================

import { VALORANT_GAME } from "./valorant";
import type { GameConfig, GameMap } from "./types";

export type { GameConfig, GameMap, GameRosterLimits } from "./types";
export { VALORANT_GAME } from "./valorant";

/** 已登记的游戏配置。加一款游戏 = 这里加一条 + 在 `games/` 下加一份配置。 */
export const GAME_CONFIGS: Record<string, GameConfig> = {
  [VALORANT_GAME.id]: VALORANT_GAME,
};

/** 默认游戏：没传、传空、或传了未登记的值时用它。 */
export const DEFAULT_GAME_ID = VALORANT_GAME.id;

/**
 * 取某款游戏的配置。
 *
 * `gameId` 通常就是赛事配置里的 `game` 字段。解析顺序：`id` → `aliases`（忽略大小写），
 * 都匹配不上就退回默认款。
 *
 * ★ 为什么**不抛错**：`game` 是自由文本，一个拼错的名字不该让整场赛事的报名页打不开。
 *   代价是「填错游戏」会静默按默认款处理 —— 所以新增游戏时务必把别名填全。
 *
 * ★ 调用点现状：目前多数调用点不传参（取默认款，与统一之前行为一致）。
 *   要把赛事级的 `game` 真正接上，需要在**已经持有赛事配置**的那几处传进来：
 *   报名与选手接口、报名页 / 选手页、地图池设置、识图。见审计文档 A3 的第二步。
 */
export function getGameConfig(gameId?: string | null): GameConfig {
  const key = (gameId ?? "").trim();
  if (key) {
    const lower = key.toLowerCase();
    for (const game of Object.values(GAME_CONFIGS)) {
      if (game.id === key || game.aliases.includes(key)) return game;
      if (game.id.toLowerCase() === lower || game.aliases.some((a) => a.toLowerCase() === lower)) {
        return game;
      }
    }
  }
  return GAME_CONFIGS[DEFAULT_GAME_ID];
}

/** 供选择器使用的最小列表（id 用于存值，displayName 用于展示）。 */
export function listGames(): Array<{ id: string; displayName: string }> {
  return Object.values(GAME_CONFIGS).map((game) => ({ id: game.id, displayName: game.displayName }));
}

/**
 * 段位 → 数值（低到高 1..n）。
 * 未知段位返回 **0**，调用方据此判定「没填段位 / 段位不合法」。
 */
export function rankValueOf(rank: string, game: GameConfig = getGameConfig()): number {
  const index = game.ranks.indexOf(rank);
  return index < 0 ? 0 : index + 1;
}

/** 该段位是否属于这款游戏（报名与改资料的校验用）。 */
export function isKnownRank(rank: string, game: GameConfig = getGameConfig()): boolean {
  return game.ranks.includes(rank);
}

/**
 * 队伍规模上限：按角色取首发 / 替补 / 教练的上限。
 * 集中在这里，免得三处各写一次三元表达式（原来 `registration-ops` 与
 * `registration-admin-ops` 就各写了一份）。
 */
export function rosterLimitOf(role: "首发" | "替补" | "教练", game: GameConfig = getGameConfig()): number {
  if (role === "首发") return game.roster.starters;
  if (role === "替补") return game.roster.maxSubstitutes;
  return game.roster.maxCoaches;
}

/**
 * 规范化擅长位置入参：去空白、丢掉这款游戏里没有的位置、按给定顺序去重。
 *
 * 收进本层的理由很直白：两处公开接口（报名、改资料）此前**各写了一份一模一样的实现**，
 * 后台录入又写了第三份（少了去重）。四个调用点共用它，以后加位置只改游戏配置。
 *
 * `positions` 现在是 `string[]` 而不是原先的 `as const` 元组 ——
 * TypeScript 不再保证它没有重复项，所以这里保留「截到目录长度」这道兜底。
 */
export function normalizePositions(value: unknown, game: GameConfig = getGameConfig()): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || !game.positions.includes(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result.slice(0, game.positions.length);
}

/** 按地图 id 或中文名查目录图片。 */
export function mapImageOf(
  map: { id?: string; name?: string },
  game: GameConfig = getGameConfig(),
): string | undefined {
  return game.maps.find((m) => m.id === map.id || (map.name && m.name === map.name))?.image;
}

/** 该地图名是否在这款游戏的目录里（识图回填与手工选择用）。 */
export function findMapByName(name: string, game: GameConfig = getGameConfig()): GameMap | undefined {
  return game.maps.find((m) => m.name === name);
}
