import type { EditableEvent } from "@/lib/site-config-schema";

export interface PublicationCheckItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export function publicationChecklist(event: EditableEvent): PublicationCheckItem[] {
  const items: PublicationCheckItem[] = [
    { key: "identity", label: "赛事身份", ok: Boolean(event.name.trim() && event.game.trim() && event.organizer.trim()), detail: "赛事名称、游戏项目和主办方均已填写" },
    { key: "description", label: "玩家简介", ok: event.description.trim().length >= 10, detail: "赛事简介至少 10 个字" },
    { key: "format", label: "赛制配置", ok: event.stageConfigs.length > 0, detail: "至少配置一个可执行赛事阶段" },
    { key: "rules", label: "参赛规则", ok: event.rules.length > 0 && event.rules.every((rule) => rule.title.trim() && rule.detail.trim()), detail: "至少一条标题与内容完整的规则" },
    { key: "rule-review", label: "处罚条款确认", ok: event.rules.every((rule) => rule.emphasis !== "warning" || rule.confirmed !== false), detail: "所有警示及处罚条款均已由负责人确认" },
    { key: "maps", label: "地图池", ok: event.mapPool.length > 0, detail: "至少启用一张地图" },
  ];
  if (event.status === "registration") {
    const datesReady = Boolean(event.registrationStart && event.registrationEnd && event.teamRegistrationEnd)
      && event.registrationStart <= event.registrationEnd
      && event.registrationEnd <= event.teamRegistrationEnd;
    items.push({ key: "registration-dates", label: "报名时间", ok: datesReady, detail: "报名开始 ≤ 选手报名截止 ≤ 队伍申报截止" });
  }
  return items;
}

export function canPublish(event: EditableEvent): boolean {
  return publicationChecklist(event).every((item) => item.ok);
}
