import type { EventStatus } from "@/types";
import type { StageConfig } from "@/lib/scheduling/format-templates";
import { DEFAULT_MAP_POOL } from "@/lib/maps";

export interface EditableContentCard {
  index: string;
  meta: string;
  title: string;
  description: string;
}

export interface EditableRule {
  title: string;
  detail: string;
}

export interface EditableStep {
  number: string;
  title: string;
  detail: string;
}

export interface EditableArchive {
  id: string;
  name: string;
  game: string;
  description: string;
  coverColor: string;
  posterImage: string;
}

export interface EditableMap {
  id: string;
  name: string;
}

export interface EditableEvent {
  id: string;
  name: string;
  game: string;
  status: EventStatus;
  teamCount: number;
  teamSize: number;
  description: string;
  organizer: string;
  registrationStart: string;
  registrationEnd: string;
  eventDateLabel: string;
  registrationLabel: string;
  stageSummary: string;
  prizePool: string;
  coverColor: string;
  posterImage: string;
  mapPool: EditableMap[];
  preparationSteps: EditableStep[];
  rules: EditableRule[];
  /** 赛制模板 id（新建比赛时选择的模板，用于赛制与抽签） */
  formatTemplateId: string;
  /** 赛制阶段配置（新建比赛赛制配置器的产物，驱动对阵图与策划案） */
  stageConfigs: StageConfig[];
  /** 策划案信息（新建比赛第三步填写；策划案模块据此生成文档） */
  proposal: {
    background: string;
    purpose: string;
    budget: string;
    prizes: string;
    leader: string;
    contact: string;
  };
  /** 创建时间，用于列表排序 */
  createdAt: string;
}

