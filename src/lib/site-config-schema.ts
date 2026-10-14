import type { EventStatus } from "@/types";
import type { StageConfig } from "@/lib/scheduling/format-templates";
import { getGameConfig } from "@/lib/games";

/** 默认图池（取自游戏配置层）。新建赛事时预勾选这些地图。 */
const DEFAULT_MAP_POOL = getGameConfig().defaultMapPool;

export interface EditableContentCard {
  index: string;
  meta: string;
  title: string;
  description: string;
}

export interface EditableRule {
  title: string;
  detail: string;
  category?: "format" | "match-day" | "conduct" | "incident" | "appeal";
  emphasis?: "normal" | "important" | "warning";
  /** 通用规则由赛事组织继承，赛制规则按阶段配置生成，本届规则由负责人新增。 */
  source?: "common" | "format" | "event";
  /** 继承或生成后发生过本届赛事修改。 */
  customized?: boolean;
  /** 高风险处罚条款需负责人显式确认后才能发布。 */
  confirmed?: boolean;
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
  /** 玩家侧可见性与赛事阶段分离；撤回公开不改变当前赛事阶段。 */
  visibility: "private" | "public";
  publishedAt?: string;
  teamCount: number;
  teamSize: number;
  description: string;
  organizer: string;
  registrationStart: string;
  registrationEnd: string;
  /** 队伍申报与名单调整截止日期；可晚于选手个人报名截止 */
  teamRegistrationEnd: string;
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
  /** 赛制阶段配置（新建赛事赛制配置器的产物，驱动对阵图与竞赛规程） */
  stageConfigs: StageConfig[];
  /** 赛事 QQ 群号（本届参赛通知群，负责人填写；空表示未设置） */
  eventQqGroup: string;
  /** 3.47 及更早版本的策划案兼容字段；当前产品流程不再读取或编辑。 */
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
    community: string;
    news: string;
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
  /** 全部赛事（含已结束）；每场赛事的数据与后台工作区由各自 id 隔离。 */
  events: EditableEvent[];
  /** 兼容字段：仅表示首页焦点赛事，不得作为后台或 API 的隐式赛事上下文。 */
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
    community: "社群",
    news: "公告",
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
      game: getGameConfig().displayName,
      status: "draft",
      visibility: "private",
      teamCount: 32,
      teamSize: 5,
      // 简介里不写死阶段数。这个默认事件自己的 stageConfigs 是三阶段（32/16/8），
      // 但阶段结构会变 —— 本届加上资格赛就成了四阶段，而简介仍写着「三个阶段」，
      // 于是官网上的简介与赛程自相矛盾。阶段构成已经由 stageSummary 逐段列出，
      // 简介再复述一遍只会多一处会过期的数字。
      description: "华东理工大学第三届《无畏契约》校内赛事。赛事分阶段进行，最终决出本届瓦理杯冠军。",
      organizer: "华东理工大学电竞社",
      registrationStart: "2026-08-01",
      registrationEnd: "2026-09-30",
      teamRegistrationEnd: "2026-10-03",
      eventDateLabel: "竞赛日期待公布",
      registrationLabel: "报名尚未开放",
      stageSummary: "入围赛（32 队）→ 小组赛（16 队）→ 双败淘汰赛（8 队）",
      prizePool: "奖金及奖品方案待公布",
      coverColor: "#ff4655",
      posterImage: "",
      mapPool: DEFAULT_MAP_POOL,
      preparationSteps: [
        { number: "01", title: "选手注册", detail: "参赛选手须通过赛事报名页面提交真实、完整且可核验的信息，并妥善保管参赛管理码。" },
        { number: "02", title: "队伍组建", detail: "队长须完成队伍创建与选手邀请；自由选手可向未满编队伍提交入队申请，队伍确认后生效。" },
        { number: "03", title: "阵容提交", detail: "队长须于队伍报名截止前提交正式参赛名单。名单经赛事组审核确认后，进入抽签及编排程序。" },
        { number: "04", title: "查看分组与比赛时间", detail: "赛事组将分阶段公布分组、对阵和比赛时间。参赛队伍须查看平台发布的最新赛程。" },
        { number: "05", title: "赛前报到", detail: "参赛队伍须于计划开赛时间前 15 分钟进入指定比赛房间，完成身份、阵容与裁判确认。" },
        { number: "06", title: "地图禁选与开赛", detail: "双方队长须在当值裁判监督下完成地图禁选；裁判确认双方就绪后宣布比赛开始。" },
      ],
      rules: [
        { title: "参赛资格", detail: "参赛选手须符合本届赛事公布的校内身份及报名条件，并使用真实、完整且可核验的信息完成登记。", category: "conduct", emphasis: "normal" },
        { title: "参赛规模", detail: "赛事计划设置 32 个参赛席位，每支队伍注册 5 名首发选手。", category: "format", emphasis: "normal" },
        { title: "名单与替补", detail: "参赛阵容以赛事平台最终审核记录为准。未经赛事组正式确认，任何队伍不得擅自更换或新增选手；替补及教练名额以本届竞赛规程为准。", category: "conduct", emphasis: "important" },
        { title: "入围赛", detail: "32 支队伍经随机抽签确定首轮对阵，采用单败淘汰制，比赛为 BO1；16 支胜者晋级小组赛。", category: "format", emphasis: "normal" },
        { title: "小组赛", detail: "16 支队伍分入 4 个小组，每组采用 GSL 双败赛制，所有比赛为 BO3；各组前两名晋级淘汰赛。", category: "format", emphasis: "normal" },
        { title: "淘汰赛", detail: "8 支晋级队伍进入双败淘汰赛。败者组决赛与总决赛为 BO5，其余场次为 BO3。", category: "format", emphasis: "normal" },
        { title: "地图池与禁选", detail: "比赛采用赛事平台公布的赛事地图池。双方队长须在当值裁判监督下，按规定顺序完成地图禁选。", category: "match-day", emphasis: "normal" },
        { title: "赛程与改期生效", detail: "比赛时间以赛事平台最新公布的赛程为准。队伍协商改期后，须由赛事负责人确认并更新赛程，改期方可生效。", category: "match-day", emphasis: "important" },
        { title: "比赛报到", detail: "参赛队伍须于计划开赛时间前 15 分钟完成报到、阵容核验、房间确认及地图禁选。", category: "match-day", emphasis: "normal" },
        { title: "录屏与证据", detail: "赛事组可要求参赛选手保留完整比赛录制。涉及技术故障、违规或赛果争议时，申请方须按要求提交原始影像或截图证据。", category: "match-day", emphasis: "important" },
        { title: "技术暂停", detail: "发生断线、设备或网络故障时，队长须立即向当值裁判报告。未经裁判许可，任何队伍不得擅自暂停、重开或退出比赛。", category: "incident", emphasis: "important" },
        { title: "竞技行为规范", detail: "参赛人员须遵守竞技道德与赛事秩序。侮辱、挑衅、刷屏、恶意攻击及干扰比赛的行为将依据情节予以处理。", category: "conduct", emphasis: "important" },
        { title: "迟到与弃赛", detail: "队伍无法按时参赛时须提前向赛事组报备。迟到、无故缺席或弃赛按照已公布竞赛规程及当值裁判裁决处理。", category: "incident", emphasis: "warning" },
        { title: "竞赛完整性", detail: "严禁使用外挂、代打、窥屏、未经批准的换人或其他获取不当竞争优势的行为。经核实后，赛事组可判处地图判负、系列赛判负或取消参赛资格。", category: "conduct", emphasis: "warning" },
        { title: "争议与申诉", detail: "赛果、判罚或比赛异常的申诉，仅由队长在规定时限内向当值裁判提出，并同时提交相关证据。争议处理期间，双方不得自行变更赛果。", category: "appeal", emphasis: "important" },
        { title: "判罚依据", detail: "赛事组依据竞赛规程、平台记录、裁判报告及有效证据作出裁决。赛事组对本届赛事规则保留最终解释权。", category: "appeal", emphasis: "normal" },
      ],
      formatTemplateId: "val-16gsl-8de",
      eventQqGroup: "1107657580",
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
  const v = typeof value === "string" ? value.trim().slice(0, 500) : "";
  if (v.startsWith("/")) return v;
  try {
    const url = new URL(v);
    const supabaseAsset = url.protocol === "https:"
      && url.hostname.endsWith(".supabase.co")
      && url.pathname.startsWith("/storage/v1/object/public/event-assets/");
    return supabaseAsset ? v : "";
  } catch {
    return "";
  }
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
          const title = text(rule.title, fb.title, 60);
          const categoryValues: NonNullable<EditableRule["category"]>[] = ["format", "match-day", "conduct", "incident", "appeal"];
          const emphasisValues: NonNullable<EditableRule["emphasis"]>[] = ["normal", "important", "warning"];
          const sourceValues: NonNullable<EditableRule["source"]>[] = ["common", "format", "event"];
          const inferredCategory: NonNullable<EditableRule["category"]> = /参赛规模|入围赛|小组赛|淘汰赛|赛制|种子|抽签|晋级/.test(title)
            ? "format"
            : /地图|BP|赛程确认|赛程与改期|比赛报到|赛前|录屏/.test(title)
              ? "match-day"
              : /暂停|设备|网络|掉线|迟到|弃赛/.test(title)
                ? "incident"
                : /争议|申诉|判罚|裁判/.test(title)
                  ? "appeal"
                  : "conduct";
          return {
            title,
            detail: text(rule.detail, fb.detail, 500),
            category: categoryValues.includes(rule.category as NonNullable<EditableRule["category"]>)
              ? rule.category as NonNullable<EditableRule["category"]>
              : fb.category ?? inferredCategory,
            emphasis: emphasisValues.includes(rule.emphasis as NonNullable<EditableRule["emphasis"]>)
              ? rule.emphasis as NonNullable<EditableRule["emphasis"]>
              : fb.emphasis ?? (/作弊|处罚|判负|取消资格/.test(title) ? "warning" : "normal"),
            source: sourceValues.includes(rule.source as NonNullable<EditableRule["source"]>)
              ? rule.source as NonNullable<EditableRule["source"]>
              : fb.source ?? (inferredCategory === "format" ? "format" : "common"),
            customized: typeof rule.customized === "boolean" ? rule.customized : Boolean(fb.customized),
            confirmed: typeof rule.confirmed === "boolean" ? rule.confirmed : fb.confirmed ?? true,
          };
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
      const visibility: EditableEvent["visibility"] = item.visibility === "private" || item.visibility === "public"
        ? item.visibility
        : status === "draft" ? "private" : "public";

