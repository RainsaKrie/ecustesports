import type { EsportEvent } from "@/types";
import { mockEvent } from "@/lib/mock-data";
import type { EditableEvent, SiteConfig } from "@/lib/site-config-schema";

function rulesToText(rules: EditableEvent["rules"]): string {
  return rules.map((rule, index) => `${index + 1}. **${rule.title}**：${rule.detail}`).join("\n");
}

export function getConfiguredEvents(config: SiteConfig): EsportEvent[] {
  const currentEvent = config.events.find((e) => e.id === config.currentEventId) ?? config.events[0];
  const current: EsportEvent = {
    ...mockEvent,
    id: currentEvent.id,
    name: currentEvent.name,
    game: currentEvent.game,
    status: currentEvent.status,
    teamCount: currentEvent.teamCount,
    teamSize: currentEvent.teamSize,
    description: currentEvent.description,
    rules: rulesToText(currentEvent.rules),
    prizePool: currentEvent.prizePool,
    organizer: currentEvent.organizer,
    coverColor: currentEvent.coverColor,
    posterImage: currentEvent.posterImage,
    dateLabel: currentEvent.eventDateLabel,
    registrationLabel: currentEvent.registrationLabel,
    stageSummary: currentEvent.stageSummary,
    preparationSteps: currentEvent.preparationSteps,
    rulesList: currentEvent.rules,
  };

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

  return [current, ...archives];
}
