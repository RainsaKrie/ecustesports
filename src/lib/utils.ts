/** 生成简单 ID */
export function generateId(prefix: string = ""): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** 格式化日期 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** 格式化日期时间 */
export function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 获取赛事状态对应的中文标签和颜色 */
export function getStatusInfo(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    draft: { label: "筹备中", color: "bg-amber-100 text-amber-800" },
    registration: { label: "报名中", color: "bg-blue-100 text-blue-700" },
    ongoing: { label: "进行中", color: "bg-green-100 text-green-700" },
    completed: { label: "已结束", color: "bg-purple-100 text-purple-700" },
    archived: { label: "已归档", color: "bg-gray-100 text-gray-500" },
  };
  return map[status] || { label: status, color: "bg-gray-100 text-gray-700" };
}

/** 获取轮次名称 */
export function getRoundName(round: number, totalRounds: number): string {
  if (round === totalRounds) return "决赛";
  if (round === totalRounds - 1) return "半决赛";
  if (round === totalRounds - 2) return "四分之一决赛";
  return `第 ${round} 轮`;
}

/** 计算单败淘汰赛总轮数 */
export function getTotalRounds(teamCount: number): number {
  return Math.log2(teamCount);
}

/** 队伍状态信息 */
export function getTeamStatusInfo(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    pending: { label: "待审核", color: "bg-yellow-100 text-yellow-700" },
    approved: { label: "已通过", color: "bg-green-100 text-green-700" },
    rejected: { label: "已拒绝", color: "bg-red-100 text-red-700" },
    incomplete: { label: "人数不足", color: "bg-orange-100 text-orange-700" },
  };
  return map[status] || { label: status, color: "bg-gray-100 text-gray-700" };
}

/** 比赛状态信息 */
export function getMatchStatusInfo(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    pending: { label: "等待对手", color: "bg-gray-100 text-gray-600" },
    ready: { label: "待开始", color: "bg-blue-100 text-blue-700" },
    ongoing: { label: "进行中", color: "bg-green-100 text-green-700" },
    completed: { label: "已结束", color: "bg-gray-100 text-gray-500" },
  };
  return map[status] || { label: status, color: "bg-gray-100 text-gray-700" };
}
