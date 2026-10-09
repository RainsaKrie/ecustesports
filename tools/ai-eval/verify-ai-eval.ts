import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_CONFIG, computeEndTime, validateReschedule,
  type BOType, type RescheduleRequest, type ScheduledMatch, type SchedulingConfig,
} from "../../src/lib/scheduling/rule-engine";
import { approveRequestOp } from "../../src/lib/scheduling/schedule-ops";
import type { ScheduleMatch, ScheduleState } from "../../src/lib/scheduling/schedule-data";

type Category = "可批准时间" | "超出赛事时间范围" | "队伍时间冲突" | "并发容量冲突" | "前置依赖" | "赛程版本过期" | "复合冲突";
type Decision = "可进入人工审批" | "暂不可批准" | "无需重复处理";
interface Case {
  id: string; category: Category; title: string; operation?: "重复审批";
  version: number; config?: SchedulingConfig; matches: ScheduledMatch[]; request: RescheduleRequest;
  expected: { decision: Decision; approved: boolean | null; codes: string[] };
  limitations?: string[]; review?: boolean;
}

const cfg: SchedulingConfig = { ...DEFAULT_CONFIG, boDurations: { ...DEFAULT_CONFIG.boDurations } };
const at = (day: "06" | "07" | "08", time: string) => `2026-10-${day}T${time}:00`;
function M(id: string, a: string, b: string, start: string, bo: BOType = "BO3", extra: Partial<ScheduledMatch> = {}): ScheduledMatch {
  return { id, teamAId: a, teamBId: b, boType: bo, startTime: start, endTime: start ? computeEndTime(start, bo, cfg) : "", frozen: false, ...extra };
}
const target = (bo: BOType = "BO3", extra: Partial<ScheduledMatch> = {}) => M("M01", "T-A", "T-B", at("07", "16:00"), bo, extra);
const req = (start: string, extra: Partial<RescheduleRequest> = {}): RescheduleRequest => ({
  matchId: "M01", newStartTime: start, teamAConfirmed: true, teamBConfirmed: true, basedOnVersion: 2, ...extra,
});
const ok = { decision: "可进入人工审批" as const, approved: true, codes: [] as string[] };
const no = (...codes: string[]) => ({ decision: "暂不可批准" as const, approved: false, codes });

