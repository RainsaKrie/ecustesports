import { DEFAULT_SITE_CONFIG } from "@/lib/site-config-schema";
import "server-only";

import { unstable_cache } from "next/cache";
import { readEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import {
  initialRegistration,
  normalizeRegistrationState,
  type RegistrationState,
} from "@/lib/domains/registration/data";
import {
  emptySchedule,
  normalizeScheduleState,
  type ScheduleState,
} from "@/lib/domains/schedule/schedule-data";

export const PUBLIC_DATA_REVALIDATE_SECONDS = 5;
export const PUBLIC_CACHE_CONTROL =
  "public, max-age=0, s-maxage=5, stale-while-revalidate=30";

export const getPublicSiteConfig = unstable_cache(
  // 2026-10-20：构建期不允许因为"连不上库"而失败。
  // 实测 Vercel 构建时 `/_not-found` 预渲染 → layout 取站点配置 → DNS 解析不了 Supabase 主机
  // → 整个 build 退出。构建只该产出静态壳，配置在运行时 5 秒后自然刷新为真数据。
  async () => {
    try {
      return await getSiteConfig();
    } catch (error) {
      console.warn("[public-site-config] 读取失败，先用默认配置构建，运行时会重取：", (error as Error)?.message);
      return DEFAULT_SITE_CONFIG;
    }
  },
  ["public-site-config"],
  { revalidate: PUBLIC_DATA_REVALIDATE_SECONDS, tags: ["public-site-config"] },
);

export const getPublicSchedule = unstable_cache(
  async (eventId: string) =>
    normalizeScheduleState(
      await readEventData<ScheduleState>(eventId, "schedule", emptySchedule()),
    ),
  ["public-event-schedule"],
  { revalidate: PUBLIC_DATA_REVALIDATE_SECONDS, tags: ["public-event-schedule"] },
);

export const getPublicRegistration = unstable_cache(
  async (eventId: string) =>
    normalizeRegistrationState(
      await readEventData<RegistrationState>(eventId, "registration", initialRegistration()),
    ),
  ["public-event-registration"],
  { revalidate: PUBLIC_DATA_REVALIDATE_SECONDS, tags: ["public-event-registration"] },
);
