import "server-only";

import { DEFAULT_SITE_CONFIG, normalizeSiteConfig, type EditableEvent, type SiteConfig } from "@/lib/site-config-schema";
import { readData, updateData, writeData } from "@/lib/data-store";

export async function getSiteConfig(): Promise<SiteConfig> {
  return normalizeSiteConfig(await readData("site-config", DEFAULT_SITE_CONFIG));
}

export async function saveSiteConfig(value: unknown): Promise<SiteConfig> {
  const config = normalizeSiteConfig({
    ...((typeof value === "object" && value !== null) ? value : {}),
    updatedAt: new Date().toISOString(),
  });
  await writeData("site-config", config);
  return config;
}

/** 串行更新站点配置，防止两位办赛者同时编辑不同赛事时互相覆盖。 */
export async function updateSiteConfig(
  updater: (current: SiteConfig) => SiteConfig | Promise<SiteConfig>,
): Promise<SiteConfig> {
  return updateData("site-config", DEFAULT_SITE_CONFIG, async (stored) => {
    const current = normalizeSiteConfig(stored);
    const next = await updater(current);
    return normalizeSiteConfig({ ...next, updatedAt: new Date().toISOString() });
  });
}

/** 按 id 取赛事；未传 id 的兼容分支只用于首页焦点展示，后台业务必须显式传 id。 */
export function getEvent(config: SiteConfig, eventId?: string | null): EditableEvent {
  const id = eventId && eventId.trim() !== "" ? eventId : config.currentEventId;
  return config.events.find((e) => e.id === id) ?? config.events[0] ?? DEFAULT_SITE_CONFIG.events[0];
}
