// =====================
// 游戏配置层 · 《无畏契约》
//
// 这是本层的第一份、也是当前唯一一份配置。数据**逐字**搬自原处，
// 搬迁本身不改变任何行为：
//   · 地图目录 + 默认图池 + 默认 BP 顺序  ← 原 `src/lib/maps.ts`
//   · 段位阶梯                            ← 原 `format-data.ts` 的 `RANK_VALUE`
//   · 擅长位置、首发/替补/教练人数        ← 原 `registration-data.ts`
//
// 唯一的结构性改动：段位从「名字 → 数值」的对照表改成**有序数组**，
// 数值由下标派生。原来段位名在 3 个地方各写了一遍（这里、报名页、选手页），
// 加一档要改 3 处。
// =====================

import type { GameConfig } from "./types";

/** 竞技地图目录（13 张，含随赛季轮换的地图；name 为中文显示名）。 */
const MAPS = [
  { id: "ascent", name: "亚海悬城", codeName: "Ascent", image: "/maps/ascent.png" },
  { id: "bind", name: "源工重镇", codeName: "Bind", image: "/maps/bind.png" },
  { id: "haven", name: "隐士修所", codeName: "Haven", image: "/maps/haven.png" },
  { id: "split", name: "霓虹町", codeName: "Split", image: "/maps/split.png" },
  { id: "icebox", name: "森寒冬港", codeName: "Icebox", image: "/maps/icebox.png" },
  { id: "breeze", name: "微风岛屿", codeName: "Breeze", image: "/maps/breeze.png" },
  { id: "lotus", name: "莲华古城", codeName: "Lotus", image: "/maps/lotus.png" },
  { id: "fracture", name: "裂变峡谷", codeName: "Fracture", image: "/maps/fracture.png" },
  { id: "pearl", name: "深海明珠", codeName: "Pearl", image: "/maps/pearl.png" },
  { id: "sunset", name: "日落之城", codeName: "Sunset", image: "/maps/sunset.png" },
  { id: "abyss", name: "幽邃地窟", codeName: "Abyss", image: "/maps/abyss.png" },
  { id: "summit", name: "天枢云阙", codeName: "Summit", image: "/maps/summit.png" },
  { id: "corrode", name: "盐海矿镇", codeName: "Corrode", image: "/maps/corrode.png" },
];

export const VALORANT_GAME: GameConfig = {
  id: "valorant",
  displayName: "无畏契约",
  visionGameId: "valorant",
  /**
   * 赛事配置里的 `game` 是**自由文本**，历届填的是中文显示名而不是 id，
   * 所以这里必须把「可能出现在 game 字段里的写法」都列上，
   * 否则 `getGameConfig(event.game)` 会认不出本款游戏而退回默认款。
   */
  aliases: ["无畏契约", "瓦罗兰特", "VALORANT"],
  maps: MAPS,
  /**
   * 默认图池（7 张）。排位图池会随赛季轮换，替换由人工在后台「地图池」设置里完成 ——
   * 所以这里只给一个合理的初始值，不是一个应当长期保持不变的常量。
   */
  defaultMapPool: MAPS.slice(0, 7).map((m) => ({ id: m.id, name: m.name })),
  /** 段位阶梯由低到高；数值 = 下标 + 1（铁 1 → 无畏战魂 9）。 */
  ranks: ["铁", "青铜", "白银", "黄金", "铂金", "钻石", "超凡", "神话", "无畏战魂"],
  positions: ["一突", "二突", "烟位", "先锋", "哨位"],
  roster: { starters: 5, maxSubstitutes: 1, maxCoaches: 1 },
  /** 兼容旧数据：BO3 示例顺序（4 Ban + 2 Pick，决胜图自动产生）。 */
  defaultBpOrder: ["ban", "ban", "ban", "ban", "pick", "pick"],
};
