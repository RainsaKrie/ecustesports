// =====================
// 用例：改期闭环（reschedule）
//
// 架构里的 L2 —— **唯一允许跨领域的地方**，只做编排：读 identity 的身份、读 registration 的队伍、
// 读 schedule 的模式与状态、调 schedule 的 ops 写入。不含任何 HTTP 概念（不碰 Response、
// 不读 cookie 对象），只接收已经解析好的输入、返回一个结果对象。
//
// 为什么要这层：这段编排原先写在 `app/api/public/schedule/request/route.ts` 里，
// 路由同时承担"解析请求 / 鉴权编排 / 事务写入 / 状态码映射"四件事。
// 抽出来之后，路由只剩"解析 → 调 → 返回"，编排逻辑可以单测、也可以被别处复用。
//
// 行为与抽取前**逐字一致**（消息、状态码、事务变换都没改）。
// =====================

import { readEventData, updateEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { isEventPublic } from "@/lib/configured-events";
import { captainNegotiationRefusal, scheduleModeOf } from "@/lib/domains/schedule/schedule-mode";
import { findParticipant } from "@/lib/domains/identity/participant-auth";
import {
  initialRegistration,
  normalizeRegistrationState,
  type RegistrationState,
} from "@/lib/domains/registration/data";
import { emptySchedule, normalizeScheduleState, type ScheduleState } from "@/lib/domains/schedule/schedule-data";
import {
  resolveCaptainRequestOp,
  stampScheduleVersion,
  submitCaptainRequestOp,
  type CaptainRequestResult,
} from "@/lib/domains/schedule/schedule-ops";

export interface UseCaseResult<T = CaptainRequestResult> {
  /** HTTP 状态码的语义由这里给出，但**不在这里生成 Response** —— 那是路由的活 */
  status: number;
  body: T | { message: string };
}

/** 上下文的两种形态（扁平判别式）：成功带回 teamId，失败带回状态码与一句话。 */
type RescheduleContext =
  | { ok: true; teamId: string }
  | { ok: false; status: number; message: string };

/**
 * 跨域编排：确认赛事公开、认出参赛者、确认他确实是本队队长、确认当前模式允许协商。
 * 失败时直接返回带状态码的结果，成功时返回队长所属队伍。
 */
export async function resolveRescheduleContext(
  eventId: string,
  participantToken: string,
): Promise<RescheduleContext> {
  const config = await getSiteConfig();
  const event = config.events.find((item) => item.id === eventId && isEventPublic(item) && item.status !== "archived");
  if (!event) return { ok: false, status: 404, message: "赛事不存在或尚未公开。" };

  const registration = normalizeRegistrationState(
    await readEventData<RegistrationState>(eventId, "registration", initialRegistration()),
  );
  const player = findParticipant(registration, participantToken);
  if (!player) return { ok: false, status: 401, message: "参赛管理码无效。" };

  const team = player.teamId ? registration.teams.find((item) => item.id === player.teamId) : undefined;
  if (!team || team.captainId !== player.id) {
    return { ok: false, status: 403, message: "只有本场参赛队伍的队长可以操作约赛时间。" };
  }

  // 固定比赛时间模式：队伍侧没有任何协商入口。
  // 这里**必须真的拒绝**，只藏界面入口挡不住直接调接口的人。
  const negotiationRefusal = captainNegotiationRefusal(scheduleModeOf(event));
  if (negotiationRefusal) return { ok: false, status: 403, message: negotiationRefusal };

  return { ok: true, teamId: team.id };
}

export interface SubmitRescheduleInput {
  eventId: string;
  participantToken: string;
  matchId: string;
  newStartTime: string;
  reason: string;
}

/** 队长提交一条约赛（改期）申请 */
export async function submitRescheduleRequest(input: SubmitRescheduleInput): Promise<UseCaseResult> {
  if (!input.eventId || !input.matchId || !input.newStartTime || Number.isNaN(new Date(input.newStartTime).getTime())) {
    return { status: 400, body: { message: "请填写完整、有效的比赛时间。" } };
  }

  const context = await resolveRescheduleContext(input.eventId, input.participantToken);
  if (!context.ok) return { status: context.status, body: { message: context.message } };

  let result: CaptainRequestResult = { ok: false, message: "约赛申请创建失败。" };
  await updateEventData<ScheduleState>(input.eventId, "schedule", emptySchedule(), (stored) => {
    const state = normalizeScheduleState(stored);
    const output = submitCaptainRequestOp(
      state,
      {
        matchId: input.matchId,
        newStartTime: input.newStartTime.length === 16 ? `${input.newStartTime}:00` : input.newStartTime,
        reason: input.reason,
        proposedByTeamId: context.teamId,
      },
      state.config,
    );
    result = output.value ?? result;
    return stampScheduleVersion(state, output.state);
  });
  return { status: result.ok ? 200 : result.validation ? 409 : 400, body: result };
}

export interface DecideRescheduleInput {
  eventId: string;
  participantToken: string;
  requestId: string;
  decision: "accept" | "reject";
}

/** 队长处理对方的申请（接受 / 拒绝） */
export async function decideRescheduleRequest(input: DecideRescheduleInput): Promise<UseCaseResult> {
  const context = await resolveRescheduleContext(input.eventId, input.participantToken);
  if (!context.ok) return { status: context.status, body: { message: context.message } };

  let result: CaptainRequestResult = { ok: false, message: "约赛申请处理失败。" };
  await updateEventData<ScheduleState>(input.eventId, "schedule", emptySchedule(), (stored) => {
    const state = normalizeScheduleState(stored);
    const output = resolveCaptainRequestOp(
      state,
      { requestId: input.requestId, actorTeamId: context.teamId, decision: input.decision },
      state.config,
    );
    result = output.value ?? result;
    return stampScheduleVersion(state, output.state);
  });
  return { status: result.ok ? 200 : result.validation ? 409 : 400, body: result };
}
