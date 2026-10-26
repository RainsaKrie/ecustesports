// =====================
// 赛事结束后的个人数据清理（2026-10-26，计划 A1）
//
// 用途：赛事办完之后，把报名表里的**个人身份信息**清掉，只保留办赛记录需要的东西。
// 为什么需要：平台要展示给官方看，对方一定会问"学生数据怎么处理"。
// 没有这个入口，就答不出"赛后怎么办"。
//
// 保留什么：
//   - 队伍名、游戏 ID、段位、赛果、名次 —— 这些是**赛事记录**，不是个人身份；
// 清掉什么：
//   - 真实姓名、学号、QQ、手机号、擅长位置、自我介绍 —— 这些是**个人身份**。
//
// ★ 不清队伍归属（teamId）与报名状态：清掉会让"这一届有谁参加过"变得不可查。
// =====================

import type { RegistrationState } from "./data.ts";

/** 清理后被替换成的占位内容（保留字段结构，不破坏表单渲染）。 */
const SCRUBBED_NAME = "已清理";

export type ScrubResult = {
  state: RegistrationState;
  /** 有多少名选手的数据被清理 */
  scrubbedPlayers: number;
};

/**
 * 清理所有选手的个人身份信息。
 *
 * 幂等：重复执行不会改变任何东西（已经清过的还是"已清理"）。
 */
export function scrubPersonalDataOp(state: RegistrationState): ScrubResult {
  let scrubbed = 0;
  const players = state.players.map((player) => {
    // 已经清理过的不必再动，也不计入统计
    const already = player.name === SCRUBBED_NAME && !player.studentId && !player.qq && !player.phone;
    if (already) return player;
    scrubbed += 1;
    return {
      ...player,
      name: SCRUBBED_NAME,
      studentId: "",
      qq: undefined,
      phone: undefined,
      positions: undefined,
      intro: undefined,
    };
  });

  return { state: { ...state, players }, scrubbedPlayers: scrubbed };
}
