import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { readEventData } from "@/lib/data-store";
import {
  initialRegistration,
  normalizeRegistrationState,
  type RegistrationState,
} from "@/lib/scheduling/registration-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdmin(request: NextRequest): boolean {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

/** CSV 字段转义：含逗号、引号或换行时用双引号包裹，内部双引号翻倍。 */
function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return Response.json({ message: "未登录或会话已过期" }, { status: 401 });
  }
  const eventId = request.nextUrl.searchParams.get("eventId")?.trim() ?? "";
  if (!eventId) return Response.json({ message: "缺少赛事 ID" }, { status: 400 });

  const state = normalizeRegistrationState(
    await readEventData<RegistrationState>(eventId, "registration", initialRegistration()),
  );

  const headers = [
    "游戏ID", "姓名", "学号", "段位", "擅长位置", "QQ", "手机号",
    "自我介绍", "队伍", "队内角色", "审核状态", "报名状态", "报名时间",
  ];

  const rows = state.players.map((player) => {
    const team = state.teams.find((candidate) => candidate.id === player.teamId);
    return [
      player.gameId,
      player.name,
      player.studentId,
      player.rank,
      (player.positions ?? []).join("、"),
      player.qq ?? "",
      player.phone ?? "",
      player.intro ?? "",
      team?.name ?? "",
      player.role ?? "",
      player.reviewStatus ?? "待审核",
      player.status,
      player.submittedAt,
    ].map((value) => csvEscape(value ?? ""));
  });

  // BOM 头让 Excel 正确识别 UTF-8 中文，避免乱码。
  const csv = "\uFEFF" + [headers.join(","), ...rows.map((row) => row.join(","))].join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="报名名单-${eventId}.csv"`,
    },
  });
}