export interface SiteConfig {
  version: 1;
  updatedAt: string;
  brand: {
    name: string;
    englishName: string;
    mark: string;
    footerDescription: string;
    footerStatus: string;
    copyright: string;
  };
  navigation: {
    home: string;
    events: string;
    bp: string;
    admin: string;
  };
  seo: {
    title: string;
    description: string;
  };
  home: {
    heroImage: string;
    heroImageAlt: string;
    railLeft: string;
    railRight: string;
    kicker: string;
    headlineTop: string;
    headlineBottom: string;
    description: string;
    primaryCta: string;
    secondaryCta: string;
    journeyKicker: string;
    journeyTitleTop: string;
    journeyTitleBottom: string;
    journeyAside: string;
    cards: EditableContentCard[];
    historyKicker: string;
    historyTitle: string;
    historyLink: string;
    closingKicker: string;
    closingTitle: string;
    closingCta: string;
  };
  eventList: {
    eyebrow: string;
    title: string;
    description: string;
  };
  /** 全部赛事（含已结束），currentEventId 指向当前对外展示的赛事 */
  events: EditableEvent[];
  currentEventId: string;
  archives: EditableArchive[];
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  version: 1,
  updatedAt: "2026-08-16T00:00:00.000Z",
  brand: {
    name: "华东理工大学电竞部",
    englishName: "ECUST ESPORTS DEPT",
    mark: "ECUST",
    footerDescription: "华东理工大学电竞部官方网站。赛事、活动、玩家工具与电竞部动态都在这里。",
    footerStatus: "第三届华理瓦理杯筹备中",
    copyright: "© 2026 华东理工大学电竞部",
  },
  navigation: {
    home: "首页",
    events: "赛事",
    bp: "工具",
    admin: "工作台",
  },
  seo: {
    title: "华理瓦理杯 | 无畏契约校内赛",
    description: "第三届华理瓦理杯赛事信息、报名通知、比赛规则、分组赛程与赛果查询。",
  },
  home: {
    heroImage: "/arena-hero.png",
    heroImageAlt: "红色灯束照亮的未来感电竞场馆",
    railLeft: "ECUST VALORANT COMMUNITY",
    railRight: "2026 / WALICUP",
    kicker: "第三届华理瓦理杯筹备中",
    headlineTop: "华理玩家",
    headlineBottom: "下一场见",
    description: "冠军与亚军将获得现金奖励与定制周边，晋级队伍均有纪念品。具体奖励即将公布，现在就组队报名，抢占参赛席位！",
    primaryCta: "立即报名",
    secondaryCta: "查看历届赛事",
    journeyKicker: "ROAD TO THE FINAL",
    journeyTitleTop: "从报名，",
    journeyTitleBottom: "一路打到决赛。",
    journeyAside: "参赛信息、分组、比赛时间和赛果都会在这里更新。你只需要和队友准备好上场。",
    cards: [
      { index: "01", meta: "REGISTRATION / REVIEW", title: "报名与组队", description: "查看报名时间、参赛资格和队伍要求。没有固定队伍的玩家，也可以关注赛事群内的招募信息。" },
      { index: "02", meta: "BRACKET / SCHEDULE", title: "分组与赛程", description: "名单确认后统一公布种子分档、分组抽签和比赛时间。临时调整请以赛事组最新通知为准。" },
      { index: "03", meta: "BAN / PICK", title: "比赛日流程", description: "按通知完成地图 BP 和比赛准备。遇到迟到、掉线或争议，请第一时间联系当值裁判。" },
      { index: "04", meta: "REPORT / MOMENT", title: "赛果与回顾", description: "每轮结束后更新比分、晋级情况和后续对阵。赛事结束后可查看最终排名和比赛回顾。" },
    ],
    historyKicker: "WALICUP HISTORY",
    historyTitle: "瓦理杯赛事",
    historyLink: "查看全部",
    closingKicker: "FIND YOUR TEAM",
    closingTitle: "准备好你的五人小队。",
    closingCta: "查看参赛须知",
  },
  eventList: {
    eyebrow: "WALICUP EVENTS",
    title: "华理瓦理杯",
    description: "查看第三届赛事筹备进度，以及历届瓦理杯的赛事资料。",
  },
  events: [
    {
      id: "event-1",
      name: "第三届华理瓦理杯",
      game: "无畏契约",
      status: "draft",
      teamCount: 32,
      teamSize: 5,
      description: "面向华东理工大学校内玩家的《无畏契约》赛事。叫上队友组成五人小队，从入围赛一路打进总决赛。报名时间、比赛日期和奖项将在确认后统一公布。",
      organizer: "华东理工大学电竞社",
      registrationStart: "2026-08-01",
      registrationEnd: "2026-09-30",
      eventDateLabel: "比赛时间待公布",
      registrationLabel: "尚未开放",
      stageSummary: "32 队入围赛 → 16 队小组赛 → 8 队双败淘汰",
      prizePool: "奖项与奖品将在报名开启前公布",
      coverColor: "#ff4655",
      posterImage: "",
      mapPool: DEFAULT_MAP_POOL,
      preparationSteps: [
        { number: "01", title: "准备五人小队", detail: "报名开放前确认队伍名称、五名首发和有效联系方式。" },
        { number: "02", title: "关注赛事公告", detail: "报名时间、比赛日期、地图池和奖项将由赛事组统一公布。" },
        { number: "03", title: "按最新赛程参赛", detail: "分组抽签完成后公布比赛时间；临时调整以赛事组通知为准。" },
      ],
      rules: [
        { title: "参赛规模", detail: "计划招募 32 支队伍，每队 5 名首发选手" },
        { title: "入围赛", detail: "32 支队伍随机配对，进行单败淘汰 BO1，16 支队伍晋级" },
        { title: "小组赛", detail: "16 支队伍分为 4 组，进行 GSL 双败赛，全部比赛为 BO3；每组两支队伍晋级" },
        { title: "淘汰赛", detail: "8 支队伍进行双败淘汰；败者组决赛和总决赛为 BO5，其余比赛为 BO3" },
        { title: "地图与 BP", detail: "地图池和具体 BP 顺序以报名开启前发布的参赛手册为准" },
        { title: "赛程确认", detail: "两队可协商比赛时间，但最终时间以赛事组发布的有效赛程为准" },
        { title: "比赛报到", detail: "参赛队伍应按通知提前进入赛事群和指定房间，配合裁判完成地图 BP" },
        { title: "争议处理", detail: "如遇迟到、掉线或比赛争议，请第一时间联系当值裁判，不要自行判定赛果" },
      ],
      formatTemplateId: "val-16gsl-8de",
      proposal: {
        background: "",
        purpose: "",
        budget: "",
        prizes: "",
        leader: "",
        contact: "",
      },
      stageConfigs: [
        { name: "入围赛", type: "single-elim", teamCount: 32, boType: "BO1" },
        { name: "小组赛", type: "gsl-groups", teamCount: 16, boType: "BO3", groupCount: 4 },
        { name: "淘汰赛", type: "double-elim", teamCount: 8, boType: "BO3" },
      ],
      createdAt: "2026-08-14T00:00:00.000Z",
    },
  ],
  currentEventId: "event-1",
  archives: [],
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback: string, maxLength = 500): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) || fallback : fallback;
}

