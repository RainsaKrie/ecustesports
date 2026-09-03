import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { readEventData, updateEventData } from "@/lib/data-store";
import {
  assignPlayerAdminOp,
  confirmTeamAdminOp,
  createTeamAdminOp,
  deletePlayerAdminOp,
  removePlayerFromTeamAdminOp,
  reopenTeamAdminOp,
  replacePlayerAdminOp,
  resetPlayerTokenAdminOp,
  reviewPlayerAdminOp,
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
): AdminRegistrationResult {
  switch (action) {
    case "reset-player-token": {
      const playerId = text(payload.playerId, 80);
      const credential = issueParticipantToken();
      return resetPlayerTokenAdminOp(state, { playerId, tokenHash: credential.tokenHash, newToken: credential.token });
    }
    case "review-player":
      return reviewPlayerAdminOp(state, {
        playerId: text(payload.playerId, 80),
        reviewStatus: text(payload.reviewStatus, 20) as ReviewStatus,
        reason: text(payload.reason),
      });
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
  return Response.json({ state });
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

    let operation: AdminRegistrationResult | undefined;
    const state = await updateEventData(eventId, "registration", initialRegistration(), (raw) => {
      operation = dispatch(normalizeRegistrationState(raw), action, payload);
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
