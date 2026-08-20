import { getConfiguredEvents } from "@/lib/configured-events";
import { getSiteConfig } from "@/lib/site-config";
import ScheduleBracket from "@/components/events/ScheduleBracket";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { getStatusInfo } from "@/lib/utils";

interface BracketFullScreenProps {
  params: Promise<{ id: string }>;
}

export default async function BracketFullScreenPage({ params }: BracketFullScreenProps) {
  const { id } = await params;
  const events = getConfiguredEvents(await getSiteConfig());
  const event = events.find((item) => item.id === id) ?? events[0];
  const statusInfo = getStatusInfo(event.status);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 p-6">
      <div className="mx-auto max-w-[1600px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">{event.name}</h1>
              <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
            </div>
            <p className="text-sm text-gray-500 mt-1">对阵图全屏视图</p>
          </div>
          <Button href={`/events/${event.id}`} variant="outline">
            ← 返回赛事详情
          </Button>
        </div>

        {/* Bracket */}
        <div className="border border-gray-200 bg-white p-6">
          <ScheduleBracket />
        </div>
      </div>
    </div>
  );
}
