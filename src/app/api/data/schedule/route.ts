import { readEventData, updateEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/domains/identity/admin-session";
import { emptySchedule, normalizeScheduleState } from "@/lib/scheduling/schedule-data";
import { resolveSupportedFormat } from "@/lib/scheduling/format-support";
import { autoFillPendingSlots, type StagedFormatState } from "@/lib/scheduling/staged-format";
import { applyScheduleSave, type ScheduleLoss } from "@/lib/scheduling/schedule-ops";
import { initialRegistration, type RegistrationState } from "@/lib/domains/registration/data";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 报分之后自动把资格赛胜者填进入围赛的「待定」席位。
 *
 * 为什么放在保存这一层：**不管从哪条路报的分**（管理端赛程页、裁判端），
 * 最终都会经过这里写一次赛程 —— 在这里补一次，就不会有哪条路漏掉。
 *
 * 条件不满足时原样返回（见 `autoFillPendingSlots`），绝大多数保存动作无事可做。
 */
async function withAutoFilledSlots(eventId: string, state: ReturnType<typeof normalizeScheduleState>) {
  const format = await readEventData<StagedFormatState>(eventId, "format", {});
  const configs = format.stageConfigs ?? [];
  const resolved = resolveSupportedFormat(configs);
  if (resolved.kind !== "staged-playin") return state;

  const registration = await readEventData<RegistrationState>(eventId, "registration", initialRegistration());
  const names = new Map(registration.teams.map((team) => [team.id, team.name]));
  const outcome = autoFillPendingSlots(state.matches, {
    qualifierPhase: resolved.playInStage.name,
    qualifierTeamCount: resolved.playInStage.teamCount,
    teamName: (teamId) => names.get(teamId) ?? "待定",
  });
  if (outcome.filled === 0) return state;
  return { ...state, matches: outcome.matches };
}

async function resolveEventId(request: NextRequest): Promise<string | null> {
  if (!verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value)) return null;
  const fromQuery = request.nextUrl.searchParams.get("eventId")?.trim() ?? "";
  if (!fromQuery) return null;
  const config = await getSiteConfig();
  return config.events.some((event) => event.id === fromQuery) ? fromQuery : null;
}

export async function GET(request: NextRequest) {
  const eventId = await resolveEventId(request);
  if (!eventId) return Response.json({ message: "未登录、赛事不存在或缺少赛事 ID。" }, { status: 401 });
  return Response.json(normalizeScheduleState(await readEventData(eventId, "schedule", emptySchedule())));
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 2_000_000) {
      return Response.json({ message: "数据过大" }, { status: 413 });
    }
    const eventId = await resolveEventId(request);
    if (!eventId) return Response.json({ message: "未登录、赛事不存在或缺少赛事 ID。" }, { status: 401 });
    const expectedVersion = Number(request.headers.get("if-match"));
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return Response.json({ message: "保存请求缺少赛程版本，请刷新后重试" }, { status: 428 });
    }
    const incoming = normalizeScheduleState(await request.json());
    // 报分落库前先补一次入围赛的待定席位（资格赛已全部完成时才会真的动）
    const filled = await withAutoFilledSlots(eventId, incoming);
    const saved = await updateEventData(eventId, "schedule", emptySchedule(), (raw) => {
      const outcome = applyScheduleSave(normalizeScheduleState(raw), filled, expectedVersion);
      if (outcome.kind === "version-conflict") throw new ScheduleVersionConflict();
      if (outcome.kind === "loss") throw new ScheduleLossConflict(outcome.losses);
      return outcome.state;
    });
    return Response.json({ message: "saved", schedule: saved });
  } catch (error) {
    if (error instanceof ScheduleVersionConflict) {
      return Response.json({ message: "赛程已被其他操作更新，请刷新后再提交" }, { status: 409 });
    }
    if (error instanceof ScheduleLossConflict) {
      return Response.json(
        {
          code: "SCHEDULE_LOSS",
          message: `保存被拒绝：这次提交会把别处已经写好的成果覆盖回旧状态（${describeLosses(error.losses)}）。`
            + "赛程已被裁判报分或其他操作更新，请刷新页面后再提交。",
          losses: error.losses,
        },
        { status: 409 },
      );
    }
    return Response.json({ message: "保存失败" }, { status: 400 });
  }
}

class ScheduleVersionConflict extends Error {}

class ScheduleLossConflict extends Error {
  constructor(readonly losses: ScheduleLoss[]) {
    super("保存会覆盖其他路径写入的比赛成果");
  }
}

function describeLosses(losses: ScheduleLoss[]): string {
  return losses.map((loss) => `${loss.matchId} 的${loss.lost.join("、")}`).join("；");
}
