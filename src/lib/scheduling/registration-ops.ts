// =====================
// 报名与队伍状态流转纯函数（可测试）
// 供公开组队接口与后台共用：建队（队长自动入队首发）、成员入队（角色与人数上限校验）
// =====================

import type { RegistrationState, RegistrationTeam } from "./registration-data";
import { TEAM_SIZE, MAX_SUBSTITUTE, MAX_COACH } from "./registration-data";

export type PlayerRole = "首发" | "替补" | "教练";

export interface TeamOpResult<T = never> {
  ok: boolean;
  message?: string;
  state?: RegistrationState;
  team?: RegistrationTeam;
  value?: T;
}

const MAX_NAME_LENGTH = 40;

function memberCounts(state: RegistrationState, teamId: string) {
  const members = state.players.filter((p) => p.teamId === teamId);
  return {
    starters: members.filter((m) => m.role === "首发").length,
    subs: members.filter((m) => m.role === "替补").length,
    coaches: members.filter((m) => m.role === "教练").length,
  };
}

/** 建队：队长必须已在选手池，按所选角色入队（默认首发） */
export function createTeamOp(
  state: RegistrationState,
  input: { name: string; captainId: string; captainRole?: PlayerRole },
): TeamOpResult<RegistrationTeam> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `队伍名称不能为空且不超过 ${MAX_NAME_LENGTH} 字` };
  }
  if (state.teams.some((t) => t.name === name)) {
    return { ok: false, message: "已有同名队伍，请换个名字" };
  }
  // 建队不设数量上限：报名阶段允许队伍数超出赛制所需，
  // 最终签位由抽签环节的队数区间校验（resolveStagedDrawGate）把关，
  // 而不是在建队时就把人挡在门外。
  const captain = state.players.find((p) => p.id === input.captainId);
  if (!captain) {
    return { ok: false, message: "队长不存在，请先完成报名" };
  }
  if (captain.status !== "已报名") {
    return { ok: false, message: "该选手已在其他队伍或已退赛" };
  }
  const captainRole = input.captainRole ?? "首发";
  if (captainRole !== "首发" && captainRole !== "替补" && captainRole !== "教练") {
    return { ok: false, message: "队内角色不合法" };
  }

  const id = `T-${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const team: RegistrationTeam = {
    id,
    name,
    captainId: captain.id,
    memberIds: [captain.id],
    status: "报名中",
    createdAt: new Date().toISOString(),
  };
  const next: RegistrationState = {
    ...state,
    teams: [...state.teams, team],
    players: state.players.map((p) =>
      p.id === captain.id ? { ...p, teamId: id, role: captainRole, status: "已入队" as const } : p,
    ),
  };
  return { ok: true, state: next, team, value: team };
}

/** 成员入队：校验队伍状态、选手状态、角色与人数上限 */
export function addMemberOp(
  state: RegistrationState,
  input: { teamId: string; playerId: string; role: PlayerRole },
): TeamOpResult<RegistrationTeam> {
  const team = state.teams.find((t) => t.id === input.teamId);
  if (!team) {
    return { ok: false, message: "队伍不存在" };
  }
  if (team.status !== "报名中") {
    return { ok: false, message: "队伍已冻结，不能再调整成员" };
  }
  const player = state.players.find((p) => p.id === input.playerId);
  if (!player) {
    return { ok: false, message: "选手不存在" };
  }
  if (player.status !== "已报名") {
    return { ok: false, message: "该选手已在其他队伍或已退赛" };
  }
  if (input.role !== "首发" && input.role !== "替补" && input.role !== "教练") {
    return { ok: false, message: "队内角色不合法" };
  }

  const counts = memberCounts(state, team.id);
  if (input.role === "首发" && counts.starters >= TEAM_SIZE) {
    return { ok: false, message: `首发已满 ${TEAM_SIZE} 人` };
  }
  if (input.role === "替补" && counts.subs >= MAX_SUBSTITUTE) {
    return { ok: false, message: `替补最多 ${MAX_SUBSTITUTE} 人` };
  }
  if (input.role === "教练" && counts.coaches >= MAX_COACH) {
    return { ok: false, message: `教练最多 ${MAX_COACH} 人` };
  }

  const next: RegistrationState = {
    ...state,
    players: state.players.map((p) =>
      p.id === player.id ? { ...p, teamId: team.id, role: input.role, status: "已入队" as const } : p,
    ),
    teams: state.teams.map((t) =>
      t.id === team.id
        ? { ...t, memberIds: t.memberIds.includes(player.id) ? t.memberIds : [...t.memberIds, player.id] }
        : t,
    ),
  };
  const updatedTeam = next.teams.find((t) => t.id === team.id);
  return { ok: true, state: next, team: updatedTeam, value: updatedTeam };
}

/** 队员退出：仅限"报名中"队伍；队长不能单独退出（应解散）。选手回到未组队，清理其 pending 组队请求。 */
export function leaveTeamOp(
  state: RegistrationState,
  input: { playerId: string },
): TeamOpResult {
  const player = state.players.find((p) => p.id === input.playerId);
  if (!player) return { ok: false, message: "选手不存在" };
  if (!player.teamId) return { ok: false, message: "你尚未加入任何队伍" };
  const team = state.teams.find((t) => t.id === player.teamId);
  if (!team) return { ok: false, message: "队伍不存在" };
  if (team.status !== "报名中") return { ok: false, message: "队伍已冻结，不能再退出" };
  if (team.captainId === player.id) return { ok: false, message: "队长不能直接退出，请解散队伍" };

  const resolvedAt = new Date().toISOString();
  const next: RegistrationState = {
    ...state,
    players: state.players.map((p) =>
      p.id === player.id ? { ...p, teamId: undefined, role: undefined, status: "已报名" as const } : p,
    ),
    teams: state.teams.map((t) =>
      t.id === team.id ? { ...t, memberIds: t.memberIds.filter((id) => id !== player.id) } : t,
    ),
    teamRequests: (state.teamRequests ?? []).map((request) =>
      request.playerId === player.id && request.status === "pending"
        ? { ...request, status: "cancelled" as const, resolvedAt }
        : request,
    ),
  };
  return { ok: true, state: next };
}

/** 队长/负责人解散：默认仅限"报名中"队伍；allowFrozen 为真时已冻结（未进对阵图）队伍也可解散。删除队伍对象，全员回到未组队，清理该队 pending 组队请求。 */
export function dissolveTeamOp(
  state: RegistrationState,
  input: { teamId: string; allowFrozen?: boolean },
): TeamOpResult {
  const team = state.teams.find((t) => t.id === input.teamId);
  if (!team) return { ok: false, message: "队伍不存在" };
  if (team.status === "已退赛") return { ok: false, message: "队伍已退赛" };
  if (team.status !== "报名中" && !(input.allowFrozen && team.status === "已冻结")) {
    return { ok: false, message: "队伍已冻结，不能再解散" };
  }
  const memberIds = new Set(team.memberIds);
  const resolvedAt = new Date().toISOString();
  const next: RegistrationState = {
    ...state,
    players: state.players.map((p) =>
      memberIds.has(p.id) ? { ...p, teamId: undefined, role: undefined, status: "已报名" as const } : p,
    ),
    teams: state.teams.filter((t) => t.id !== team.id),
    teamRequests: (state.teamRequests ?? []).map((request) =>
      request.teamId === team.id && request.status === "pending"
        ? { ...request, status: "cancelled" as const, resolvedAt }
        : request,
    ),
  };
  return { ok: true, state: next };
}

/** 队名修改：仅限"报名中"队伍；非空、≤40 字、不与其它队伍重名。 */
export function renameTeamOp(
  state: RegistrationState,
  input: { teamId: string; name: string },
): TeamOpResult<RegistrationTeam> {
  const team = state.teams.find((t) => t.id === input.teamId);
  if (!team) return { ok: false, message: "队伍不存在" };
  if (team.status !== "报名中") return { ok: false, message: "队伍已冻结，不能再改名" };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `队伍名称不能为空且不超过 ${MAX_NAME_LENGTH} 字` };
  }
  if (name === team.name) return { ok: false, message: "队名未发生变化" };
  if (state.teams.some((t) => t.id !== team.id && t.name === name)) {
    return { ok: false, message: "已有同名队伍，请换个名字" };
  }
  const next: RegistrationState = {
    ...state,
    teams: state.teams.map((t) => (t.id === team.id ? { ...t, name } : t)),
  };
  const updatedTeam = next.teams.find((t) => t.id === team.id);
  return { ok: true, state: next, team: updatedTeam, value: updatedTeam };
}

/** 改队内角色：仅限"报名中"队伍；改自己或任意成员（由调用方校验权限），目标角色须有空位。 */
export function setMemberRoleOp(
  state: RegistrationState,
  input: { teamId: string; playerId: string; role: PlayerRole },
): TeamOpResult<RegistrationTeam> {
  const team = state.teams.find((t) => t.id === input.teamId);
  if (!team) return { ok: false, message: "队伍不存在" };
  if (team.status !== "报名中") return { ok: false, message: "队伍已冻结，不能再调整角色" };
  const player = state.players.find((p) => p.id === input.playerId);
  if (!player || player.teamId !== team.id) return { ok: false, message: "该选手不在队伍中" };
  if (input.role !== "首发" && input.role !== "替补" && input.role !== "教练") {
    return { ok: false, message: "队内角色不合法" };
  }
  if (player.role === input.role) return { ok: false, message: "角色未发生变化" };

  const counts = memberCounts(state, team.id);
  // 目标角色当前人数（该选手不算在这个目标角色里，除非它本来就是目标角色——但上面已拦掉同角色）
  const targetCount = counts[
    input.role === "首发" ? "starters" : input.role === "替补" ? "subs" : "coaches"
  ];
  const limit = input.role === "首发" ? TEAM_SIZE : input.role === "替补" ? MAX_SUBSTITUTE : MAX_COACH;
  if (targetCount >= limit) {
    return { ok: false, message: `${input.role}已满，不能再调整` };
  }

  const next: RegistrationState = {
    ...state,
    players: state.players.map((p) =>
      p.id === player.id ? { ...p, role: input.role } : p,
    ),
  };
  const updatedTeam = next.teams.find((t) => t.id === team.id);
  return { ok: true, state: next, team: updatedTeam, value: updatedTeam };
}
