import { ValMap } from "@/types";

/** 无畏契约竞技地图目录（13 张，含随赛季轮换的地图；name 为中文显示名） */
export const VALORANT_MAPS: ValMap[] = [
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

/** 默认排位图池（7 张；随排位轮换的替换由人工在后台地图池设置中完成） */
export const DEFAULT_MAP_POOL = VALORANT_MAPS.slice(0, 7).map((m) => ({ id: m.id, name: m.name }));

/** 兼容旧数据：BO3 示例顺序（4 Ban + 2 Pick，决胜图自动产生） */
export const DEFAULT_BP_ORDER: ("ban" | "pick")[] = [
  "ban", "ban", "ban", "ban", "pick", "pick",
];

/** 按地图 id 或名称查找目录图片 */
export function mapImageOf(map: { id?: string; name?: string }): string | undefined {
  return VALORANT_MAPS.find((m) => m.id === map.id || (map.name && m.name === map.name))?.image;
}
