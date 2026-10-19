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
  async () => getSiteConfig(),
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