      return {
        id: text(item.id, fallback.id, 60),
        name: text(item.name, fallback.name, 80),
        game: text(item.game, fallback.game, 40),
        status,
        visibility,
        publishedAt: typeof item.publishedAt === "string" ? item.publishedAt.slice(0, 40) : undefined,
        teamCount: count(item.teamCount, fallback.teamCount),
        teamSize: count(item.teamSize, fallback.teamSize, 1, 20),
        description: text(item.description, fallback.description, 500),
        organizer: text(item.organizer, fallback.organizer, 80),
        // 报名日期允许空字符串（表示未定），仅在字段缺失时使用默认值
        registrationStart: typeof item.registrationStart === "string" ? item.registrationStart.trim().slice(0, 20) : fallback.registrationStart,
        registrationEnd: typeof item.registrationEnd === "string" ? item.registrationEnd.trim().slice(0, 20) : fallback.registrationEnd,
        teamRegistrationEnd: typeof item.teamRegistrationEnd === "string" ? item.teamRegistrationEnd.trim().slice(0, 20) : (fallback.teamRegistrationEnd || fallback.registrationEnd),
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
        eventQqGroup: (() => {
          const raw = typeof item.eventQqGroup === "string" ? item.eventQqGroup.trim() : "";
          // 只保留数字，长度 5–20 位之间才视为合法群号，否则落空。
          const digits = raw.replace(/\D/g, "").slice(0, 20);
          return digits.length >= 5 ? digits : "";
        })(),
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
          // 白名单之外的类型会被**改写**成兜底模板的类型 —— 新增阶段类型时这里必须同步，
          // 否则存进去的赛制读回来会静默变样（2026-10-14 加 single-elim-groups 时踩过这个点）。
          const validTypes = ["single-elim", "single-elim-groups", "gsl-groups", "double-elim", "round-robin"];
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
      community: text(navigation.community, DEFAULT_SITE_CONFIG.navigation.community, 16),
      news: text(navigation.news, DEFAULT_SITE_CONFIG.navigation.news, 16),
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
