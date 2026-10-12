/** 格式化日期 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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
