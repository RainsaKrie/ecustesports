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
  type RegistrationTeam,
} from "./registration-data";
import { normalizeRegistrationState } from "./registration-data";
import { addMemberOp, createTeamOp, renameTeamOp, setMemberRoleOp, type PlayerRole } from "./registration-ops";
import { dissolveTeamOp } from "./registration-ops";

export type ReviewStatus = NonNullable<RegistrationPlayer["reviewStatus"]>;
export type RosterRole = NonNullable<RegistrationPlayer["role"]>;

export interface AdminRegistrationResult {
  ok: boolean;
  message: string;
  state: RegistrationState;
  /** 仅重置参赛码时返回的明文新码；不参与持久化，只透传给负责人展示一次。 */
  newToken?: string;
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

export function createTeamAdminOp(
  rawState: RegistrationState,
  input: { name: string; captainId: string; captainRole?: PlayerRole },
): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const captain = state.players.find((player) => player.id === input.captainId);
  if (captain?.reviewStatus !== "已通过") return fail(state, "队长必须先审核通过。");
  const result = createTeamOp(state, input);
  if (!result.ok || !result.state || !result.team) return fail(state, result.message ?? "代建队伍失败。");
  const roleLabel = result.team ? state.players.find((p) => p.id === result.team!.captainId)?.role : undefined;
  return commit(state, result.state, "create-team", `代建队伍 ${result.team.name}（队长 ${roleLabel ?? ""}）`);
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
  // 审核改为「默认通过 + 手动标记需修改」后不再有「待审核」这个动作，
  // 只允许在「已通过」（撤销标记）与「需修改 / 已拒绝」（标记不通过）之间切换。
  const allowed: ReviewStatus[] = ["已通过", "需修改", "已拒绝"];
  if (!allowed.includes(input.reviewStatus)) return fail(state, "审核状态不合法。");
  const next = {
    ...state,
    players: state.players.map((candidate) => candidate.id === player.id ? { ...candidate, reviewStatus: input.reviewStatus } : candidate),
    // 刻意**不动队伍状态**：标记「需修改」只表示这位选手的资料要改，
    // 不该顺手把已确认的名单打回「报名中」——那会让负责人重新确认整支队伍。
  };
  return commit(state, next, "review-player", `${player.gameId}：审核状态改为${input.reviewStatus}`, input.reason);
}

/** 一键全部通过：把被标记为「需修改 / 已拒绝」的有效选手恢复为已通过，只记一条操作记录。 */
export function approveAllPlayersAdminOp(rawState: RegistrationState): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const pending = state.players.filter((player) =>
    player.status !== "已退赛" && (player.reviewStatus === "需修改" || player.reviewStatus === "已拒绝"),
  );
  if (pending.length === 0) return fail(state, "没有被标记为不通过的选手。");
  const pendingIds = new Set(pending.map((player) => player.id));
  const next = {
    ...state,
    players: state.players.map((candidate) =>
      pendingIds.has(candidate.id) ? { ...candidate, reviewStatus: "已通过" as const } : candidate,
    ),
  };
  return commit(state, next, "approve-all-players", `批量通过 ${pending.length} 名选手审核`);
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

export function resetPlayerTokenAdminOp(
  rawState: RegistrationState,
  input: { playerId: string; tokenHash: string; newToken: string },
): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const player = state.players.find((candidate) => candidate.id === input.playerId);
  if (!player) return fail(state, "选手不存在。");
  if (!input.tokenHash || !input.newToken) return fail(state, "生成参赛码失败。");
  const next = {
    ...state,
    players: state.players.map((candidate) => candidate.id === player.id ? { ...candidate, manageTokenHash: input.tokenHash } : candidate),
  };
  const result = commit(state, next, "reset-player-token", `重置 ${player.gameId} 的参赛管理码`);
  return result.ok ? { ...result, newToken: input.newToken } : result;
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

