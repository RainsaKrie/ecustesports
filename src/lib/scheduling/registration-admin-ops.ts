import {
  MAX_COACH,
  MAX_SUBSTITUTE,
  POSITIONS,
  TEAM_SIZE,
  type Position,
  type RegistrationAuditLog,
  type RegistrationPlayer,
  type RegistrationSnapshot,
  type RegistrationState,
} from "./registration-data";
import { normalizeRegistrationState } from "./registration-data";
import { addMemberOp, createTeamOp } from "./registration-ops";

export type ReviewStatus = NonNullable<RegistrationPlayer["reviewStatus"]>;
export type RosterRole = NonNullable<RegistrationPlayer["role"]>;

export interface AdminRegistrationResult {
  ok: boolean;
  message: string;
  state: RegistrationState;
}

function snapshot(state: RegistrationState): RegistrationSnapshot {
  return structuredClone({
    players: state.players,
    teams: state.teams,
    teamRequests: state.teamRequests ?? [],
    playerRegistrationClosed: state.playerRegistrationClosed,
    teamRegistrationClosed: state.teamRegistrationClosed,
    frozen: state.frozen,
  });
}

function sameSnapshot(left: RegistrationSnapshot, right: RegistrationSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function commit(
  state: RegistrationState,
  next: RegistrationState,
  action: string,
  summary: string,
  reason?: string,
): AdminRegistrationResult {
  const before = snapshot(state);
  const after = snapshot(next);
  if (sameSnapshot(before, after)) return { ok: false, message: "没有产生任何修改。", state };
  const log: RegistrationAuditLog = {
    id: `REGLOG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    summary,
    reason: reason?.trim() || undefined,
    actor: "赛事负责人",
    createdAt: new Date().toISOString(),
    before,
    after,
  };
  return {
    ok: true,
    message: summary,
    state: { ...next, operationLogs: [log, ...(state.operationLogs ?? [])].slice(0, 20) },
  };
}

function fail(state: RegistrationState, message: string): AdminRegistrationResult {
  return { ok: false, message, state };
}

function reopenPlayerTeam(state: RegistrationState, playerId: string) {
  const teamId = state.players.find((player) => player.id === playerId)?.teamId;
  if (!teamId) return state.teams;
  return state.teams.map((team) => team.id === teamId && team.status === "已冻结" ? { ...team, status: "报名中" as const } : team);
}

export function createTeamAdminOp(
  rawState: RegistrationState,
  input: { name: string; captainId: string },
): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const captain = state.players.find((player) => player.id === input.captainId);
  if (captain?.reviewStatus !== "已通过") return fail(state, "队长必须先审核通过。");
  const result = createTeamOp(state, input);
  if (!result.ok || !result.state || !result.team) return fail(state, result.message ?? "代建队伍失败。");
  return commit(state, result.state, "create-team", `代建队伍 ${result.team.name}`);
}

export function assignPlayerAdminOp(
  rawState: RegistrationState,
  input: { teamId: string; playerId: string; role: RosterRole },
): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const player = state.players.find((candidate) => candidate.id === input.playerId);
  if (player?.reviewStatus !== "已通过") return fail(state, "选手必须先审核通过。");
  const result = addMemberOp(state, input);
  if (!result.ok || !result.state) return fail(state, result.message ?? "加入队伍失败。");
  const team = result.team ?? state.teams.find((candidate) => candidate.id === input.teamId);
  return commit(state, result.state, "assign-player", `${player?.gameId ?? "选手"} 加入 ${team?.name ?? "队伍"}（${input.role}）`);
}

export function removePlayerFromTeamAdminOp(
  rawState: RegistrationState,
  input: { playerId: string; replacementCaptainId?: string; reason: string },
): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const player = state.players.find((candidate) => candidate.id === input.playerId);
  const team = player?.teamId ? state.teams.find((candidate) => candidate.id === player.teamId) : undefined;
  if (!player || !team) return fail(state, "选手当前不在任何队伍。");
  if (!input.reason.trim()) return fail(state, "移出名单必须填写原因。");
  const remainingIds = team.memberIds.filter((id) => id !== player.id);
  if (team.captainId === player.id && remainingIds.length > 0 && !remainingIds.includes(input.replacementCaptainId ?? "")) {
    return fail(state, "移出队长前必须从现有成员中指定新队长。");
  }
  const next = {
    ...state,
    players: state.players.map((candidate) => candidate.id === player.id ? { ...candidate, teamId: undefined, role: undefined, status: "已报名" as const } : candidate),
    teams: state.teams.map((candidate) => candidate.id === team.id ? {
      ...candidate,
      captainId: candidate.captainId === player.id ? (input.replacementCaptainId ?? "") : candidate.captainId,
      memberIds: remainingIds,
      status: remainingIds.length === 0 ? "已退赛" as const : "报名中" as const,
    } : candidate),
  };
  return commit(state, next, "remove-player", `${player.gameId} 从 ${team.name} 移出名单`, input.reason);
}

export function reviewPlayerAdminOp(
  rawState: RegistrationState,
  input: { playerId: string; reviewStatus: ReviewStatus; reason?: string },
): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const player = state.players.find((candidate) => candidate.id === input.playerId);
  if (!player) return fail(state, "选手不存在。");
  const allowed: ReviewStatus[] = ["待审核", "已通过", "需修改", "已拒绝"];
  if (!allowed.includes(input.reviewStatus)) return fail(state, "审核状态不合法。");
  const next = {
    ...state,
    players: state.players.map((candidate) => candidate.id === player.id ? { ...candidate, reviewStatus: input.reviewStatus } : candidate),
    teams: input.reviewStatus === "已通过" ? state.teams : reopenPlayerTeam(state, player.id),
  };
  return commit(state, next, "review-player", `${player.gameId}：审核状态改为${input.reviewStatus}`, input.reason);
}

export function updatePlayerAdminOp(
  rawState: RegistrationState,
  input: { playerId: string; name: string; studentId: string; gameId: string; rank: string; qq?: string; phone?: string; positions?: string[]; intro?: string; reason?: string },
): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const player = state.players.find((candidate) => candidate.id === input.playerId);
  if (!player) return fail(state, "选手不存在。");
  const name = input.name.trim();
  const studentId = input.studentId.trim();
  const gameId = input.gameId.trim();
  const rank = input.rank.trim();
  if (!name || !studentId || !gameId || !rank) return fail(state, "姓名、学号、游戏 ID 和段位不能为空。");
  const qq = input.qq?.trim().slice(0, 60);
  const phone = input.phone?.trim().slice(0, 60);
  if (!qq || !phone) return fail(state, "QQ 号和手机号不能为空。");
  const positions = (input.positions ?? [])
    .filter((item): item is Position => POSITIONS.includes(item as Position))
    .slice(0, POSITIONS.length);
  if (positions.length === 0) return fail(state, "请至少选择一个擅长位置。");
  if (state.players.some((candidate) => candidate.id !== player.id && candidate.gameId.toLowerCase() === gameId.toLowerCase())) {
    return fail(state, "该游戏 ID 已被其他选手使用。");
  }
  const nextPlayer: RegistrationPlayer = {
    ...player,
    name: name.slice(0, 40),
    studentId: studentId.slice(0, 40),
    gameId: gameId.slice(0, 40),
    rank: rank.slice(0, 20),
    qq,
    phone,
    positions,
    intro: input.intro?.trim().slice(0, 500) || undefined,
  };
  return commit(state, { ...state, players: state.players.map((candidate) => candidate.id === player.id ? nextPlayer : candidate) }, "update-player", `更正 ${player.gameId} 的报名资料`, input.reason);
}

export function withdrawPlayerAdminOp(
  rawState: RegistrationState,
  input: { playerId: string; replacementCaptainId?: string; reason: string },
): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const player = state.players.find((candidate) => candidate.id === input.playerId);
  if (!player) return fail(state, "选手不存在。");
  if (player.status === "已退赛") return fail(state, "该选手已经退赛。");
  if (!input.reason.trim()) return fail(state, "退赛必须填写原因。");
  const team = player.teamId ? state.teams.find((candidate) => candidate.id === player.teamId) : undefined;
  const remainingIds = team?.memberIds.filter((id) => id !== player.id) ?? [];
  if (team?.captainId === player.id && remainingIds.length > 0 && !remainingIds.includes(input.replacementCaptainId ?? "")) {
    return fail(state, "队长退赛前必须从现有成员中指定新队长。");
  }
  const nextTeams = state.teams.map((candidate) => {
    if (candidate.id !== team?.id) return candidate;
    return {
      ...candidate,
      captainId: candidate.captainId === player.id ? (input.replacementCaptainId ?? "") : candidate.captainId,
      memberIds: remainingIds,
      status: remainingIds.length === 0 ? "已退赛" as const : "报名中" as const,
    };
  });
  const next = {
    ...state,
    players: state.players.map((candidate) => candidate.id === player.id ? { ...candidate, status: "已退赛" as const, teamId: undefined, role: undefined } : candidate),
    teams: nextTeams,
    teamRequests: (state.teamRequests ?? []).map((request) => request.playerId === player.id && request.status === "pending" ? { ...request, status: "cancelled" as const, resolvedAt: new Date().toISOString() } : request),
  };
  return commit(state, next, "withdraw-player", `${player.gameId} 退出比赛`, input.reason);
}

export function confirmTeamAdminOp(rawState: RegistrationState, teamId: string): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const team = state.teams.find((candidate) => candidate.id === teamId);
  if (!team) return fail(state, "队伍不存在。");
  if (team.status === "已退赛") return fail(state, "退赛队伍不能确认名单。");
  const members = state.players.filter((player) => player.teamId === team.id && player.status === "已入队");
  const starters = members.filter((player) => player.role === "首发");
  if (starters.length !== TEAM_SIZE) return fail(state, `名单需要恰好 ${TEAM_SIZE} 名首发，当前为 ${starters.length} 名。`);
  const notApproved = members.filter((player) => player.reviewStatus !== "已通过");
  if (notApproved.length > 0) return fail(state, `仍有 ${notApproved.length} 名成员未审核通过。`);
  const next = { ...state, teams: state.teams.map((candidate) => candidate.id === team.id ? { ...candidate, status: "已冻结" as const } : candidate) };
  return commit(state, next, "confirm-team", `确认 ${team.name} 的正式参赛名单`);
}

export function reopenTeamAdminOp(rawState: RegistrationState, teamId: string, reason: string): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const team = state.teams.find((candidate) => candidate.id === teamId);
  if (!team) return fail(state, "队伍不存在。");
  if (team.status !== "已冻结") return fail(state, "只有已确认队伍可以重新开放调整。");
  if (!reason.trim()) return fail(state, "重新开放名单必须填写原因。");
  return commit(state, { ...state, teams: state.teams.map((candidate) => candidate.id === team.id ? { ...candidate, status: "报名中" as const } : candidate) }, "reopen-team", `重新开放 ${team.name} 的名单调整`, reason);
}

export function replacePlayerAdminOp(
  rawState: RegistrationState,
  input: { teamId: string; outgoingPlayerId: string; incomingPlayerId: string; reason: string },
): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  if (!input.reason.trim()) return fail(state, "换人必须填写原因。");
  const team = state.teams.find((candidate) => candidate.id === input.teamId);
  const outgoing = state.players.find((candidate) => candidate.id === input.outgoingPlayerId);
  const incoming = state.players.find((candidate) => candidate.id === input.incomingPlayerId);
  if (!team || team.status === "已退赛") return fail(state, "队伍不存在或已经退赛。");
  if (!outgoing || outgoing.teamId !== team.id) return fail(state, "被替换选手不在该队伍。");
  if (!incoming || incoming.status !== "已报名" || incoming.teamId) return fail(state, "新选手必须是尚未组队的有效报名选手。");
  if (incoming.reviewStatus !== "已通过") return fail(state, "新选手必须先审核通过。");
  const role = outgoing.role ?? "首发";
  const nextPlayers = state.players.map((player) => {
    if (player.id === outgoing.id) return { ...player, teamId: undefined, role: undefined, status: "已报名" as const };
    if (player.id === incoming.id) return { ...player, teamId: team.id, role, status: "已入队" as const };
    return player;
  });
  const nextTeams = state.teams.map((candidate) => candidate.id === team.id ? {
    ...candidate,
    captainId: candidate.captainId === outgoing.id ? incoming.id : candidate.captainId,
    memberIds: candidate.memberIds.map((id) => id === outgoing.id ? incoming.id : id),
  } : candidate);
  return commit(state, { ...state, players: nextPlayers, teams: nextTeams }, "replace-player", `${team.name}：${outgoing.gameId} 更换为 ${incoming.gameId}（${role}）`, input.reason);
}

export function withdrawTeamAdminOp(rawState: RegistrationState, teamId: string, reason: string): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const team = state.teams.find((candidate) => candidate.id === teamId);
  if (!team) return fail(state, "队伍不存在。");
  if (team.status === "已退赛") return fail(state, "队伍已经退赛。");
  if (!reason.trim()) return fail(state, "队伍退赛必须填写原因。");
  const memberIds = new Set(team.memberIds);
  const next = {
    ...state,
    players: state.players.map((player) => memberIds.has(player.id) ? { ...player, teamId: undefined, role: undefined, status: "已报名" as const } : player),
    teams: state.teams.map((candidate) => candidate.id === team.id ? { ...candidate, memberIds: [], status: "已退赛" as const } : candidate),
    teamRequests: (state.teamRequests ?? []).map((request) => request.teamId === team.id && request.status === "pending" ? { ...request, status: "cancelled" as const, resolvedAt: new Date().toISOString() } : request),
  };
  return commit(state, next, "withdraw-team", `${team.name} 退出比赛`, reason);
}

export function toggleRegistrationAdminOp(rawState: RegistrationState, target: "player" | "team"): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  if (target === "player") {
    const closed = !state.playerRegistrationClosed;
    return commit(state, { ...state, playerRegistrationClosed: closed }, "toggle-player-registration", closed ? "截止选手报名" : "重新开放选手报名");
  }
  const closed = !state.teamRegistrationClosed;
  return commit(state, { ...state, teamRegistrationClosed: closed, frozen: closed }, "toggle-team-registration", closed ? "截止队伍申报" : "重新开放队伍申报");
}

export function undoRegistrationAdminOp(rawState: RegistrationState, logId: string): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const latest = (state.operationLogs ?? []).find((log) => !log.undoneAt);
  if (!latest || latest.id !== logId) return fail(state, "只能按时间倒序撤销最近一次尚未撤销的操作。");
  if (!sameSnapshot(snapshot(state), latest.after)) return fail(state, "操作后数据已发生其他变化，为避免覆盖新报名，本次不能自动撤销。");
  const restored: RegistrationState = {
    ...structuredClone(latest.before),
    operationLogs: (state.operationLogs ?? []).map((log) => log.id === latest.id ? { ...log, undoneAt: new Date().toISOString() } : log),
  };
  return { ok: true, message: `已撤销：${latest.summary}`, state: restored };
}

export function rosterCapacity(state: RegistrationState, teamId: string, role: RosterRole): number {
  const count = state.players.filter((player) => player.teamId === teamId && player.role === role).length;
  const limit = role === "首发" ? TEAM_SIZE : role === "替补" ? MAX_SUBSTITUTE : MAX_COACH;
  return limit - count;
}