const cases: Case[] = [
  { id: "A01", category: "可批准时间", title: "首次排期无冲突", version: 2, matches: [target("BO1", { startTime: "", endTime: "" })], request: req(at("06", "12:00")), expected: ok },
  { id: "A02", category: "可批准时间", title: "已排期比赛改期", version: 2, matches: [target(), M("M02", "T-C", "T-D", at("06", "12:00"))], request: req(at("07", "14:00")), expected: ok, review: true },
  { id: "A03", category: "可批准时间", title: "BO3恰好在阶段结束时完成", version: 2, matches: [target()], request: req(at("08", "16:30")), expected: ok },
  { id: "A04", category: "可批准时间", title: "BO5恰好在阶段结束时完成", version: 2, matches: [target("BO5")], request: req(at("08", "15:30")), expected: ok },

  { id: "R01", category: "超出赛事时间范围", title: "开始早于阶段开放", version: 2, matches: [target("BO1")], request: req(at("06", "11:30")), expected: no("HC-07") },
  { id: "R02", category: "超出赛事时间范围", title: "开始不早于结束但BO1越界", version: 2, matches: [target("BO1")], request: req(at("08", "18:00")), expected: no("HC-07") },
  { id: "R03", category: "超出赛事时间范围", title: "BO5占用时长越过阶段结束", version: 2, matches: [target("BO5")], request: req(at("08", "17:00")), expected: no("HC-07") },

  { id: "T01", category: "队伍时间冲突", title: "本队已有比赛", version: 2, config: { ...cfg, maxConcurrentMatches: 3 }, matches: [target(), M("M02", "T-A", "T-C", at("06", "12:00"))], request: req(at("06", "12:30")), expected: no("HC-04"), review: true },
  { id: "T02", category: "队伍时间冲突", title: "对手已有比赛", version: 2, config: { ...cfg, maxConcurrentMatches: 3 }, matches: [target(), M("M02", "T-C", "T-B", at("06", "12:00"))], request: req(at("06", "12:30")), expected: no("HC-04") },
  { id: "T03", category: "队伍时间冲突", title: "双方各自已有比赛", version: 2, config: { ...cfg, maxConcurrentMatches: 4 }, matches: [target(), M("M02", "T-A", "T-C", at("06", "12:00")), M("M03", "T-D", "T-B", at("06", "12:30"))], request: req(at("06", "12:30")), expected: no("HC-04", "HC-04") },

  { id: "C01", category: "并发容量冲突", title: "达到并发上限但不超限", version: 2, matches: [target(), M("M02", "T-C", "T-D", at("06", "12:00"))], request: req(at("06", "12:00")), expected: ok },
  { id: "C02", category: "并发容量冲突", title: "峰值并发超过裁判容量", version: 2, matches: [target(), M("M02", "T-C", "T-D", at("06", "12:00")), M("M03", "T-E", "T-F", at("06", "12:30"))], request: req(at("06", "12:00")), expected: no("HC-06"), review: true },
  { id: "C03", category: "并发容量冲突", title: "相邻时段不累计为同时并发", version: 2, matches: [target(), M("M02", "T-C", "T-D", at("06", "12:00"), "BO1"), M("M03", "T-E", "T-F", at("06", "12:45"), "BO1")], request: req(at("06", "12:00")), expected: ok },

  { id: "D01", category: "前置依赖", title: "后续比赛早于前置比赛计划结束", version: 2, matches: [target("BO3", { prerequisiteMatchId: "P01" }), M("P01", "T-C", "T-D", at("06", "12:00"))], request: req(at("06", "12:30")), expected: no("HC-05"), limitations: ["当前规则只比较计划时间，不检查前置比赛是否实际完赛。"] },
  { id: "D02", category: "前置依赖", title: "晋级队伍未确定但时间依赖满足", version: 2, matches: [M("M01", "WINNER-P01", "TBD", at("07", "16:00"), "BO3", { prerequisiteMatchId: "P01" }), M("P01", "T-C", "T-D", at("06", "12:00"))], request: req(at("06", "13:30")), expected: ok, limitations: ["晋级队伍尚未确定；只说明计划时间关系可行，不能生成实名队伍通知。"] },

  // V01 原为「提交后赛程版本变化 → 报 HC-01」。2026-10-09 起不再按版本号拦截：
  // 版本号是全局的，申请从提交到负责人批复之间赛程几乎一定变过，按它拦截会**必然误报**，
  // 还会把真正该看的冲突盖掉。现在改为按当前赛程判这个申请自己的时间 —— 它不冲突，应当通过。
  // 类别仍归「赛程版本过期」：这个测试维度本身还在，只是结论从「拦」变成「不拦」。
  { id: "V01", category: "赛程版本过期", title: "提交后赛程版本变化不再拦截（改按当前赛程判定）", version: 3, matches: [target()], request: req(at("07", "14:00")), expected: ok, review: true },
  { id: "V02", category: "赛程版本过期", title: "已批准申请被重复审批", operation: "重复审批", version: 3, matches: [target()], request: req(at("07", "14:00"), { basedOnVersion: 3 }), expected: { decision: "无需重复处理", approved: null, codes: ["WF-01"] }, limitations: ["这是流程幂等校验，不属于时间规则冲突。"] },

  // X01 的 HC-01 随 V01 一起去掉（版本变化不再计入冲突），其余三项不变：
  // 未确认 HC-02、冻结 HC-08、越界 HC-07。
  { id: "X01", category: "复合冲突", title: "未确认、冻结且越界", version: 3, matches: [target("BO1", { frozen: true })], request: req(at("06", "11:00"), { basedOnVersion: 2, teamBConfirmed: false }), expected: no("HC-02", "HC-08", "HC-07") },
  { id: "X02", category: "复合冲突", title: "队伍重叠且峰值并发超限", version: 2, matches: [target(), M("M02", "T-A", "T-C", at("06", "12:00")), M("M03", "T-D", "T-E", at("06", "12:00"))], request: req(at("06", "12:00")), expected: no("HC-06", "HC-04") },
  { id: "X03", category: "复合冲突", title: "依赖、队伍和容量同时冲突", version: 2, matches: [target("BO3", { prerequisiteMatchId: "P01" }), M("P01", "T-C", "T-D", at("06", "12:00")), M("M02", "T-B", "T-E", at("06", "12:00")), M("M03", "T-F", "T-G", at("06", "12:00"))], request: req(at("06", "12:30")), expected: no("HC-06", "HC-04", "HC-05"), limitations: ["只比较前置比赛计划结束时间，不代表前置比赛已经完赛。"], review: true },
];

const steps: Record<string, string> = {
  // HC-01 现在只剩「比赛不存在 / 已完成」两种含义，不再涉及赛程版本号。
  "HC-01": "确认这场比赛存在且尚未完成", "HC-02": "由另一方队长确认同一开始时间",
  "HC-03": "补全该局制的占用时长", "HC-04": "避开相关队伍的其他比赛时段",
  "HC-05": "调整至前置比赛计划结束之后，并核对晋级状态", "HC-06": "调整时间，或修改并重新确认裁判并发容量",
  "HC-07": "在阶段范围内重新选择时间，并计入完整BO时长", "HC-08": "由负责人解除冻结后重新校验",
};

