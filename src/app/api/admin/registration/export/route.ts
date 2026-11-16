import type { NextRequest } from "next/server";

import { isAdminRequest } from "@/lib/domains/identity/admin-session";
import { readEventData } from "@/lib/data-store";
import { withApiError } from "@/lib/api-error";
import {
  initialRegistration,
  normalizeRegistrationState,
  type RegistrationState,
} from "@/lib/domains/registration/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV 字段转义：含逗号、引号或换行时用双引号包裹，内部双引号翻倍。 */
function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function handleGET(request: NextRequest) {
  if (!isAdminRequest(request)) {
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
      player.reviewStatus ?? "已通过",
      player.status,
      player.submittedAt,
    ].map((value) => csvEscape(value ?? ""));
  });

  // BOM 头让 Excel 正确识别 UTF-8 中文，避免乱码。
  const csv = "\uFEFF" + [headers.join(","), ...rows.map((row) => row.join(","))].join("\r\n");

  /**
   * 文件名必须走 RFC 5987（2026-11-16）。
   *
   * 原先直接写 `filename="报名名单-${eventId}.csv"` —— **HTTP 头只允许 ByteString**，
   * 中文会当场抛 `TypeError: Cannot convert argument to a ByteString`,
   * 于是这个导出接口**每次请求都 500**，按钮点了没反应。
   * 现在给浏览器看的用 `filename*=UTF-8''<百分号编码>`，再留一个纯 ASCII 兜底名。
   */
  const fileName = `报名名单-${eventId}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="roster-${eventId}.csv"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}

export const GET = withApiError(handleGET);
