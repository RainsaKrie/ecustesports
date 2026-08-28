import { redirect } from "next/navigation";

// 赛制抽签已并入「02 赛程」（对阵图 + 抽签面板）
export default async function FormatRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/events/${id}/schedule`);
}
