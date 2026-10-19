// =====================
// 地图名标准化
//
// 视觉模型读截图上的地图名，读回来的是**自由文本**——实测会把「亚海悬城」读成
// 「蔚海悬城」。这个错名字会一路流进下拉框、再写进正式赛果，赛后查记录就是错的。
//
// 这里做一件事：**把读回来的名字对齐到官方中文名**。
// 只有 13 张图，用「精确匹配 → 别名表」两层就够，不做模糊匹配的花活：
// 模糊匹配会把「微风岛屿」错配到「森寒冬港」，那比不匹配更危险。
//
// 匹配不上的**原样返回**，并把这件事交给上层提示给人看——
// 宁可显示一个可疑的名字让人核对，也不要静默替换成一个错的地图。
// =====================

import { getGameConfig } from "@/lib/games";

/** 当前游戏的地图目录。地图数据在 `@/lib/games`（原 `@/lib/maps` 已并入）。 */
const MAP_CATALOG = getGameConfig().maps;

/**
 * 别名表：模型常见读法 → 官方中文名。
 *
 * 只收**已经被实际观测到、或字形/读音高度接近**的写法。
 * 不收英文名——模型读的是中文界面截图，返回英文名反而是异常信号，应该让人看见。
 */
const MAP_ALIASES: Record<string, string> = {
  // "亚海悬城" 的常见误读（实测出现过「蔚海悬城」）
  "蔚海悬城": "亚海悬城",
  "亚海悬域": "亚海悬城",
  "亚海县城": "亚海悬城",
  "来海悬城": "亚海悬城",
  "业海悬城": "亚海悬城",
  // "源工重镇"
  "原工重镇": "源工重镇",
  "源工重填": "源工重镇",
  // "隐士修所"
  "隐土修所": "隐士修所",
  "隐士修锁": "隐士修所",
  // "霓虹町"
  "霓虹叮": "霓虹町",
  "泥虹町": "霓虹町",
  // "森寒冬港"
  "森林冬港": "森寒冬港",
  "森寒东港": "森寒冬港",
  // "微风岛屿"
  "微凤岛屿": "微风岛屿",
  "微风鸟屿": "微风岛屿",
  // "莲华古城"
  "莲花古城": "莲华古城",
  "莲华古诚": "莲华古城",
  // "裂变峡谷"
  "裂变狭谷": "裂变峡谷",
  "列变峡谷": "裂变峡谷",
  // "深海明珠"
  "深海明株": "深海明珠",
  "深海南珠": "深海明珠",
  // "日落之城"
  "日落之成": "日落之城",
  // "幽邃地窟"
  "幽邃地哭": "幽邃地窟",
  "幽遂地窟": "幽邃地窟",
  // "天枢云阙"
  "天枢云阕": "天枢云阙",
  "天枢云缺": "天枢云阙",
  // "盐海矿镇"
  "盐海矿填": "盐海矿镇",
  "盐海狂镇": "盐海矿镇",
};

/** 归一化：去空白、全角转半角。用于匹配前的宽松比较。 */
function normalize(input: string): string {
  return input.replace(/\s+/g, "").replace(/[\uff01-\uff5e]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

export interface MapNameResolution {
  /** 对齐后的官方中文名；无法对齐时为 null。 */
  resolved: string | null;
  /** 归一化后原样保留的名字；无法对齐时用它显示给人核对。 */
  original: string;
  /** 是否发生了替换（用于决定要不要提示人）。 */
  changed: boolean;
}

/**
 * 把模型读到的地图名对齐到官方中文名。
 *
 * 返回 `resolved === null` 表示这张图不认识——调用方**不要静默丢弃**，
 * 应该带着 `original` 提示裁判核对。
 */
export function resolveMapName(raw: string | null | undefined): MapNameResolution {
  const original = (raw ?? "").trim();
  if (!original) return { resolved: null, original, changed: false };

  const key = normalize(original);

  // 第一层：官方中文名精确匹配（归一化后）
  const exact = MAP_CATALOG.find((m) => normalize(m.name) === key);
  if (exact) {
    const changed = exact.name !== original;
    return { resolved: exact.name, original, changed };
  }

  // 第二层：别名表
  for (const [alias, official] of Object.entries(MAP_ALIASES)) {
    if (normalize(alias) === key) {
      return { resolved: official, original, changed: official !== original };
    }
  }

  // 都匹配不上：不猜，原样返回让人核对
  return { resolved: null, original, changed: false };
}
