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

const MAX_TEAMS = 32;
const MAX_NAME_LENGTH = 40;

function memberCounts(state: RegistrationState, teamId: string) {
  const members = state.players.filter((p) => p.teamId === teamId);
  return {
    starters: members.filter((m) => m.role === "首发").length,
    subs: members.filter((m) => m.role === "替补").length,
    coaches: members.filter((m) => m.role === "教练").length,
  };
}

/** 建队：队长必须已在选手池，自动成为首发 */
export function createTeamOp(
  state: RegistrationState,
  input: { name: string; captainId: string },
): TeamOpResult<RegistrationTeam> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `队伍名称不能为空且不超过 ${MAX_NAME_LENGTH} 字` };
  }
  if (state.teams.some((t) => t.name === name)) {
    return { ok: false, message: "已有同名队伍，请换个名字" };
  }
  if (state.teams.length >= MAX_TEAMS) {
    return { ok: false, message: `队伍数量已达上限（${MAX_TEAMS} 支）` };
  }
  const captain = state.players.find((p) => p.id === input.captainId);
  if (!captain) {
    return { ok: false, message: "队长不存在，请先完成报名" };
  }
  if (captain.status !== "已报名") {
    return { ok: false, message: "该选手已在其他队伍或已退赛" };
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
      p.id === captain.id ? { ...p, teamId: id, role: "首发" as const, status: "已入队" as const } : p,
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
