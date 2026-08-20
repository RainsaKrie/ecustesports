// =====================
// 公开报名写接口（玩家无需登录）
// 只追加单个选手，不做全量覆盖，避免暴露/篡改队伍与其他选手数据
// =====================

import { readEventData, writeEventData } from "@/lib/data-store";
import { getEvent, getSiteConfig } from "@/lib/site-config";
import { RANK_VALUE } from "@/lib/scheduling/format-data";
import {
  initialRegistration,
  normalizeRegistrationState,
  type RegistrationPlayer,
  type RegistrationState,
} from "@/lib/scheduling/registration-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITS = {
  name: 40,
  studentId: 30,
  gameId: 40,
  rank: 20,
  contact: 60,
  college: 60,
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
    if (!(rank in RANK_VALUE)) {
      return Response.json({ message: "段位不在有效范围内。" }, { status: 400 });
    }
    const qq = text(body.qq, LIMITS.contact);
    const wechat = text(body.wechat, LIMITS.contact);
    const phone = text(body.phone, LIMITS.contact);
    const college = text(body.college, LIMITS.college);
    if (!qq && !wechat && !phone) {
      return Response.json({ message: "请至少填写一种联系方式（QQ / 微信 / 手机号）。" }, { status: 400 });
    }

    // 报名时间窗口校验（与前台一致）
    const config = await getSiteConfig();
    const requestedEventId = text(body.eventId, 60);
    if (requestedEventId && !config.events.some((event) => event.id === requestedEventId)) {
      return Response.json({ message: "赛事不存在或已下线。" }, { status: 404 });
    }
    const event = getEvent(config, requestedEventId);
    const { registrationStart, registrationEnd } = event;
    if (registrationStart && registrationEnd) {
      const now = Date.now();
      const start = new Date(`${registrationStart}T00:00:00`).getTime();
      const end = new Date(`${registrationEnd}T23:59:59`).getTime();
      if (now < start || now > end) {
        return Response.json({ message: "当前不在报名时间内。" }, { status: 403 });
      }
    }

    const state = normalizeRegistrationState(
      await readEventData<RegistrationState>(event.id, "registration", initialRegistration()),
    );
    if (state.playerRegistrationClosed) {
      return Response.json({ message: "选手报名已截止。" }, { status: 403 });
    }

    const player: RegistrationPlayer = {
      id: `P-${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
      name,
      studentId,
      gameId,
      rank,
      ...(qq ? { qq } : {}),
      ...(wechat ? { wechat } : {}),
      ...(phone ? { phone } : {}),
      ...(college ? { college } : {}),
      submittedAt: new Date().toISOString(),
      status: "已报名",
    };

    const next: RegistrationState = { ...state, players: [...state.players, player] };
    await writeEventData(event.id, "registration", next);
    return Response.json({ player, state: next });
  } catch {
    return Response.json({ message: "报名提交失败，请稍后重试。" }, { status: 400 });
  }
}
