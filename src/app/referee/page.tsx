import RefereeWorkbench from "./RefereeWorkbench";

export const metadata = {
  title: "裁判工作台",
  description: "裁判报分工作台",
};

export default async function RefereePage({ searchParams }: { searchParams: Promise<{ eventId?: string }> }) {
  const { eventId } = await searchParams;
  return <RefereeWorkbench initialEventId={eventId?.trim().slice(0, 60) ?? ""} />;
}
