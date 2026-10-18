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
    // 状态色统一：全站只有一个彩色（品牌红），其余用中性档位。
    // 原先这里用了 amber / blue / green / purple / gray 五个互不相干的色相，
    // 一页里出现两三种就"花"了（2026-10-18 按负责人"颜色统一"的要求改）。
    draft: { label: "筹备中", color: "bg-[var(--adm-surface-3)] text-[var(--adm-text-soft)]" },
    registration: { label: "报名中", color: "bg-[var(--adm-surface-3)] text-[var(--adm-text)]" },
    ongoing: { label: "进行中", color: "bg-[var(--adm-red-soft)] text-[var(--adm-red-text)]" },
    completed: { label: "已结束", color: "bg-[var(--adm-surface-2)] text-[var(--adm-text-soft)]" },
    archived: { label: "已归档", color: "bg-[var(--adm-surface-3)] text-[var(--adm-text-mute)]" },
  };
  return map[status] || { label: status, color: "bg-[var(--adm-surface-3)] text-[var(--adm-text-soft)]" };
}
