import {
  normalizeRegistrationState,
  type RegistrationPlayer,
  type RegistrationState,
} from "./registration-data";

function normalizeStudentId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export function recoverParticipantAccess(
  rawState: RegistrationState,
  input: { studentId: string; phone: string; tokenHash: string },
): { state: RegistrationState; player?: RegistrationPlayer } {
  const state = normalizeRegistrationState(rawState);
  const studentId = normalizeStudentId(input.studentId);
  const phone = normalizePhone(input.phone);
  if (!studentId || phone.length < 7 || !input.tokenHash) return { state };

  const player = state.players.find((candidate) =>
    candidate.status !== "已退赛"
    && normalizeStudentId(candidate.studentId) === studentId
    && normalizePhone(candidate.phone ?? "") === phone,
  );
  if (!player) return { state };

  const nextPlayer = { ...player, manageTokenHash: input.tokenHash };
  return {
    state: {
      ...state,
      players: state.players.map((candidate) => candidate.id === player.id ? nextPlayer : candidate),
    },
    player: nextPlayer,
  };
}
