// =====================
// 把「模型读出来的东西」翻译成「裁判能用的填表建议」
//
// 输入是模型输出 + 这场比赛的真实上下文（地图序列、双方名单），
// 输出是建议填什么、以及哪些地方需要人看一眼。
//
// ★ 这里最重要的一件事：**用名单校正左右**
//   截图里没有队名，只有玩家昵称。模型只能靠比分数字的颜色去猜哪组是 A——
//   实测它会猜错（同一模型同一图，定向 90% vs 划分 90%，差的正是左右）。
//   但这场比赛的两队名单我们是知道的，把两组昵称拿去比对就能确定方向，
//   于是「模型把左右搞反」这个错误可以在写入前被纠正。
//
//   校正的前提是身份匹配给出确定结论。证据不足时宁可不动，也不猜。
// =====================

import { buildRoster, matchTeamsByIdentity, type TeamRoster } from "./identity-match";
import { checkGroupSanity, type RecognizedResult } from "./result-vision";

export interface RecognizeContext {
  matchId: string;
  /** 第几局（1-based）。由界面上的上传位决定，不靠模型猜。 */
  gameIndex: number;
  boType: string;
  teams: { a: string; b: string };
  /** BP 已确定的地图序列（按局序）。 */
  mapSequence: string[];
  /** 双方登场队员昵称（已去 # 标签）。null 表示拿不到名单。 */
  squads: { a: string[]; b: string[] } | null;
}

export interface RecognizeSuggestion {
  /** 建议填入这一局的比分（已按需校正左右）。null 表示没读出可用数字。 */
  game: { map: string | null; teamAScore: number; teamBScore: number } | null;
  /** 建议填入的地图名（优先用 BP 序列里这一局应打的地图）。 */
  suggestedMap: string | null;
  /**
   * 地图核对结果：
   *   · true  —— 图上读到的地图与 BP 序列一致
   *   · false —— 不一致（可能是传错图、或 BP 记录不对）
   *   · null  —— 无法核对（BP 序列没有这一局，或图上没读到地图名）
   */
  mapMatchesBp: boolean | null;
  /** 身份匹配结论摘要。null 表示没做（缺名单或缺分组）。 */
  identity: {
    status: "matched" | "ambiguous" | "insufficient";
    /** 校正后，模型认定的「第一组」实际是哪支队 */
    firstGroupTeam: "a" | "b" | null;
    /** 是否因为身份匹配而交换了左右 */
    swapped: boolean;
    reasons: string[];
  } | null;
  /**
   * 需要在界面上提示给人的问题。
   * 非空不一定是错误——也可能是「已自动校正，请确认」这类提示。
   */
  issues: string[];
}

/**
 * 生成填表建议。
 *
 * 注意它**不修改模型输出**，而是产出一份「建议」——最终写什么由裁判确认。
 * 这条边界不能破：AI 不绕过裁判确认写赛果。
 */
export function buildRecognizeSuggestion(
  recognized: RecognizedResult | null,
  context: RecognizeContext,
): RecognizeSuggestion {
  const issues: string[] = [];

  if (!recognized) {
    return {
      game: null,
      suggestedMap: null,
      mapMatchesBp: null,
      identity: null,
      issues: ["识别没返回可用结果，请手工填写这一局"],
    };
  }

  // ---- 取本局比分 ----
  // 模型可能返回一局或多局。按上传位对应的局次取；取不到就退化为第一局，
  // 但要在提示里说明，避免「静默用错局」。
  const games = recognized.games ?? [];
  let picked = games[context.gameIndex - 1];
  if (!picked && games.length === 1) {
    picked = games[0];
    if (context.gameIndex !== 1) {
      issues.push(`只读到 1 局的比分，已按本局填入；若不对请手工修改`);
    }
  }
  if (!picked && games.length > 0) {
    issues.push(`读到的局数与本局对不上（读到 ${games.length} 局），请手工核对`);
  }

  // ---- 地图核对 ----
  const expectedMap = context.mapSequence[context.gameIndex - 1] ?? null;
  let mapMatchesBp: boolean | null = null;
  if (expectedMap && picked?.map) {
    mapMatchesBp = picked.map === expectedMap;
    if (!mapMatchesBp) {
      issues.push(
        `图上读到的地图是「${picked.map}」，但 BP 记录里第 ${context.gameIndex} 局应是「${expectedMap}」——` +
          "请确认是否传错了图",
      );
    }
  }

  // ---- 用名单校正左右 ----
  let identity: RecognizeSuggestion["identity"] = null;
  let aScore = picked?.teamAScore ?? null;
  let bScore = picked?.teamBScore ?? null;
  let swapped = false;

  const groups = recognized.groups;
  if (groups) {
    const sanity = checkGroupSanity(groups);
    issues.push(...sanity);
  }

  if (groups && context.squads) {
    const teams: { a: TeamRoster; b: TeamRoster } = {
      a: buildRoster({ teamId: "a", teamName: context.teams.a, players: context.squads.a.map((g) => ({ gameId: g })) }),
      b: buildRoster({ teamId: "b", teamName: context.teams.b, players: context.squads.b.map((g) => ({ gameId: g })) }),
    };
    const matched = matchTeamsByIdentity({
      readGroups: { first: groups.a, second: groups.b },
      teams,
    });

    if (matched.status === "matched" && matched.first && matched.second) {
      // matched.first 说的是「模型认定的第一组（groups.a）」实际属于哪支队
      swapped = matched.first.team === "b";
      identity = {
        status: "matched",
        firstGroupTeam: matched.first.team,
        swapped,
        reasons: matched.reasons,
      };
      if (swapped && aScore !== null && bScore !== null) {
        // 模型把两组搞反了，比分要跟着换回来
        const t = aScore;
        aScore = bScore;
        bScore = t;
        issues.push(
          `已按双方名单校正左右：模型把两支队伍认反了，比分已自动交换。请确认无误`,
        );
      }
      if (matched.reasons.length > 0) issues.push(...matched.reasons);
    } else {
      identity = {
        status: matched.status === "matched" ? "insufficient" : matched.status,
        firstGroupTeam: null,
        swapped: false,
        reasons: matched.reasons,
      };
      // 定向没定下来，不校正，但要把理由带出来
      issues.push(...matched.reasons);
    }
  } else if (groups && !context.squads) {
    issues.push("拿不到双方报名名单，无法自动确定哪一组是哪支队——请自行核对左右");
  }

  const hasScores = aScore !== null && bScore !== null;
  return {
    game: hasScores ? { map: picked?.map ?? null, teamAScore: aScore!, teamBScore: bScore! } : null,
    suggestedMap: expectedMap ?? picked?.map ?? null,
    mapMatchesBp,
    identity,
    issues,
  };
}