function flowState(c: Case): ScheduleState {
  const matches: ScheduleMatch[] = c.matches.map((m) => ({ ...m, phase: "评测阶段", teamAName: m.teamAId, teamBName: m.teamBId, status: m.startTime ? "已排期" : "待排期", prerequisiteId: m.prerequisiteMatchId }));
  return { config: c.config ?? cfg, configConfirmed: true, version: c.version, matches, versions: [], notifications: [], requests: [{ id: "REQ-APPROVED", matchId: c.request.matchId, newStartTime: c.request.newStartTime, reason: "评测", teamAConfirmed: true, teamBConfirmed: true, basedOnVersion: c.request.basedOnVersion, submittedAt: "2026-10-05T12:00:00.000Z", status: "已批准", conflicts: [] }] };
}

function evaluate(c: Case) {
  if (c.operation === "重复审批") {
    const result = approveRequestOp(flowState(c), "REQ-APPROVED", c.config ?? cfg).result;
    return {
      decision: "无需重复处理" as Decision,
      approved: null,
      conflicts: [{
        code: result === null ? "WF-01" : "WF-ERROR",
        message: result === null ? "申请已经处理，不重复写入赛程" : "重复审批保护失效",
      }],
    };
  }
  const result = validateReschedule(c.request, c.matches, c.version, c.config ?? cfg);
  return { decision: (result.approved ? "可进入人工审批" : "暂不可批准") as Decision, approved: result.approved, conflicts: result.conflicts };
}

function baseline(c: Case, actual: ReturnType<typeof evaluate>) {
  const targetMatch = c.matches.find((m) => m.id === c.request.matchId);
  const bo = targetMatch?.boType ?? "BO3";
  const end = computeEndTime(c.request.newStartTime, bo, c.config ?? cfg);
  const header = `${c.request.matchId}｜${bo}｜${c.request.newStartTime}—${end}｜申请v${c.request.basedOnVersion}/当前v${c.version}`;
  if (actual.decision === "无需重复处理") return { ruleDecision: actual.decision, summary: `${header}\n该申请已经处理，不重复更新赛程。`, nextSteps: [], notificationDrafts: [], uncertainty: c.limitations ?? [] };
  if (actual.approved) return { ruleDecision: actual.decision, summary: `${header}\n未发现硬约束冲突，等待赛事负责人审批。`, nextSteps: ["核对双方确认与现场裁判安排后，由负责人决定是否批准"], notificationDrafts: [], uncertainty: c.limitations ?? [] };
  const nextSteps = [...new Set(actual.conflicts.map((x) => steps[x.code]).filter(Boolean))];
  return {
    ruleDecision: actual.decision,
    summary: `${header}\n${actual.conflicts.map((x) => `${x.code}：${x.message}`).join("；")}`,
    nextSteps,
    notificationDrafts: targetMatch?.teamAId === "TBD" || targetMatch?.teamBId === "TBD" ? [] : [{ role: "双方队长", content: `【约赛待调整】${c.request.matchId} 当前时间暂不能进入审批。${actual.conflicts.map((x) => x.message).join("；")}。请调整后重新提交。` }],
    uncertainty: c.limitations ?? [],
  };
}

const reviewedReferences: Record<string, { explanation: string; action: string }> = {
  A02: {
    explanation: "M01 的候选时间通过硬约束检查，可进入负责人审批；当前尚未形成正式赛程。",
    action: "审批前核对双方队长确认状态及裁判安排；负责人批准后更新正式赛程并发布通知。",
  },
  T01: {
    explanation: "T-A 在候选时段已有 M02，同一支队伍不能同时参加两场比赛；裁判数量不能解除该冲突。",
    action: "双方重新协商不与 M02 重叠的时间，再次提交校验。",
  },
  C02: {
    explanation: "12:30—13:30 将同时进行 3 场比赛，超过当前 2 场的裁判容量。",
    action: "优先调整 M01 时间；如确有额外裁判，负责人先修改并重新确认并发容量，再重新校验。",
  },
  V01: {
    explanation: "该申请基于 v2，当前正式赛程为 v3，不能沿用原校验结果。",
    action: "查看 v3 中 M01 及相关比赛的最新时间，再按当前版本重新提交。",
  },
  X03: {
    explanation: "M01 同时存在三项阻塞：峰值并发超过裁判容量、T-B 与 M02 时间重叠、开始时间早于前置比赛 P01 的计划结束时间。",
    action: "在 P01 计划结束后，避开 T-B 的既有赛程并控制同时比赛数，再重新提交；P01 是否实际完赛由负责人核对。",
  },
};

