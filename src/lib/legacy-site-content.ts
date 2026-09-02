export interface LegacyGame {
  slug: string;
  name: string;
  eyebrow: string;
  tagline: string;
  accent: string;
  accentDark: string;
  background: string;
  community: string;
  tournament: string;
  status: string;
  news: string[];
  description: string;
  features: string[];
  heroImage?: string;
}

export interface LegacyAnnouncement {
  id: string;
  title: string;
  date: string;
  content: string;
}

export const LEGACY_GAMES: LegacyGame[] = [
  {
    slug: "lol",
    name: "英雄联盟",
    eyebrow: "LEAGUE OF LEGENDS",
    tagline: "欢迎来到召唤师峡谷",
    accent: "#c89b3c",
    accentDark: "#9c7a2f",
    background: "linear-gradient(135deg, #0b2c59 0%, #123d78 48%, #1f1b55 100%)",
    community: "532365245",
    tournament: "瓦理杯 S2",
    status: "社群开放",
    description: "在召唤师峡谷中展现你的战术与操作，与队友并肩作战，争夺最终的胜利。",
    features: ["5v5 经典竞技", "战术配合", "英雄联动", "符文系统"],
    news: ["瓦理杯英雄联盟 S2 赛事报名开启", "上届冠军我是奶龙队专访", "新版本符文与出装前瞻"],
    heroImage: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&h=600&fit=crop",
  },
  {
    slug: "valorant",
    name: "无畏契约",
    eyebrow: "VALORANT",
    tagline: "DEFY THE LIMITS",
    accent: "#ff4655",
    accentDark: "#d63947",
    background: "linear-gradient(135deg, #59121c 0%, #17191f 56%, #050608 100%)",
    community: "639366489",
    tournament: "神将杯 S1",
    status: "社群开放",
    description: "精准射击与战术特性的完美结合。选择你的特工，发挥独特技能，在爆破模式中一决胜负。",
    features: ["5v5 爆破模式", "特工技能", "精准枪法", "战术博弈"],
    news: ["神将杯无畏契约 S1 赛事圆满落幕", "赛事精彩集锦：那些不可思议的残局", "新英雄Clove玩法教学"],
    heroImage: "https://images.unsplash.com/photo-1511512578047-dfb367046420?w=1200&h=600&fit=crop",
  },
  {
    slug: "cs2",
    name: "CS2",
    eyebrow: "COUNTER-STRIKE 2",
    tagline: "ECO? FULL BUY!",
    accent: "#facc15",
    accentDark: "#d4aa12",
    background: "linear-gradient(135deg, #20252b 0%, #5c3b0b 50%, #101217 100%)",
    community: "312064523",
    tournament: "华理 CS2 水友赛",
    status: "社群开放",
    description: "经典 FPS 的革新之作。在全新引擎下体验更真实的枪械手感与战术对抗。",
    features: ["竞技模式", "经济管理", "地图控制", "投掷物运用"],
    news: ["校园 CS2 水友赛报名火热进行中", "Dust 2 地图进攻防守技巧分享", "关于最新版本更新的讨论"],
    heroImage: "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=1200&h=600&fit=crop",
  },
  {
    slug: "delta",
    name: "三角洲行动",
    eyebrow: "DELTA FORCE",
    tagline: "新一代战术射击",
    accent: "#4ade80",
    accentDark: "#22c55e",
    background: "linear-gradient(135deg, #0f2a1a 0%, #1a3d2a 48%, #0d1f14 100%)",
    community: "552750103",
    tournament: "华理三角洲赛",
    status: "社群开放",
    description: "全新战术射击体验。在大规模战场与紧张撤离模式中，展现你的战术素养与团队协作。",
    features: ["大规模战场", "撤离模式", "战术射击", "自由装配"],
    news: ["三角洲行动校园赛筹备中", "撤离模式玩法攻略", "武器配装推荐与战术分享"],
    heroImage: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&h=600&fit=crop",
  },
];

export const LEGACY_ANNOUNCEMENTS: LegacyAnnouncement[] = [
  {
    id: "walicup-s2",
    title: "瓦理杯英雄联盟 S2 赛事报名开启",
    date: "2026-08-20",
    content: "华理电竞部公开赛事内容已迁入新官网。请关注赛事页的报名状态、参赛规程和后续赛程通知。",
  },
  {
    id: "valorant-s1",
    title: "神将杯无畏契约 S1 赛事圆满落幕",
    date: "2026-08-18",
    content: "感谢所有参赛队伍和工作人员。完整赛果与赛事资料请以赛事页公布内容为准。",
  },
  {
    id: "recruitment",
    title: "电竞部公开内容与赛事资料已完成迁移",
    date: "2026-09-01",
    content: "旧版官网的游戏分区、公告、社群信息和公开赛事入口现已合并到 ECUST 电竞部新官网。赛事报名、赛程与对阵图继续由赛事工作台统一维护。",
  },
];

export const GAME_COMMUNITIES = [
  ["微信公众号", "花梨电竞"],
  ["电竞部官方群", "691265713"],
  ["英勇之地", "926265440"],
  ["三角洲行动", "552750103"],
  ["Apex", "619091353"],
  ["绝地求生", "343683662"],
  ["最终幻想14", "659946675"],
  ["原神", "702433613"],
  ["崩坏：星穹铁道", "836129214"],
  ["崩坏3", "777731893"],
  ["明日方舟", "601332814"],
  ["第五人格", "746701856"],
  ["蛋仔派对", "649796023"],
  ["王者荣耀", "715837103"],
  ["和平精英", "725912740"],
  ["金铲铲之战", "726066713"],
  ["永劫无间", "787955491"],
  ["三国杀", "701236851"],
  ["英雄联盟", "532365245"],
  ["英雄联盟手游", "631166652"],
  ["无畏契约", "639366489"],
  ["CS2", "312064523"],
  ["守望先锋", "626180600"],
  ["DOTA2", "710080417"],
  ["彩虹六号", "852028816"],
  ["Apex 英雄", "770619553"],
];

export function getLegacyGame(slug: string): LegacyGame | undefined {
  return LEGACY_GAMES.find((game) => game.slug === slug);
}
