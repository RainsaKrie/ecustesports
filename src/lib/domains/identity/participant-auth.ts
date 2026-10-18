import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { RegistrationPlayer, RegistrationState } from "@/lib/domains/registration/data";

export function issueParticipantToken(): { token: string; tokenHash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, tokenHash: hashParticipantToken(token) };
}

export function hashParticipantToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readParticipantToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return request.headers.get("x-participant-token")?.trim() ?? "";
}

export function findParticipant(state: RegistrationState, token: string): RegistrationPlayer | undefined {
  if (!token || token.length < 20) return undefined;
  const hash = hashParticipantToken(token);
  return state.players.find((player) => player.manageTokenHash === hash);
}

export function withoutParticipantSecret(player: RegistrationPlayer): RegistrationPlayer {
  const safe = { ...player };
  delete safe.manageTokenHash;
  return safe;
}
