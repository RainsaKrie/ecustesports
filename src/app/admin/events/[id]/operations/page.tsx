import { redirect } from "next/navigation";

// 比赛执行已合并进「赛程与执行」：同一场次列表内完成排期、BP、报分与晋级
export default async function OperationsRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/events/${id}/schedule`);
}
