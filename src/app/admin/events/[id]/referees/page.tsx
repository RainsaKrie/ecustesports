import RefereeWorkspace from "@/components/admin/RefereeWorkspace";

export const metadata = {
  title: "裁判管理",
  description: "创建、停用、重置裁判与分配比赛",
};

export default async function RefereesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RefereeWorkspace eventId={id} />;
}