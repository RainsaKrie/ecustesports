// =====================
// 撤销赛果的客户端调用（2026-11-08）
//
// 单独成文件的原因：`useSchedule.ts` 正好卡在 400 行架构上限，往里塞这段 fetch 会越线。
// 逻辑本身很短，但它是唯一能解释「为什么要走专用接口」的地方，值得留注释。
//
// 为什么不用整份快照保存：`/api/data/schedule` 的 `detectScheduleLosses` 会把
// 「抹掉已完成场次的赛果」判成覆盖冲突（409），前端随后 refresh，界面就回弹成「已完成」。
// =====================

export type RevertResultReply = { ok: true } | { ok: false; message: string };

export async function postRevertResult(
  eventId: string,
  matchId: string,
  reason: string,
): Promise<RevertResultReply> {
  const response = await fetch("/api/admin/schedule/revert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, matchId, reason }),
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) return { ok: false, message: body.message ?? "撤销失败，请刷新后重试" };
  return { ok: true };
}