function referenceStandard(c: Case, actual: ReturnType<typeof evaluate>) {
  const reviewed = reviewedReferences[c.id];
  if (reviewed) {
    return { status: "已冻结", provenance: "负责人逐条审核", ...reviewed };
  }
  if (actual.decision === "无需重复处理") {
    return {
      status: "已冻结", provenance: "按负责人确认口径推导",
      explanation: "该申请已处理，重复审批不应再次修改赛程或生成新版本。",
      action: "保留当前赛程状态，不执行重复操作。",
    };
  }
  if (actual.approved) {
    const targetMatch = c.matches.find((match) => match.id === c.request.matchId);
    const teamsPending = targetMatch?.teamAId === "TBD" || targetMatch?.teamBId === "TBD";
    return {
      status: "已冻结", provenance: "按负责人确认口径推导",
      explanation: `候选时间未发现硬约束冲突，可进入负责人审批；${c.limitations?.join("；") || "当前尚未形成正式赛程。"}`,
      action: teamsPending
        ? "待晋级队伍确定后核对双方确认状态与裁判安排，再由负责人决定是否批准。"
        : "核对双方确认状态与现场裁判安排，由负责人决定是否批准；批准后才更新赛程并发布通知。",
    };
  }
  return {
    status: "已冻结", provenance: "按负责人确认口径推导",
    explanation: [
      actual.conflicts.map((conflict) => `${conflict.code}：${conflict.message}`).join("；"),
      ...(c.limitations ?? []),
    ].join("；"),
    action: [...new Set(actual.conflicts.map((conflict) => steps[conflict.code]).filter(Boolean))].join("；"),
  };
}

const expectedDistribution: Record<Category, number> = { 可批准时间: 4, 超出赛事时间范围: 3, 队伍时间冲突: 3, 并发容量冲突: 3, 前置依赖: 2, 赛程版本过期: 2, 复合冲突: 3 };
const distribution = Object.fromEntries(Object.keys(expectedDistribution).map((key) => [key, 0])) as Record<Category, number>;
let failures = 0;
const outputCases = cases.map((c) => {
  distribution[c.category] += 1;
  const actual = evaluate(c);
  const actualCodes = actual.conflicts.map((x) => x.code);
  const pass = actual.approved === c.expected.approved && actual.decision === c.expected.decision && JSON.stringify(actualCodes) === JSON.stringify(c.expected.codes);
  if (!pass) failures += 1;
  return { ...c, config: c.config ?? cfg, actual, engineCheck: pass ? "通过" : "失败", templateBaseline: baseline(c, actual), referenceStandard: referenceStandard(c, actual), futureAiOutput: null, errorLabels: [], ownerScore: null };
});
if (cases.length !== 20 || cases.filter((c) => c.review).length !== 5) failures += 1;
for (const [category, count] of Object.entries(expectedDistribution)) if (distribution[category as Category] !== count) failures += 1;
const artifact = {
  datasetVersion: "0.1",
  status: "已冻结，等待模型运行",
  createdAt: "2026-08-26",
  frozenAt: "2026-08-26",
  purpose: "比较固定模板与未来AI输出；规则结论只来自确定性规则与流程状态。",
  referenceProvenance: { ownerReviewed: 5, derivedFromOwnerPolicy: 15 },
  referencePolicy: [
    "校验通过不等于已批准或已生效",
    "同一队伍时间重叠不可由增加裁判解除",
    "复合冲突必须完整列出",
    "不得把计划时间依赖表述成实际完赛状态",
  ],
  prohibitedUses: ["不得用AI输出替换规则结论", "不得自动审批", "不得把推导答案表述为负责人逐条撰写"],
  distribution,
  checks: { total: cases.length, passed: outputCases.filter((c) => c.engineCheck === "通过").length, failed: failures },
  cases: outputCases,
};

if (process.argv.includes("--write")) {
  const outputPath = join(process.cwd(), "docs", "05-规则与AI验证", "评测数据", "首轮20例_模板基线.json");
  const modelInputPath = join(process.cwd(), "docs", "05-规则与AI验证", "评测数据", "模型输入_20例.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  const modelInput = {
    datasetVersion: artifact.datasetVersion,
    inputContract: "只根据以下结构化事实解释既定规则结果，不得自行判断或改变规则结论。",
    cases: outputCases.map((item) => ({
      id: item.id,
      title: item.title,
      currentVersion: item.version,
      config: item.config,
      matches: item.matches,
      request: item.request,
      ruleResult: item.actual,
      knownLimitations: item.limitations ?? [],
    })),
  };
  writeFileSync(modelInputPath, `${JSON.stringify(modelInput, null, 2)}\n`, "utf8");
  console.log(`已写入：${outputPath}`);
  console.log(`模型输入：${modelInputPath}`);
}
console.log(`AI评测基线：${artifact.checks.passed}/${artifact.checks.total}，失败 ${failures}`);
console.log(`负责人逐条审核：${cases.filter((c) => c.review).map((c) => c.id).join("、")}`);
if (failures > 0) process.exit(1);
