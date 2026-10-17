// =====================
// 公开报名写接口（玩家无需登录）
// 只追加单个选手，不做全量覆盖，避免暴露/篡改队伍与其他选手数据
// =====================

import { updateEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { issueParticipantToken, withoutParticipantSecret } from "@/lib/domains/identity/participant-auth";
import { isKnownRank, normalizePositions } from "@/lib/games";
import {
  initialRegistration,
  normalizeRegistrationState,
  type RegistrationPlayer,
  type RegistrationState,
} from "@/lib/scheduling/registration-data";
import { isEventPublic } from "@/lib/configured-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITS = {
  name: 40,
  studentId: 30,
  gameId: 40,
  rank: 20,
  contact: 60,
  intro: 500,
};

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 20_000) {
      return Response.json({ message: "报名信息过长，请检查后重试。" }, { status: 413 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const name = text(body.name, LIMITS.name);
    const studentId = text(body.studentId, LIMITS.studentId);
    const gameId = text(body.gameId, LIMITS.gameId);
    const rank = text(body.rank, LIMITS.rank);
    if (!name || !studentId || !gameId || !rank) {
      return Response.json({ message: "姓名、学号、游戏 ID 和段位为必填项。" }, { status: 400 });
    }
    if (!isKnownRank(rank)) {
      return Response.json({ message: "段位不在有效范围内。" }, { status: 400 });
    }
    const qq = text(body.qq, LIMITS.contact);
    const phone = text(body.phone, LIMITS.contact);
    const positions = normalizePositions(body.positions);
    const intro = text(body.intro, LIMITS.intro);
    if (!qq || !phone) {
      return Response.json({ message: "QQ 号和手机号为必填项。" }, { status: 400 });
    }
    if (positions.length === 0) {
      return Response.json({ message: "请至少选择一个擅长位置。" }, { status: 400 });
    }

    // 报名时间窗口校验（与前台一致）
    const config = await getSiteConfig();
    const requestedEventId = text(body.eventId, 60);
    if (requestedEventId && !config.events.some((event) => event.id === requestedEventId)) {
      return Response.json({ message: "赛事不存在或已下线。" }, { status: 404 });
    }
    const event = config.events.find((item) => item.id === requestedEventId);
    if (!event || !isEventPublic(event) || event.status === "archived") {
      return Response.json({ message: "赛事不存在或尚未公开。" }, { status: 404 });
    }
    if (event.status !== "registration") {
      return Response.json({ message: "当前赛事未开放报名。" }, { status: 403 });
    }
    const { registrationStart, registrationEnd } = event;
    if (registrationStart && registrationEnd) {
      const now = Date.now();
      const start = new Date(`${registrationStart}T00:00:00`).getTime();
      const end = new Date(`${registrationEnd}T23:59:59`).getTime();
      if (now < start || now > end) {
        return Response.json({ message: "当前不在报名时间内。" }, { status: 403 });
      }
    }

    const credential = issueParticipantToken();
    const player: RegistrationPlayer = {
      id: `P-${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
      name,
      studentId,
      gameId,
      rank,
      qq,
      phone,
      positions,
      ...(intro ? { intro } : {}),
      submittedAt: new Date().toISOString(),
      status: "已报名",
      manageTokenHash: credential.tokenHash,
    };
    let rejection = "";
    await updateEventData<RegistrationState>(event.id, "registration", initialRegistration(), (stored) => {
      const state = normalizeRegistrationState(stored);
      if (state.playerRegistrationClosed) {
        rejection = "选手报名已截止。";
        return state;
      }
      if (state.players.some((item) => item.studentId.toLowerCase() === studentId.toLowerCase())) {
        rejection = "该学号已经报名，请使用学号和报名手机号找回参赛信息。";
        return state;
      }
      if (state.players.some((item) => item.gameId.toLowerCase() === gameId.toLowerCase())) {
        rejection = "该游戏 ID 已经提交过报名。";
        return state;
      }
      return { ...state, players: [...state.players, player] };
    });
    if (rejection) return Response.json({ message: rejection }, { status: 409 });
    return Response.json({ player: withoutParticipantSecret(player), manageToken: credential.token });
  } catch {
    return Response.json({ message: "报名提交失败，请稍后重试。" }, { status: 400 });
  }
}
