"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SITE_CONFIG, type EditableEvent, type SiteConfig } from "@/lib/site-config-schema";

export function useCurrentEventConfig() {
  const [event, setEvent] = useState<EditableEvent>(DEFAULT_SITE_CONFIG.events[0]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/site-config", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("配置读取失败")))
      .then((config: SiteConfig) => setEvent(config.events.find((e) => e.id === config.currentEventId) ?? config.events[0]))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // 保留内置配置作为离线兜底，不阻断 BP 或战报页面。
          void error;
        }
      });
    return () => controller.abort();
  }, []);

  return event;
}
