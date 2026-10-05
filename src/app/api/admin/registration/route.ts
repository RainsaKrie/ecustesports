import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { readEventData, updateEventData } from "@/lib/data-store";
import {
  approveAllPlayersAdminOp,
  assignPlayerAdminOp,
  confirmEligibleTeamsAdminOp,
  confirmTeamAdminOp,
  createPlayerAdminOp,
  createTeamAdminOp,
  deletePlayerAdminOp,
  dissolveTeamAdminOp,
  removePlayerFromTeamAdminOp,
  renameTeamAdminOp,
  reopenTeamAdminOp,
  replacePlayerAdminOp,
  resetPlayerTokenAdminOp,
  reviewPlayerAdminOp,
  setMemberRoleAdminOp,
  toggleRegistrationAdminOp,
  undoRegistrationAdminOp,
  updatePlayerAdminOp,
  withdrawPlayerAdminOp,
  withdrawTeamAdminOp,
  type AdminRegistrationResult,
  type ReviewStatus,
  type RosterRole,
} from "@/lib/scheduling/registration-admin-ops";
import { issueParticipantToken } from "@/lib/participant-auth";
import {
  initialRegistration,
  normalizeRegistrationState,
  type RegistrationState,
} from "@/lib/scheduling/registration-data";
import { emptySchedule, normalizeScheduleState, bracketTeamIds, type ScheduleState } from "@/lib/scheduling/schedule-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdmin(request: NextRequest): boolean {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function bodyObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function dispatch(
  state: RegistrationState,
  action: string,
  payload: Record<string, unknown>,
  inBracketTeamIds: Set<string>,
): AdminRegistrationResult {
  switch (action) {
    case "reset-player-token": {
      const playerId = text(payload.playerId, 80);
      const credential = issueParticipantToken();
      return resetPlayerTokenAdminOp(state, { playerId, tokenHash: credential.tokenHash, newToken: credential.token });
    }
    case "create-player": {
      // 代录选手同时要发参赛码：选手本人没走报名流程，拿不到平台发的码，
      // 这里生成一次明文码透传给负责人，由他转交。库里只落 tokenHash。
      const credential = issueParticipantToken();
      const result = createPlayerAdminOp(state, {
        name: text(payload.name, 40),
        studentId: text(payload.studentId, 40),
        gameId: text(payload.gameId, 40),
        rank: text(payload.rank, 20),
        qq: text(payload.qq, 60),
        phone: text(payload.phone, 60),
        positions: arrayOfStrings(payload.positions),
        intro: text(payload.intro, 500),
        teamId: text(payload.teamId, 80) || undefined,
        role: (text(payload.role, 20) || undefined) as RosterRole | undefined,
        reason: text(payload.reason),
      });
      if (!result.ok) return result;
      const playerId = result.state.players.find(
        (player) => player.gameId.toLowerCase() === text(payload.gameId, 40).toLowerCase(),
      )?.id;
      const withToken = playerId
        ? {
            ...result,
            state: {
              ...result.state,
              players: result.state.players.map((player) =>
                player.id === playerId ? { ...player, manageTokenHash: credential.tokenHash } : player,
              ),
            },
          }
        : result;
      return { ...withToken, newToken: credential.token };
    }
    case "review-player":
      return reviewPlayerAdminOp(state, {
        playerId: text(payload.playerId, 80),
        reviewStatus: text(payload.reviewStatus, 20) as ReviewStatus,
        reason: text(payload.reason),
      });
    case "approve-all-players":
      return approveAllPlayersAdminOp(state);
    case "update-player":
      return updatePlayerAdminOp(state, {
        playerId: text(payload.playerId, 80),
        name: text(payload.name, 40),
        studentId: text(payload.studentId, 40),
        gameId: text(payload.gameId, 40),
        rank: text(payload.rank, 20),
        qq: text(payload.qq, 60),
        phone: text(payload.phone, 60),
        positions: arrayOfStrings(payload.positions),
        intro: text(payload.intro, 500),
        reason: text(payload.reason),
      });
    case "withdraw-player":
      return withdrawPlayerAdminOp(state, {
        playerId: text(payload.playerId, 80),
        replacementCaptainId: text(payload.replacementCaptainId, 80) || undefined,
        reason: text(payload.reason),
      });
    case "delete-player":
      return deletePlayerAdminOp(state, { playerId: text(payload.playerId, 80) });
    case "create-team":
      return createTeamAdminOp(state, {
        name: text(payload.name, 40),
        captainId: text(payload.captainId, 80),
        captainRole: (text(payload.captainRole, 20) || undefined) as RosterRole | undefined,
      });
    case "assign-player":
      return assignPlayerAdminOp(state, {
        teamId: text(payload.teamId, 80),
        playerId: text(payload.playerId, 80),
        role: text(payload.role, 20) as RosterRole,
      });
    case "remove-player":
      return removePlayerFromTeamAdminOp(state, {
        playerId: text(payload.playerId, 80),
        replacementCaptainId: text(payload.replacementCaptainId, 80) || undefined,
        reason: text(payload.reason),
      });
    case "confirm-team":
      return confirmTeamAdminOp(state, text(payload.teamId, 80));
    case "confirm-eligible-teams":
      return confirmEligibleTeamsAdminOp(state);
    case "reopen-team":
      return reopenTeamAdminOp(state, text(payload.teamId, 80), text(payload.reason));
    case "replace-player":
      return replacePlayerAdminOp(state, {
        teamId: text(payload.teamId, 80),
        outgoingPlayerId: text(payload.outgoingPlayerId, 80),
        incomingPlayerId: text(payload.incomingPlayerId, 80),
        reason: text(payload.reason),
      });
    case "withdraw-team":
      return withdrawTeamAdminOp(state, text(payload.teamId, 80), text(payload.reason));
    case "dissolve-team":
      return dissolveTeamAdminOp(
        state,
        text(payload.teamId, 80),
        text(payload.reason),
        inBracketTeamIds.has(text(payload.teamId, 80)),
      );
    case "rename-team":
      return renameTeamAdminOp(state, {
        teamId: text(payload.teamId, 80),
        name: text(payload.name, 40),
        reason: text(payload.reason),
      });
    case "set-member-role":
      return setMemberRoleAdminOp(state, {
        playerId: text(payload.playerId, 80),
        role: text(payload.role, 20) as RosterRole,
        reason: text(payload.reason),
      });
    case "toggle-player-registration":
      return toggleRegistrationAdminOp(state, "player");
    case "toggle-team-registration":
      return toggleRegistrationAdminOp(state, "team");
    case "undo":
      return undoRegistrationAdminOp(state, text(payload.logId, 100));
    default:
      return { ok: false, message: "不支持的操作。", state };
  }
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  }
  const eventId = text(request.nextUrl.searchParams.get("eventId"), 60);
  if (!eventId) return Response.json({ message: "缺少赛事 ID" }, { status: 400 });
  const state = normalizeRegistrationState(
    await readEventData(eventId, "registration", initialRegistration()),
  );
  const schedule = normalizeScheduleState(
    await readEventData<ScheduleState>(eventId, "schedule", emptySchedule()),
  );
  return Response.json({ state, bracketTeamIds: [...bracketTeamIds(schedule.matches)] });
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  }
  try {
    const body = bodyObject(await request.json().catch(() => null));
    const eventId = text(body.eventId, 60);
    const action = text(body.action, 80);
    const payload = bodyObject(body.payload);
    if (!eventId || !action) {
      return Response.json({ message: "缺少赛事或操作类型" }, { status: 400 });
    }

    // 判断「是否进对阵图」需要赛程数据；在写入报名数据前一次性读好，供 dispatch 使用。
    const schedule = normalizeScheduleState(
      await readEventData<ScheduleState>(eventId, "schedule", emptySchedule()),
    );
    const inBracketTeamIds = bracketTeamIds(schedule.matches);

    let operation: AdminRegistrationResult | undefined;
    const state = await updateEventData(eventId, "registration", initialRegistration(), (raw) => {
      operation = dispatch(normalizeRegistrationState(raw), action, payload, inBracketTeamIds);
      return operation.state;
    });
    if (!operation) return Response.json({ message: "操作未执行" }, { status: 500 });
    return Response.json(
      { message: operation.message, state, ...(operation.newToken ? { newToken: operation.newToken } : {}) },
      { status: operation.ok ? 200 : 400 },
    );
  } catch {
    return Response.json({ message: "操作失败，请稍后重试" }, { status: 400 });
  }
}