/** 删除选手：彻底移除报名数据，自动腾出队伍位置、移交队长、清理相关组队请求。 */
export function deletePlayerAdminOp(
  rawState: RegistrationState,
  input: { playerId: string },
): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const player = state.players.find((candidate) => candidate.id === input.playerId);
  if (!player) return fail(state, "选手不存在。");
  const team = player.teamId ? state.teams.find((candidate) => candidate.id === player.teamId) : undefined;

  let nextTeams = state.teams;
  if (team) {
    const remainingIds = team.memberIds.filter((id) => id !== player.id);
    // 删除队长时自动移交：优先给队内首发，其次按名单顺序取第一位，队空则无队长。
    const nextCaptainId = team.captainId === player.id
      ? remainingIds.find((id) => state.players.find((candidate) => candidate.id === id)?.role === "首发") ?? remainingIds[0] ?? ""
      : team.captainId;
    nextTeams = state.teams.map((candidate) => candidate.id === team.id ? {
      ...candidate,
      captainId: nextCaptainId,
      memberIds: remainingIds,
      status: remainingIds.length === 0 ? "已退赛" as const : "报名中" as const,
    } : candidate);
  }

  const next = {
    ...state,
    players: state.players.filter((candidate) => candidate.id !== player.id),
    teams: nextTeams,
    teamRequests: (state.teamRequests ?? []).filter((request) =>
      request.playerId !== player.id && request.initiatedByPlayerId !== player.id,
    ),
  };
  return commit(state, next, "delete-player", `删除选手 ${player.gameId}${team ? `（原 ${team.name} ${player.role ?? "成员"}）` : ""}`);
}

/**
 * 一支队伍能否确认（冻结）正式名单；返回 `null` 表示可以，否则返回不能确认的原因。
 *
 * 抽出来是为了让「逐队确认」与「一键确认满编队伍」走同一套判定 ——
 * 两处各写一遍的话，改了一处漏掉另一处就会让批量操作放进不合规的名单。
 */
function confirmTeamBlocker(state: RegistrationState, team: RegistrationTeam): string | null {
  if (team.status === "已退赛") return "退赛队伍不能确认名单。";
  const members = state.players.filter((player) => player.teamId === team.id && player.status === "已入队");
  const starters = members.filter((player) => player.role === "首发");
  if (starters.length !== TEAM_SIZE) return `名单需要恰好 ${TEAM_SIZE} 名首发，当前为 ${starters.length} 名。`;
  const notApproved = members.filter((player) => player.reviewStatus !== "已通过");
  if (notApproved.length > 0) return `仍有 ${notApproved.length} 名成员未审核通过。`;
  return null;
}

export function confirmTeamAdminOp(rawState: RegistrationState, teamId: string): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const team = state.teams.find((candidate) => candidate.id === teamId);
  if (!team) return fail(state, "队伍不存在。");
  const blocker = confirmTeamBlocker(state, team);
  if (blocker) return fail(state, blocker);
  const next = { ...state, teams: state.teams.map((candidate) => candidate.id === team.id ? { ...candidate, status: "已冻结" as const } : candidate) };
  return commit(state, next, "confirm-team", `确认 ${team.name} 的正式参赛名单`);
}

/**
 * 一键确认全部满编队伍：把「恰好 5 名首发且全员资料通过」的报名中队伍一次性冻结，
 * 合并成一条操作记录（一次可撤销）。
 *
 * 不满足条件的队伍只是被跳过，不影响其余队伍 —— 报名截止后常见的状态就是
 * 「36 支满编 + 6 支缺人」，逐队点 36 次没有意义，缺人的那几支本来也冻不了。
 */
