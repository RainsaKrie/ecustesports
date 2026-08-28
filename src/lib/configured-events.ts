import type { EsportEvent } from "@/types";
import { mockEvent } from "@/lib/mock-data";
import type { EditableEvent, SiteConfig } from "@/lib/site-config-schema";

function rulesToText(rules: EditableEvent["rules"]): string {
  return rules.map((rule, index) => `${index + 1}. **${rule.title}**：${rule.detail}`).join("\n");
}

export function isEventPublic(event: Pick<EditableEvent, "visibility" | "status">): boolean {
  return event.visibility === "public";
}

export function toConfiguredEvent(event: EditableEvent): EsportEvent {
  return {
    ...mockEvent,
    id: event.id,
    name: event.name,
    game: event.game,
    status: event.status,
    teamCount: event.teamCount,
    teamSize: event.teamSize,
    description: event.description,
    rules: rulesToText(event.rules),
    prizePool: event.prizePool,
    organizer: event.organizer,
    coverColor: event.coverColor,
    posterImage: event.posterImage,
    dateLabel: event.eventDateLabel,
    registrationLabel: event.registrationLabel,
    stageSummary: event.stageSummary,
    preparationSteps: event.preparationSteps,
    rulesList: event.rules,
    mapPool: event.mapPool,
    stageConfigs: event.stageConfigs,
  };
}

export function getConfiguredEvents(config: SiteConfig): EsportEvent[] {
  const published = config.events.filter(isEventPublic);
  const ordered = [...published].sort((a, b) => {
    if (a.id === config.currentEventId) return -1;
    if (b.id === config.currentEventId) return 1;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });
  const events: EsportEvent[] = ordered.map(toConfiguredEvent);

  const archives: EsportEvent[] = config.archives.map((archive) => ({
    ...mockEvent,
    id: archive.id,
    name: archive.name,
    game: archive.game,
    status: "archived",
    description: archive.description,
    coverColor: archive.coverColor,
    posterImage: archive.posterImage,
    dateLabel: "查看历史资料",
    matches: [],
    teams: [],
  }));

  return [...events, ...archives];
}
