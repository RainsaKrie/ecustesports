import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SITE_CONFIG, normalizeSiteConfig, type EditableEvent, type SiteConfig } from "@/lib/site-config-schema";

const dataDirectory = path.join(process.cwd(), "data");
const configPath = path.join(dataDirectory, "site-config.json");

export async function getSiteConfig(): Promise<SiteConfig> {
  try {
    const raw = await readFile(configPath, "utf8");
    return normalizeSiteConfig(JSON.parse(raw));
  } catch {
    return DEFAULT_SITE_CONFIG;
  }
}

export async function saveSiteConfig(value: unknown): Promise<SiteConfig> {
  const config = normalizeSiteConfig({
    ...((typeof value === "object" && value !== null) ? value : {}),
    updatedAt: new Date().toISOString(),
  });
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

/** 按 id 取赛事；不传 id 时返回当前赛事；找不到时回退第一个赛事 */
export function getEvent(config: SiteConfig, eventId?: string | null): EditableEvent {
  const id = eventId && eventId.trim() !== "" ? eventId : config.currentEventId;
  return config.events.find((e) => e.id === id) ?? config.events[0] ?? DEFAULT_SITE_CONFIG.events[0];
}