export function confirmEligibleTeamsAdminOp(rawState: RegistrationState): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const openTeams = state.teams.filter((team) => team.status === "报名中");
  if (openTeams.length === 0) return fail(state, "没有处于报名中的队伍。");
  const eligible = openTeams.filter((team) => confirmTeamBlocker(state, team) === null);
  if (eligible.length === 0) {
    return fail(state, `${openTeams.length} 支报名中队伍都不满足确认条件（需要恰好 ${TEAM_SIZE} 名首发且全员资料通过）。`);
  }
  const eligibleIds = new Set(eligible.map((team) => team.id));
  const next = {
    ...state,
    teams: state.teams.map((candidate) => eligibleIds.has(candidate.id) ? { ...candidate, status: "已冻结" as const } : candidate),
  };
  const skipped = openTeams.length - eligible.length;
  const summary = skipped > 0
    ? `一键确认 ${eligible.length} 支满编队伍（另有 ${skipped} 支未满编，未确认）`
    : `一键确认 ${eligible.length} 支满编队伍`;
  return commit(state, next, "confirm-eligible-teams", summary);
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

/**
 * 负责人解散队伍：删除队伍对象、全员回池，记审计日志、可撤销。与退赛分开。
 * - 已进对阵图（inBracket）→ 拒绝，只能走整队退赛。
 * - 报名中、或已冻结但未进对阵图（测试/误建清理）→ 可解散。
 */
export function dissolveTeamAdminOp(
  rawState: RegistrationState,
  teamId: string,
  reason: string,
  inBracket = false,
): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const team = state.teams.find((candidate) => candidate.id === teamId);
  if (!team) return fail(state, "队伍不存在。");
  if (inBracket) return fail(state, "该队伍已进入对阵图，不能解散，只能整队退赛。");
  if (team.status === "已退赛") return fail(state, "队伍已经退赛。");
  if (team.status !== "报名中" && team.status !== "已冻结") return fail(state, "只有报名中或已冻结未进对阵图的队伍可以解散。");
  if (!reason.trim()) return fail(state, "解散队伍必须填写原因。");
  const result = dissolveTeamOp(state, { teamId, allowFrozen: team.status === "已冻结" });
  if (!result.ok || !result.state) return fail(state, result.message ?? "解散队伍失败。");
  return commit(state, result.state, "dissolve-team", `解散队伍 ${team.name}（${team.memberIds.length} 人回到未组队）`, reason);
}

/** 负责人修改队名：仅限"报名中"队伍。 */
export function renameTeamAdminOp(
  rawState: RegistrationState,
  input: { teamId: string; name: string; reason: string },
): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const team = state.teams.find((candidate) => candidate.id === input.teamId);
  if (!team) return fail(state, "队伍不存在。");
  if (!input.reason.trim()) return fail(state, "修改队名必须填写原因。");
  const result = renameTeamOp(state, { teamId: input.teamId, name: input.name });
  if (!result.ok || !result.state) return fail(state, result.message ?? "修改队名失败。");
  return commit(state, result.state, "rename-team", `队伍 ${team.name} 更名为 ${result.team?.name ?? input.name}`, input.reason);
}

/** 负责人调整队内角色：仅限"报名中"队伍。 */
export function setMemberRoleAdminOp(
  rawState: RegistrationState,
  input: { playerId: string; role: RosterRole; reason: string },
): AdminRegistrationResult {
  const state = normalizeRegistrationState(rawState);
  const player = state.players.find((candidate) => candidate.id === input.playerId);
  const team = player?.teamId ? state.teams.find((candidate) => candidate.id === player.teamId) : undefined;
  if (!player || !team) return fail(state, "选手当前不在任何队伍。");
  if (!input.reason.trim()) return fail(state, "调整角色必须填写原因。");
  const previousRole = player.role ?? "";
  const result = setMemberRoleOp(state, { teamId: team.id, playerId: input.playerId, role: input.role });
  if (!result.ok || !result.state) return fail(state, result.message ?? "调整角色失败。");
  return commit(state, result.state, "set-member-role", `${player.gameId} 角色由 ${previousRole || "未定"} 调整为 ${input.role}`, input.reason);
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
