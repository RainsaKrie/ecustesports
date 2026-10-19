// =====================
// 公开名单可见性（唯一一处规则）
// =====================
//
// 背景（2026-10-03）：报名截止并确认正式名单之后，公开页面应当只呈现正式队伍。
// 未满 5 名首发的队伍、以及已退赛的队伍，在公开页面上「看起来像被删了」，
// 但**一条数据都不动** —— 后台照样看得到、可以撤销、可以作为申诉依据。
//
// 这个文件是「公开页看到什么」的唯一判据：公开接口（/api/public/registration）
// 与管理端预览共用同一份实现，避免两处规则各写一遍后慢慢走歪。
// 类型用的是最小结构（只要求 status / id / teamId），所以两边都能直接用，不需要断言转换。

/** 是否已经进入「只公布正式名单」的阶段。 */
export function isOfficialRosterPublished(input: {
  teams: Array<{ status?: string }>;
  teamRegistrationClosed: boolean;
}): boolean {
  // 组队申报还在进行时，非退赛队伍必须全部公开 —— 玩家靠这份名单找队伍加入。
  if (!input.teamRegistrationClosed) return false;
  // 组队刚截止、负责人还没确认任何队伍时，若立刻只显示已冻结（此刻为 0 支），
  // 公开页会变成「暂无参赛队伍」，比显示全部更糟。此时退回显示全部。
  return input.teams.some((team) => team.status === "已冻结");
}

/**
 * 挑出公开页面能看到的那部分报名数据。
 *
 * - 已退赛的队伍与选手：任何阶段都不公开。
 * - 只公布正式名单的阶段：只公开「已冻结」队伍，以及属于这些队伍的选手。
 *   未满编队伍及其选手、还没组队的选手都不公开（但数据仍在）。
 * - 其余阶段：非退赛的一律公开。
 *
 * 返回的是新数组，不改动传入的数据。
 */
export function selectPublicRoster<
  TTeam extends { id: string; status?: string },
  TPlayer extends { status?: string; teamId?: string },
>(input: {
  teams: TTeam[];
  players: TPlayer[];
  teamRegistrationClosed: boolean;
}): { teams: TTeam[]; players: TPlayer[] } {
  const published = isOfficialRosterPublished(input);
  const teams = input.teams.filter(
    (team) => team.status !== "已退赛" && (!published || team.status === "已冻结"),
  );
  const visibleTeamIds = new Set(teams.map((team) => team.id));
  const players = input.players.filter((player) => {
    if (player.status === "已退赛") return false;
    if (!published) return true;
    return Boolean(player.teamId && visibleTeamIds.has(player.teamId));
  });
  return { teams, players };
}
