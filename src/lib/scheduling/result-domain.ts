// =====================
// RPT-01 赛果领域类型（对应 ADR v1.0 第 3 节「对象与字段定义」）
// 提交记录与正式赛果分离：只有 accepted 决策才允许触碰正式赛果。
// =====================

import type { GameResult } from "./schedule-data";

export type ResultSource = "manual" | "ai-assisted";

/** 提交记录状态（对应 ADR 状态机） */
export type ResultSubmissionStatus =
  | "draft"
  | "submitted"
  | "needs-review"
  | "accepted"
  | "rejected"
  | "superseded";

/** 单局结果（复用现有 GameResult 结构） */
export type ResultGame = GameResult;

/**
 * 赛果提交记录（ResultSubmission）。
 * 与正式赛果分离：提交记录承载「谁在哪个版本下提交了什么」，正式赛果由 accept 决策触发更新。
 */
export interface ResultSubmission {
  id: string; // 稳定提交 ID，用于幂等
  matchId: string;
  submittedByRefereeId: string;
  basedOnScheduleVersion: number;
  games: ResultGame[];
  /** 系统从逐局比分判定的胜者队伍 ID（提交后即可计算，用于回显给裁判确认） */
  declaredWinnerTeamId: string;
  evidenceIds: string[];
  source: ResultSource;
  status: ResultSubmissionStatus;
  submittedAt: string;
  resolvedAt?: string;
  resolutionReason?: string;
}

/** 赛果决策（ResultDecision） */
export interface ResultDecision {
  id: string;
  submissionId: string;
  decision: "accept" | "reject" | "supersede" | "revert";
  actorType: "admin" | "system";
  actorId: string;
  reason: string; // 必填
  beforeResultVersion: number; // 决策前的正式赛果版本
  afterResultVersion: number; // 决策后的正式赛果版本
  createdAt: string;
}

/**
 * 赛果台账（ResultLedger）：保存所有提交记录与决策，承载审计与撤销。
 * 与 ScheduleState.matches（正式赛果）分离。
 */
export interface ResultLedger {
  submissions: ResultSubmission[];
  decisions: ResultDecision[];
  /** 正式赛果版本计数器，每次 accepted 决策递增，用于 before/afterResultVersion */
  resultVersion: number;
}

/** 一次赛果提交的上下文（MATCH 必须存在的键与字段） */
export interface RPTMatch {
  id: string;
  phase: string;
  round?: string;
  teamAId: string;
  teamBId: string;
  boType: "BO1" | "BO3" | "BO5";
  /** 下游比赛（胜者路径），未排期/已排期由下游比赛的 startTime 与 status 判断 */
  nextMatchId?: string;
  nextSide?: "A" | "B";
  /** 下游败者路径（双败） */
  nextLoserMatchId?: string;
  nextLoserSide?: "A" | "B";
}

/** 提交赛果输入 */
export interface SubmitResultInput {
  matchId: string;
  refereeId: string;
  /**
   * 提交所基于的赛程版本号。
   *
   * **不再作为放行依据**（2026-10-12 起）：版本号是全局的，任何一场报分、BP 完成或改期
   * 都会让它 +1，用它当门槛会让两名裁判同时报不同场次时互相拒掉。放行依据改为
   * `submitResultOp` 里的**逐场前置条件**。这里保留它，只为了让提交记录留下
   * 「这一份是基于哪一版赛程报的」，供管理端复核队列展示。
   */
  basedOnScheduleVersion: number;
  games: ResultGame[];
  evidenceIds?: string[];
  source?: ResultSource;
  /** 稳定提交 ID；不传则由实现生成（幂等要求调用方重试时传同一 ID） */
  submissionId?: string;
  /**
   * 裁判端回传的「我看到的两队队名」，供 `submitResultOp` 做逐场前置条件校验。
   *
   * 两个都不传则不校验 —— 管理端复核裁决、受控更正走的是内部路径，没有这个上下文。
   */
  expectedTeamAName?: string;
  expectedTeamBName?: string;
}

/** 是否强制复核的一场比赛 */
export interface MatchReviewPolicy {
  /** 强制复核的轮次名（半决赛 / 决赛 等），命中即 needs-review */
  forcedRounds: string[];
  /** 情况不明的其他强制复核标记（如「负责人指定」） */
  forceReview: boolean;
}

/** 操作结果（沿用现有 OpResult 风格） */
export type ResultOp<Value = undefined> =
  | { ok: true; value: Value; reason?: string }
  | { ok: false; error: string; code?: string };

/** 下游影响（决策 6 下游恢复矩阵的判定输入与产物） */
export interface DownstreamImpact {
  /** 是否有已排期（但未 BP/未完赛）的下游比赛 */
  hasScheduledDownstream: boolean;
  /** 是否有已 BP 或已完赛的下游比赛 */
  hasProgressedDownstream: boolean;
  /** 受影响的下游比赛 ID 清单 */
  affectedMatchIds: string[];
}

export const FORCED_ROUNDS_DEFAULT = ["半决赛", "决赛"] as const;