import type { EditableEvent } from "@/lib/site-config-schema";

const PRE_EVENT_LANGUAGE = /筹备|报名|待公布|即将|敬请期待/;

export function postEventPublicContentIssues(event: EditableEvent, footerStatus: string): string[] {
  if (event.status !== "completed" && event.status !== "archived") return [];

  const issues: string[] = [];
  if (PRE_EVENT_LANGUAGE.test(event.description)) issues.push("首页赛事简介仍为赛前内容");
  if (PRE_EVENT_LANGUAGE.test(footerStatus)) issues.push("页脚状态仍为赛前内容");
  return issues;
}