function count(value: unknown, fallback: number, min = 1, max = 999): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function imagePath(value: unknown): string {
  const v = typeof value === "string" ? value.trim().slice(0, 160) : "";
  return v.startsWith("/") ? v : "";
}

export function normalizeSiteConfig(value: unknown): SiteConfig {
  const source = record(value);
  const brand = record(source.brand);
  const navigation = record(source.navigation);
  const seo = record(source.seo);
  const home = record(source.home);
  const eventList = record(source.eventList);

  const cardSource = Array.isArray(home.cards) ? home.cards : [];
  const cards = DEFAULT_SITE_CONFIG.home.cards.map((fallback, index) => {
    const item = record(cardSource[index]);
    return {
      index: text(item.index, fallback.index, 8),
      meta: text(item.meta, fallback.meta, 60),
      title: text(item.title, fallback.title, 40),
      description: text(item.description, fallback.description, 240),
    };
  });

  const allowedStatuses: EventStatus[] = ["draft", "registration", "ongoing", "completed", "archived"];

  // 赛事规范化：兼容旧格式（currentEvent 单对象）与新格式（events 数组）
  const rawEvents = Array.isArray(source.events) ? source.events : [];
  // 旧格式迁移：currentEvent 字段存在且 events 为空时，当作唯一赛事
  const legacyEvent = record(source.currentEvent);
  const eventSources = rawEvents.length > 0
    ? rawEvents
    : Object.keys(legacyEvent).length > 0
      ? [legacyEvent]
      : [];

  const defaultEvent = DEFAULT_SITE_CONFIG.events[0];
  const events = eventSources
    .map((raw, index) => {
      const item = record(raw);
      const fallback = DEFAULT_SITE_CONFIG.events[index] ?? defaultEvent;

      const stepSource = Array.isArray(item.preparationSteps) ? item.preparationSteps : [];
      const preparationSteps = fallback.preparationSteps.map((fb, stepIndex) => {
        const step = record(stepSource[stepIndex]);
        return {
          number: text(step.number, fb.number, 8),
          title: text(step.title, fb.title, 50),
          detail: text(step.detail, fb.detail, 240),
        };
      });

      const ruleSource = Array.isArray(item.rules) ? item.rules : [];
      const rules = ruleSource
        .map((rawRule, ruleIndex) => {
          const rule = record(rawRule);
          const fb = fallback.rules[ruleIndex] ?? { title: `规则 ${ruleIndex + 1}`, detail: "待补充" };
          return { title: text(rule.title, fb.title, 60), detail: text(rule.detail, fb.detail, 500) };
        })
        .slice(0, 30);

      const mapPoolSource = Array.isArray(item.mapPool) ? item.mapPool : [];
      const seenMapIds = new Set<string>();
      const mapPool = mapPoolSource
        .map((rawMap) => {
          const map = record(rawMap);
          return { id: text(map.id, "", 40), name: text(map.name, "", 40) };
        })
        .filter((map) => {
          if (!map.id || !map.name || seenMapIds.has(map.id)) return false;
          seenMapIds.add(map.id);
          return true;
        });

      const status = allowedStatuses.includes(item.status as EventStatus)
        ? (item.status as EventStatus)
        : fallback.status;

      return {
        id: text(item.id, fallback.id, 60),
        name: text(item.name, fallback.name, 80),
        game: text(item.game, fallback.game, 40),
        status,
        teamCount: count(item.teamCount, fallback.teamCount),
        teamSize: count(item.teamSize, fallback.teamSize, 1, 20),
        description: text(item.description, fallback.description, 500),
        organizer: text(item.organizer, fallback.organizer, 80),
        // 报名日期允许空字符串（表示未定），仅在字段缺失时使用默认值
        registrationStart: typeof item.registrationStart === "string" ? item.registrationStart.trim().slice(0, 20) : fallback.registrationStart,
        registrationEnd: typeof item.registrationEnd === "string" ? item.registrationEnd.trim().slice(0, 20) : fallback.registrationEnd,
        eventDateLabel: text(item.eventDateLabel, fallback.eventDateLabel, 80),
        registrationLabel: text(item.registrationLabel, fallback.registrationLabel, 60),
        stageSummary: text(item.stageSummary, fallback.stageSummary, 160),
        prizePool: text(item.prizePool, fallback.prizePool, 240),
        coverColor: color(item.coverColor, fallback.coverColor),
        posterImage: imagePath(item.posterImage),
        mapPool: mapPool.length > 0 ? mapPool : fallback.mapPool,
        preparationSteps,
        rules: rules.length > 0 ? rules : fallback.rules,
        formatTemplateId: text(item.formatTemplateId, fallback.formatTemplateId, 60),
        proposal: (() => {
          const p = record(item.proposal);
          const fb = fallback.proposal;
          return {
            background: text(p.background, fb.background, 800),
            purpose: text(p.purpose, fb.purpose, 800),
            budget: text(p.budget, fb.budget, 800),
            prizes: text(p.prizes, fb.prizes, 800),
            leader: text(p.leader, fb.leader, 40),
            contact: text(p.contact, fb.contact, 80),
          };
        })(),
        stageConfigs: (() => {
          const sourceStages = Array.isArray(item.stageConfigs) ? item.stageConfigs : [];
          if (sourceStages.length === 0) return fallback.stageConfigs;
          const validTypes = ["single-elim", "gsl-groups", "double-elim", "round-robin"];
          const validBo = ["BO1", "BO3", "BO5"];
          return sourceStages.map((rawStage, si) => {
            const st = record(rawStage);
            const fb = fallback.stageConfigs[si] ?? fallback.stageConfigs[fallback.stageConfigs.length - 1];
            const type = validTypes.includes(st.type as string) ? (st.type as StageConfig["type"]) : fb.type;
            const bo = validBo.includes(st.boType as string) ? (st.boType as StageConfig["boType"]) : fb.boType;
            return {
              name: text(st.name, fb.name, 20),
              type,
              teamCount: count(st.teamCount, fb.teamCount, 2, 128),
              boType: bo,
              ...(st.groupCount !== undefined && Number.isFinite(Number(st.groupCount)) ? { groupCount: Math.min(16, Math.max(1, Math.round(Number(st.groupCount)))) } : {}),
            };
          }).slice(0, 10);
        })(),
        createdAt: text(item.createdAt, fallback.createdAt, 40),
      };
    })
    .slice(0, 50);

  const normalizedEvents = events.length > 0 ? events : DEFAULT_SITE_CONFIG.events;

  const archiveSource = Array.isArray(source.archives) ? source.archives : [];
  const archives = archiveSource
    .map((raw, index) => {
      const item = record(raw);
      const fallback = DEFAULT_SITE_CONFIG.archives[index] ?? DEFAULT_SITE_CONFIG.archives[0] ?? { id: "", name: "", game: "", description: "", coverColor: "#0f1923", posterImage: "" };
      return {
        id: text(item.id, fallback.id, 40),
        name: text(item.name, fallback.name, 80),
        game: text(item.game, fallback.game, 40),
        description: text(item.description, fallback.description, 300),
        coverColor: color(item.coverColor, fallback.coverColor),
        posterImage: imagePath(item.posterImage),
      };
    })
    .slice(0, 10);

  const currentEventId = text(source.currentEventId, "", 60);
  const finalCurrentId = normalizedEvents.some((e) => e.id === currentEventId)
    ? currentEventId
    : normalizedEvents[0].id;

  return {
    version: 1,
    updatedAt: text(source.updatedAt, new Date().toISOString(), 40),
    brand: {
      name: text(brand.name, DEFAULT_SITE_CONFIG.brand.name, 40),
      englishName: text(brand.englishName, DEFAULT_SITE_CONFIG.brand.englishName, 60),
      mark: text(brand.mark, DEFAULT_SITE_CONFIG.brand.mark, 8),
      footerDescription: text(brand.footerDescription, DEFAULT_SITE_CONFIG.brand.footerDescription, 300),
      footerStatus: text(brand.footerStatus, DEFAULT_SITE_CONFIG.brand.footerStatus, 80),
      copyright: text(brand.copyright, DEFAULT_SITE_CONFIG.brand.copyright, 100),
    },
    navigation: {
      home: text(navigation.home, DEFAULT_SITE_CONFIG.navigation.home, 16),
      events: text(navigation.events, DEFAULT_SITE_CONFIG.navigation.events, 16),
      bp: text(navigation.bp, DEFAULT_SITE_CONFIG.navigation.bp, 16),
      admin: text(navigation.admin, DEFAULT_SITE_CONFIG.navigation.admin, 20),
    },
    seo: {
      title: text(seo.title, DEFAULT_SITE_CONFIG.seo.title, 80),
      description: text(seo.description, DEFAULT_SITE_CONFIG.seo.description, 180),
    },
    home: {
      heroImage: text(home.heroImage, DEFAULT_SITE_CONFIG.home.heroImage, 160).startsWith("/") ? text(home.heroImage, DEFAULT_SITE_CONFIG.home.heroImage, 160) : DEFAULT_SITE_CONFIG.home.heroImage,
      heroImageAlt: text(home.heroImageAlt, DEFAULT_SITE_CONFIG.home.heroImageAlt, 120),
      railLeft: text(home.railLeft, DEFAULT_SITE_CONFIG.home.railLeft, 60),
      railRight: text(home.railRight, DEFAULT_SITE_CONFIG.home.railRight, 60),
      kicker: text(home.kicker, DEFAULT_SITE_CONFIG.home.kicker, 80),
      headlineTop: text(home.headlineTop, DEFAULT_SITE_CONFIG.home.headlineTop, 40),
      headlineBottom: text(home.headlineBottom, DEFAULT_SITE_CONFIG.home.headlineBottom, 40),
      description: text(home.description, DEFAULT_SITE_CONFIG.home.description, 320),
      primaryCta: text(home.primaryCta, DEFAULT_SITE_CONFIG.home.primaryCta, 30),
      secondaryCta: text(home.secondaryCta, DEFAULT_SITE_CONFIG.home.secondaryCta, 30),
      journeyKicker: text(home.journeyKicker, DEFAULT_SITE_CONFIG.home.journeyKicker, 60),
      journeyTitleTop: text(home.journeyTitleTop, DEFAULT_SITE_CONFIG.home.journeyTitleTop, 50),
      journeyTitleBottom: text(home.journeyTitleBottom, DEFAULT_SITE_CONFIG.home.journeyTitleBottom, 50),
      journeyAside: text(home.journeyAside, DEFAULT_SITE_CONFIG.home.journeyAside, 240),
      cards,
      historyKicker: text(home.historyKicker, DEFAULT_SITE_CONFIG.home.historyKicker, 60),
      historyTitle: text(home.historyTitle, DEFAULT_SITE_CONFIG.home.historyTitle, 50),
      historyLink: text(home.historyLink, DEFAULT_SITE_CONFIG.home.historyLink, 20),
      closingKicker: text(home.closingKicker, DEFAULT_SITE_CONFIG.home.closingKicker, 60),
      closingTitle: text(home.closingTitle, DEFAULT_SITE_CONFIG.home.closingTitle, 60),
      closingCta: text(home.closingCta, DEFAULT_SITE_CONFIG.home.closingCta, 30),
    },
    eventList: {
      eyebrow: text(eventList.eyebrow, DEFAULT_SITE_CONFIG.eventList.eyebrow, 60),
      title: text(eventList.title, DEFAULT_SITE_CONFIG.eventList.title, 60),
      description: text(eventList.description, DEFAULT_SITE_CONFIG.eventList.description, 240),
    },
    events: normalizedEvents,
    currentEventId: finalCurrentId,
    archives: archives.length > 0 ? archives : DEFAULT_SITE_CONFIG.archives,
  };
}
