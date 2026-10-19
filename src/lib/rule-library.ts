import "server-only";

import { readData, writeData } from "@/lib/data-store";
import { DEFAULT_COMMON_HANDBOOK_RULES } from "@/lib/domains/schedule/format-templates";
import type { EditableRule } from "@/lib/site-config-schema";

const categories: NonNullable<EditableRule["category"]>[] = ["format", "match-day", "conduct", "incident", "appeal"];
const emphases: NonNullable<EditableRule["emphasis"]>[] = ["normal", "important", "warning"];

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeCommonRuleLibrary(value: unknown): EditableRule[] {
  if (!Array.isArray(value)) return normalizeCommonRuleLibrary(DEFAULT_COMMON_HANDBOOK_RULES);
  const rules = value
    .slice(0, 30)
    .map((item) => {
      const raw = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
      const emphasis = emphases.includes(raw.emphasis as NonNullable<EditableRule["emphasis"]>)
        ? raw.emphasis as NonNullable<EditableRule["emphasis"]>
        : "normal";
      return {
        title: text(raw.title, 60),
        detail: text(raw.detail, 500),
        category: categories.includes(raw.category as NonNullable<EditableRule["category"]>)
          ? raw.category as NonNullable<EditableRule["category"]>
          : "conduct" as const,
        emphasis,
        source: "common" as const,
        customized: false,
        confirmed: emphasis !== "warning",
      };
    })
    .filter((rule) => rule.title && rule.detail && rule.category !== "format");
  return rules.length > 0 ? rules : normalizeCommonRuleLibrary(DEFAULT_COMMON_HANDBOOK_RULES);
}

export async function getCommonRuleLibrary(): Promise<EditableRule[]> {
  return normalizeCommonRuleLibrary(await readData("rule-library", DEFAULT_COMMON_HANDBOOK_RULES));
}

export async function saveCommonRuleLibrary(value: unknown): Promise<EditableRule[]> {
  const rules = normalizeCommonRuleLibrary(value);
  await writeData("rule-library", rules);
  return rules;
}
