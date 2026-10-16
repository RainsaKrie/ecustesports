"use client";

import { useState, type ChangeEvent } from "react";
import { SCHEDULE_MODE_LABELS, type ScheduleMode } from "@/lib/scheduling/schedule-mode";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getGameConfig, mapImageOf } from "@/lib/games";

/** 当前游戏的地图目录（数据在 `@/lib/games`）。 */
const MAP_CATALOG = getGameConfig().maps;
import { buildDefaultEventRules } from "@/lib/scheduling/format-templates";
import type { EditableEvent, EditableRule, EditableStep } from "@/lib/site-config-schema";
import { publicationChecklist } from "@/lib/publication-check";
import { Field, Panel, adminInputClass, adminTextareaClass, useAdminConfirm, type AdminBadgeTone } from "@/components/admin/ui";

type ViewKey = "overview" | "event" | "handbook" | "maps" | "public";
type HandbookSection = "steps" | NonNullable<EditableRule["category"]>;
type SaveState = "idle" | "saving" | "saved" | "error";

const inputClass = adminInputClass;
const textareaClass = adminTextareaClass;

const STATUS_OPTIONS: { value: EditableEvent["status"]; label: string }[] = [
  { value: "draft", label: "筹备中" },
  { value: "registration", label: "报名中" },
  { value: "ongoing", label: "比赛中" },
  { value: "completed", label: "已结束" },
  { value: "archived", label: "已归档" },
];

const VIEWS: Array<{ key: ViewKey; index: string; label: string }> = [
  { key: "overview", index: "00", label: "发布概览" },
  { key: "event", index: "01", label: "赛事与报名" },
  { key: "handbook", index: "02", label: "赛事规程" },
  { key: "maps", index: "03", label: "地图与 BP" },
  { key: "public", index: "04", label: "玩家页面" },
];

const HANDBOOK_SECTIONS: Array<{ key: HandbookSection; label: string }> = [
  { key: "steps", label: "参赛程序" },
  { key: "format", label: "竞赛赛制" },
  { key: "match-day", label: "比赛程序" },
  { key: "conduct", label: "竞赛纪律" },
  { key: "incident", label: "技术异常" },
  { key: "appeal", label: "申诉裁决" },
];

const RULE_CATEGORY_OPTIONS = HANDBOOK_SECTIONS.filter((item) => item.key !== "steps") as Array<{
  key: NonNullable<EditableRule["category"]>;
  label: string;
}>;

const SOURCE_LABELS: Record<NonNullable<EditableRule["source"]>, string> = {
  common: "通用规则",
  format: "按赛制预填",
  event: "本届新增",
};

function SourceBadge({ rule }: { rule: EditableRule }) {
  const source = rule.source ?? "event";
  const tone: AdminBadgeTone = source === "format" ? "neutral" : source === "common" ? "neutral" : "active";
  return (
    <span className="adm-chip" data-tone={tone}>
      {SOURCE_LABELS[source]}{rule.customized ? " · 本届已调整" : ""}
    </span>
  );
}

export default function EventSettingsWorkspace({ initialEvent, initialCommonRules, eventCount }: { initialEvent: EditableEvent; initialCommonRules: EditableRule[]; eventCount: number }) {
  const router = useRouter();
  const confirm = useAdminConfirm();
  const [event, setEvent] = useState(initialEvent);
  const [commonPreset, setCommonPreset] = useState(initialCommonRules);
  const [view, setView] = useState<ViewKey>("overview");
  const [handbookSection, setHandbookSection] = useState<HandbookSection>("format");
  const [editingRule, setEditingRule] = useState<number | null>(null);
  const [editingStep, setEditingStep] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [syncingPreset, setSyncingPreset] = useState(false);
  const [eventAction, setEventAction] = useState<"idle" | "archiving" | "deleting">("idle");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  function patchEvent(patch: Partial<EditableEvent>) {
    setEvent((current) => ({ ...current, ...patch }));
    setDirty(true);
    setSaveState("idle");
    setMessage("");
  }

  function updateRule(index: number, patch: Partial<EditableRule>, markCustomized = true) {
    patchEvent({
      rules: event.rules.map((rule, ruleIndex) => ruleIndex === index
        ? { ...rule, ...patch, customized: markCustomized ? true : rule.customized }
        : rule),
    });
  }

  function updateStep(index: number, patch: Partial<EditableStep>) {
    patchEvent({ preparationSteps: event.preparationSteps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) });
  }

  function toggleMap(map: { id: string; name: string }) {
    const active = event.mapPool.some((item) => item.id === map.id);
    patchEvent({ mapPool: active ? event.mapPool.filter((item) => item.id !== map.id) : [...event.mapPool, map] });
  }

  async function uploadPoster(change: ChangeEvent<HTMLInputElement>) {
    const file = change.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("eventId", event.id);
      const response = await fetch("/api/admin/upload", { method: "POST", body: formData });
      const result = await response.json() as { path?: string; message?: string };
      if (!response.ok || !result.path) throw new Error(result.message || "图片上传失败");
      patchEvent({ posterImage: result.path });
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "图片上传失败");
    } finally {
      setUploading(false);
      change.target.value = "";
    }
  }

  async function save() {
    setSaveState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/admin/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id, event }),
      });
      const result = await response.json() as { message?: string; event?: EditableEvent };
      if (!response.ok || !result.event) throw new Error(result.message || "保存失败");
      setEvent(result.event);
      setDirty(false);
      setSaveState("saved");
      setMessage("已保存并同步至玩家侧预览。");
      router.refresh();
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function updatePublication(action: "publish" | "unpublish") {
    if (dirty) {
      setSaveState("error");
      setMessage("请先保存当前修改，再更新公开状态。");
      return;
    }
    setPublishing(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/events/publication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id, action }),
      });
      const result = await response.json() as { message?: string; event?: EditableEvent };
      if (!response.ok || !result.event) throw new Error(result.message || "公开状态更新失败");
      setEvent(result.event);
      setSaveState("saved");
      setMessage(result.message ?? "公开状态已更新");
      router.refresh();
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "公开状态更新失败");
    } finally {
      setPublishing(false);
    }
  }

  async function saveAsCommonPreset() {
    if (dirty) {
      setSaveState("error");
      setMessage("请先保存当前赛事修改，再把通用规则用于以后的赛事。");
      return;
    }
    const commonRules = event.rules.filter((rule) => rule.source === "common");
    if (commonRules.length === 0) {
      setSaveState("error");
      setMessage("当前赛事没有可保存的通用规则。");
      return;
    }
    setSyncingPreset(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/rule-library", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: commonRules }),
      });
      const result = await response.json() as { message?: string; rules?: EditableRule[] };
      if (!response.ok || !result.rules) throw new Error(result.message || "通用规则预设保存失败");
      setCommonPreset(result.rules);
      setSaveState("saved");
      setMessage(result.message ?? "后续赛事通用规则预设已更新");
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "通用规则预设保存失败");
    } finally {
      setSyncingPreset(false);
    }
  }

  async function regenerateRules() {
    const confirmed = await confirm({
      title: "按当前赛制重新生成本届规则？",
      body: "将按当前赛制和通用规则重新生成本届全部规则，已修改及新增的内容会被覆盖。参赛程序不受影响。",
      confirmLabel: "重新生成",
      tone: "danger",
    });
    if (!confirmed) return;
    patchEvent({ rules: buildDefaultEventRules(event.stageConfigs, event.teamSize, commonPreset) });
  }

  async function archiveEvent() {
    if (dirty) {
      setSaveState("error");
      setMessage("请先保存当前修改，再归档赛事。");
      return;
    }
    if (event.status !== "completed") return;
    const confirmed = await confirm({
      title: "归档本届赛事？",
      body: "归档后赛事资料与赛果继续保留，并标记为往届赛事。",
      confirmLabel: "归档赛事",
      tone: "danger",
    });
    if (!confirmed) return;

    setEventAction("archiving");
    setMessage("");
    try {
      const response = await fetch("/api/admin/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id, event: { ...event, status: "archived" } }),
      });
      const result = await response.json() as { message?: string; event?: EditableEvent };
      if (!response.ok || !result.event) throw new Error(result.message || "归档失败");
      setEvent(result.event);
      setSaveState("saved");
      setMessage("赛事已归档，报名、赛程、赛果与 BP 数据均已保留。");
      router.refresh();
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "归档失败");
    } finally {
      setEventAction("idle");
    }
  }

  async function deleteEventPermanently() {
    if (dirty) {
      setSaveState("error");
      setMessage("存在未保存修改，无法执行永久删除。");
      return;
    }
    if (deleteConfirmName.trim() !== event.name) {
      setSaveState("error");
      setMessage("输入的赛事名称不一致。");
      return;
    }

    setEventAction("deleting");
    setMessage("");
    try {
      const response = await fetch("/api/admin/events", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id, confirmName: deleteConfirmName.trim() }),
      });
      const result = await response.json() as { message?: string; deleted?: boolean };
      if (!response.ok || !result.deleted) throw new Error(result.message || "删除失败");
      router.push("/admin");
      router.refresh();
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "删除失败");
      setEventAction("idle");
    }
  }

  const publishChecks = publicationChecklist(event);
  const readyToPublish = publishChecks.every((item) => item.ok);
  const formatRuleCount = event.rules.filter((rule) => rule.source === "format").length;
  const commonRuleCount = event.rules.filter((rule) => rule.source === "common").length;
  const eventRuleCount = event.rules.filter((rule) => rule.source === "event").length;
  const pendingRuleCount = event.rules.filter((rule) => rule.emphasis === "warning" && rule.confirmed === false).length;
  const canArchive = event.status === "completed" && !dirty && eventAction === "idle";
  const deleteEligible = event.visibility === "private"
    && (event.status === "draft" || event.status === "archived")
    && eventCount > 1
    && !dirty;
  const canDelete = deleteEligible && eventAction === "idle";
  const filteredRules = event.rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => (rule.category ?? "conduct") === handbookSection);

  const checkView = (key: string): ViewKey => {
    if (key === "rules" || key === "rule-review") return "handbook";
    if (key === "maps") return "maps";
    if (key === "description") return "public";
    return "event";
  };

  return (
    // 左分组导航 + 右表单（设计文档 4.3）。窄屏自动退化成单列上下堆叠 ——
    // 改造前是 5 个卡片横向滚动，原代码里就留了「滚动条在部分手机上不显示，
    // 用户会以为只有前几个分区」的警告，竖列直接消掉这个问题。
    <div className="grid gap-5 lg:grid-cols-[minmax(11rem,13rem)_1fr] lg:items-start">
      {/* sticky 让右侧长表单滚动时导航不丢。top 用 px 定值：桌面根字号是 150%，
          写成 rem 会按 24px 换算，跟顶栏的 h-16（4rem＝96px）对不上。 */}
      <nav
        aria-label="赛事设置分区"
        className="border border-[var(--adm-line-soft)] bg-[var(--adm-surface)] lg:sticky lg:top-[104px]"
      >
        {VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setView(item.key)}
            className={`flex w-full items-baseline gap-3 border-b border-[var(--adm-line-soft)] px-4 py-3 text-left transition last:border-b-0 lg:border-l-[3px] ${view === item.key ? "bg-[var(--adm-surface-2)] lg:border-l-[var(--adm-red)]" : "lg:border-l-transparent hover:bg-[var(--adm-surface-2)]"}`}
          >
            <span className="text-[length:var(--adm-fs-xs)] font-medium text-[var(--adm-red-text)]">{item.index}</span>
            <span className={`text-[length:var(--adm-fs-md)] font-semibold ${view === item.key ? "text-[var(--adm-text)]" : "text-[var(--adm-text-soft)]"}`}>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* 右栏。下面这些块保持原有缩进没重排 —— 重排会在 CRLF 仓库里产生几百行假 diff，
          审阅成本比缩进不整齐大得多。 */}
      <div className="min-w-0 space-y-5">

      {/* 工具条只留「保存」。原来左边那个「← 返回发布概览」删掉了 ——
          左侧导航第一项就是发布概览，同一动作不留两个入口（设计文档 5.1 / 5.2）。
          左侧写当前分组名，替代原来「返回」按钮占的位置。 */}
      {view !== "overview" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-[var(--adm-line-soft)] bg-[var(--adm-surface)] px-5 py-3">
          <span className="text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text-soft)]">
            {VIEWS.find((item) => item.key === view)?.index} · {VIEWS.find((item) => item.key === view)?.label}
          </span>
          <div className="flex items-center gap-3">
            {message && <span className={`text-[length:var(--adm-fs-md)] font-bold ${saveState === "error" ? "text-[var(--adm-red-text)]" : "text-[var(--adm-ok-text)]"}`}>{message}</span>}
            <button type="button" onClick={save} disabled={!dirty || saveState === "saving" || uploading} className="adm-btn adm-btn--primary adm-btn--md">
              {saveState === "saving" ? "正在保存…" : dirty ? "保存当前修改" : "已保存"}
            </button>
          </div>
        </div>
      )}

      {view === "overview" && (
        <>
          <section className="adm-note border-l-[var(--adm-red)] px-5 py-5">
            <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">发布状态</h2>
                  <span className="adm-chip" data-tone={event.visibility === "public" ? "done" : "attention"}>{event.visibility === "public" ? "已公开" : "未公开"}</span>
                  <span className="adm-chip" data-dot="off">{STATUS_OPTIONS.find((item) => item.value === event.status)?.label}</span>
                </div>
                <p className="mt-2 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">{readyToPublish ? "发布前检查已通过" : `仍有 ${publishChecks.filter((item) => !item.ok).length} 项需要确认`}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {dirty && (
                  <button type="button" onClick={save} disabled={saveState === "saving" || uploading} className="adm-btn adm-btn--danger adm-btn--md">
                    {saveState === "saving" ? "正在保存…" : "保存全部修改"}
                  </button>
                )}
                <Link href={`/events/${event.id}?preview=1`} target="_blank" className="adm-btn adm-btn--secondary adm-btn--md">预览玩家页面</Link>
                {event.visibility === "public" ? (
                  <button type="button" onClick={() => updatePublication("unpublish")} disabled={publishing || dirty} className="adm-btn adm-btn--danger adm-btn--md">从玩家侧撤回</button>
                ) : (
                  <button type="button" onClick={() => updatePublication("publish")} disabled={publishing || dirty || !readyToPublish} className="adm-btn adm-btn--primary adm-btn--md">发布到玩家侧</button>
                )}
              </div>
            </div>
            {dirty && <p className="mt-4 border-t border-[var(--adm-line-soft)] pt-3 text-[length:var(--adm-fs-md)] text-[var(--adm-warn-text)]">存在未保存修改，保存后方可更新公开状态。</p>}
          </section>

          <Panel eyebrow="怎么定时间" title="排期方式">
            <div className="px-5 py-5">
              <div className="flex flex-wrap gap-2">
                {(["open", "fixed"] as ScheduleMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => patchEvent({ scheduleMode: mode })}
                    className={`adm-btn adm-btn--secondary adm-btn--md ${event.scheduleMode === mode ? "border-l-[2px] border-[var(--adm-red)] font-bold" : ""}`}
                  >
                    {event.scheduleMode === mode ? "✓ " : ""}{SCHEDULE_MODE_LABELS[mode]}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">
                {event.scheduleMode === "fixed"
                  ? "固定比赛时间：赛程由你统一排定，队伍侧没有协商入口。抽签发布后不要再改这个设置。"
                  : "自由约赛：队伍在时段窗口内自行协商时间（默认）。待协商的场次数不是你的待办。"}
              </p>
            </div>
          </Panel>

          <Panel eyebrow="发布检查" title="发布前待确认">
            <div className="grid border-l border-t border-[var(--adm-line-soft)] sm:grid-cols-2 lg:grid-cols-3">
              {publishChecks.map((item) => (
                <button key={item.key} type="button" onClick={() => setView(checkView(item.key))} className="flex min-h-24 items-start justify-between gap-4 border-b border-r border-[var(--adm-line-soft)] p-4 text-left hover:bg-[var(--adm-surface-2)]">
                  <div>
                    <p className="text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-text)]">{item.label}</p>
                    <p className="mt-2 text-[length:var(--adm-fs-sm)] leading-[1.65] text-[var(--adm-text-soft)]">{item.detail}</p>
                  </div>
                  <span className={`text-[length:var(--adm-fs-md)] font-medium ${item.ok ? "text-[var(--adm-ok-text)]" : "text-[var(--adm-red-text)]"}`}>{item.ok ? "PASS" : "TODO"}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel eyebrow="配置概览" title="配置摘要">
            <div className="grid border-l border-t border-[var(--adm-line-soft)] md:grid-cols-2">
              <button type="button" onClick={() => setView("event")} className="border-b border-r border-[var(--adm-line-soft)] p-5 text-left hover:bg-[var(--adm-surface-2)]">
                <p className="text-[length:var(--adm-fs-xs)] font-medium text-[var(--adm-red-text)]">01 / 赛事信息</p>
                <h3 className="mt-2 text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">赛事与报名</h3>
                <p className="mt-2 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">{event.name} · {event.teamCount} 队 · {event.registrationStart || "报名时间待定"}</p>
              </button>
              <button type="button" onClick={() => setView("handbook")} className="border-b border-r border-[var(--adm-line-soft)] p-5 text-left hover:bg-[var(--adm-surface-2)]">
                <p className="text-[length:var(--adm-fs-xs)] font-medium text-[var(--adm-red-text)]">02 / 赛事规程</p>
                <h3 className="mt-2 text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">赛事规程</h3>
                <p className="mt-2 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">赛制规则 {formatRuleCount} · 通用规则 {commonRuleCount} · 本届新增 {eventRuleCount}{pendingRuleCount ? ` · ${pendingRuleCount} 条处罚待确认` : ""}</p>
              </button>
              <button type="button" onClick={() => setView("maps")} className="border-b border-r border-[var(--adm-line-soft)] p-5 text-left hover:bg-[var(--adm-surface-2)]">
                <p className="text-[length:var(--adm-fs-xs)] font-medium text-[var(--adm-red-text)]">03 / 地图与 BP</p>
                <h3 className="mt-2 text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">地图与 BP</h3>
                <p className="mt-2 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">已启用 {event.mapPool.length} 张赛事地图</p>
              </button>
              <button type="button" onClick={() => setView("public")} className="border-b border-r border-[var(--adm-line-soft)] p-5 text-left hover:bg-[var(--adm-surface-2)]">
                <p className="text-[length:var(--adm-fs-xs)] font-medium text-[var(--adm-red-text)]">04 / 玩家页面</p>
                <h3 className="mt-2 text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">玩家页面</h3>
                <p className="mt-2 text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)]">简介、奖项与赛事视觉</p>
              </button>
            </div>
          </Panel>

          <Panel eyebrow="赛事管理" title="赛事归档与删除">
            <div className="divide-y divide-[var(--adm-line-soft)] border border-[var(--adm-line-soft)]">
              <div className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center">
                <div>
                  <h3 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">归档为往届赛事</h3>
                  <p className="mt-1 text-[length:var(--adm-fs-md)] font-medium text-[var(--adm-text-soft)]">保留报名、赛程、赛果及 BP 数据，赛事标记为已归档。</p>
                </div>
                <button type="button" onClick={archiveEvent} disabled={!canArchive} className="adm-btn adm-btn--secondary adm-btn--md shrink-0">
                  {event.status === "archived" ? "已归档" : eventAction === "archiving" ? "正在归档…" : event.status === "completed" ? "归档赛事" : "赛事结束后可归档"}
                </button>
              </div>

              <div className="p-4">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-red-text)]">永久删除测试赛事</h3>
                    <p className="mt-1 text-[length:var(--adm-fs-md)] font-medium text-[var(--adm-text-soft)]">报名、队伍、抽签、赛程和 BP 数据将全部删除，无法恢复。</p>
                    {event.visibility === "public" && <p className="mt-2 text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-red-text)]">请先从玩家侧撤回赛事。</p>}
                    {event.visibility === "private" && event.status !== "draft" && event.status !== "archived" && <p className="mt-2 text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-red-text)]">只有筹备中或已归档赛事可以永久删除。</p>}
                    {eventCount <= 1 && <p className="mt-2 text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-red-text)]">系统至少需要保留一场赛事。</p>}
                  </div>
                  <button type="button" onClick={() => { setDeleteConfirmOpen(true); setDeleteConfirmName(""); setMessage(""); }} disabled={!canDelete} className="adm-btn adm-btn--danger adm-btn--md shrink-0">
                    永久删除
                  </button>
                </div>

                {deleteConfirmOpen && deleteEligible && (
                  <div className="adm-note adm-note--danger mt-4">
                    <p className="text-[length:var(--adm-fs-md)] font-semibold text-[var(--adm-red-text)]">输入完整赛事名称确认：{event.name}</p>
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                      <input value={deleteConfirmName} onChange={(change) => setDeleteConfirmName(change.target.value)} autoComplete="off" className={`${inputClass} border-[var(--adm-red-line)]`} />
                      <button type="button" onClick={deleteEventPermanently} disabled={deleteConfirmName.trim() !== event.name || eventAction === "deleting"} className="adm-btn adm-btn--primary adm-btn--md shrink-0">
                        {eventAction === "deleting" ? "正在删除…" : "确认永久删除"}
                      </button>
                      <button type="button" onClick={() => { setDeleteConfirmOpen(false); setDeleteConfirmName(""); }} disabled={eventAction === "deleting"} className="adm-btn adm-btn--secondary adm-btn--md shrink-0">取消</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {message && <p className={`mt-3 text-[length:var(--adm-fs-md)] font-bold ${saveState === "error" ? "text-[var(--adm-red-text)]" : "text-[var(--adm-ok-text)]"}`}>{message}</p>}
          </Panel>
        </>
      )}

      {view === "event" && (
        <Panel eyebrow="基础信息" title="赛事与报名">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="赛事名称"><input value={event.name} onChange={(change) => patchEvent({ name: change.target.value })} className={inputClass} /></Field>
            <Field label="比赛项目"><input value={event.game} onChange={(change) => patchEvent({ game: change.target.value })} className={inputClass} /></Field>
            <Field label="主办方"><input value={event.organizer} onChange={(change) => patchEvent({ organizer: change.target.value })} className={inputClass} /></Field>
            <Field label="赛事阶段"><select value={event.status} onChange={(change) => patchEvent({ status: change.target.value as EditableEvent["status"] })} className={inputClass}>{STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          </div>
          <div className="mt-5 grid border-l border-t border-[var(--adm-line-soft)] sm:grid-cols-3">
            <div className="border-b border-r border-[var(--adm-line-soft)] p-4"><p className="text-[length:var(--adm-fs-sm)] font-bold text-[var(--adm-text-soft)]">参赛规模</p><p className="mt-1 text-[length:var(--adm-fs-lg)] font-semibold">{event.teamCount} 队 / 每队 {event.teamSize} 名首发</p></div>
            <div className="border-b border-r border-[var(--adm-line-soft)] p-4 sm:col-span-2"><p className="text-[length:var(--adm-fs-sm)] font-bold text-[var(--adm-text-soft)]">赛制摘要</p><p className="mt-1 text-[length:var(--adm-fs-lg)] font-semibold leading-[1.75]">{event.stageSummary}</p></div>
          </div>
          <div className="mt-6 grid gap-4 border-t border-[var(--adm-line-soft)] pt-5 md:grid-cols-2">
            <Field label="报名开始日期"><input type="date" value={event.registrationStart} onChange={(change) => patchEvent({ registrationStart: change.target.value })} className={inputClass} /></Field>
            <Field label="选手报名截止"><input type="date" value={event.registrationEnd} onChange={(change) => patchEvent({ registrationEnd: change.target.value })} className={inputClass} /></Field>
            <Field label="队伍申报截止"><input type="date" value={event.teamRegistrationEnd} onChange={(change) => patchEvent({ teamRegistrationEnd: change.target.value })} className={inputClass} /></Field>
            <Field label="比赛时间展示"><input value={event.eventDateLabel} onChange={(change) => patchEvent({ eventDateLabel: change.target.value })} className={inputClass} /></Field>
            <Field label="报名状态文案"><input value={event.registrationLabel} onChange={(change) => patchEvent({ registrationLabel: change.target.value })} className={inputClass} /></Field>
            <Field label="赛事 QQ 群号码"><input value={event.eventQqGroup} onChange={(change) => patchEvent({ eventQqGroup: change.target.value })} placeholder="如 1107657580" className={inputClass} /></Field>
          </div>
        </Panel>
      )}

      {view === "handbook" && (
        <Panel
          eyebrow="规程与规则"
          title="赛事规程"
          actions={<div className="flex flex-wrap gap-2"><button type="button" onClick={saveAsCommonPreset} disabled={syncingPreset} className="adm-btn adm-btn--danger adm-btn--md">{syncingPreset ? "正在保存…" : "保存为以后赛事的通用规则"}</button><button type="button" onClick={() => { void regenerateRules(); }} className="adm-btn adm-btn--secondary adm-btn--md">重新生成本届规则</button></div>}
        >
          <div className="mb-5 grid border-l border-t border-[var(--adm-line-soft)] sm:grid-cols-4">
            <div className="border-b border-r border-[var(--adm-line-soft)] p-3"><p className="text-[length:var(--adm-fs-xs)] text-[var(--adm-text-soft)]">赛制规则</p><p className="mt-1 text-[length:var(--adm-fs-xl)] font-semibold">{formatRuleCount}</p></div>
            <div className="border-b border-r border-[var(--adm-line-soft)] p-3"><p className="text-[length:var(--adm-fs-xs)] text-[var(--adm-text-soft)]">通用规则</p><p className="mt-1 text-[length:var(--adm-fs-xl)] font-semibold">{commonRuleCount}</p></div>
            <div className="border-b border-r border-[var(--adm-line-soft)] p-3"><p className="text-[length:var(--adm-fs-xs)] text-[var(--adm-text-soft)]">本届新增</p><p className="mt-1 text-[length:var(--adm-fs-xl)] font-semibold">{eventRuleCount}</p></div>
            <div className="border-b border-r border-[var(--adm-line-soft)] p-3"><p className="text-[length:var(--adm-fs-xs)] text-[var(--adm-text-soft)]">待确认处罚</p><p className={`mt-1 text-[length:var(--adm-fs-xl)] font-semibold tabular-nums ${pendingRuleCount ? "text-[var(--adm-red-text)]" : "text-[var(--adm-text)]"}`}>{pendingRuleCount}</p></div>
          </div>

          <div className="mb-5 overflow-x-auto border-y border-[var(--adm-line-soft)]">
            <div className="flex min-w-max">
              {HANDBOOK_SECTIONS.map((item) => {
                const count = item.key === "steps" ? event.preparationSteps.length : event.rules.filter((rule) => (rule.category ?? "conduct") === item.key).length;
                // 选中态原来是深墨块（bg-[var(--adm-text)] + 白字），是管理端最后一处深色填充。
                // 改成「白底墨字 + 底部 2px 红条」：结构线负责分隔，品牌红负责指认当前项。
                // 非选中项也占 2px 透明底边，这样切换时文字不会上下跳。
                // ⚠️ `border-b-transparent` 必须写进非选中分支：放进基础类会和选中分支的
                //    `border-b-[var(--adm-red)]` 同时命中，产物里 transparent 排在后面把它盖住，
                //    实测底边色会读成 rgba(0,0,0,0)，红条根本不显示。
                return <button key={item.key} type="button" onClick={() => { setHandbookSection(item.key); setEditingRule(null); setEditingStep(null); }} className={`border-r border-b-2 border-[var(--adm-line-soft)] px-4 py-3 text-[length:var(--adm-fs-md)] font-bold ${handbookSection === item.key ? "border-b-[var(--adm-red)] text-[var(--adm-text)]" : "border-b-transparent text-[var(--adm-text-soft)] hover:bg-[var(--adm-surface-2)]"}`}>{item.label} <span className="ml-1 opacity-60">{count}</span></button>;
              })}
            </div>
          </div>

          {handbookSection === "steps" ? (
            <div className="space-y-2">
              {event.preparationSteps.map((step, index) => (
                <article key={index} className="border border-[var(--adm-line-soft)]">
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="flex items-center gap-4"><span className="text-[length:var(--adm-fs-sm)] font-medium text-[var(--adm-red-text)]">{step.number}</span><h3 className="text-[length:var(--adm-fs-lg)] font-semibold">{step.title}</h3></div>
                    <button type="button" onClick={() => setEditingStep(editingStep === index ? null : index)} className="adm-btn adm-btn--ghost adm-btn--md">{editingStep === index ? "收起" : "编辑"}</button>
                  </div>
                  {editingStep === index && <div className="grid gap-3 border-t border-[var(--adm-line-soft)] bg-[var(--adm-surface-2)] p-4 md:grid-cols-[5rem_12rem_1fr_auto]"><input value={step.number} onChange={(change) => updateStep(index, { number: change.target.value })} className={inputClass} /><input value={step.title} onChange={(change) => updateStep(index, { title: change.target.value })} className={inputClass} /><textarea rows={2} value={step.detail} onChange={(change) => updateStep(index, { detail: change.target.value })} className={textareaClass} /><button type="button" onClick={() => patchEvent({ preparationSteps: event.preparationSteps.filter((_, stepIndex) => stepIndex !== index) })} className="adm-btn adm-btn--danger adm-btn--md self-end">删除</button></div>}
                </article>
              ))}
              <button type="button" onClick={() => { const next = event.preparationSteps.length; patchEvent({ preparationSteps: [...event.preparationSteps, { number: String(next + 1).padStart(2, "0"), title: "新步骤", detail: "待填写" }] }); setEditingStep(next); }} className="adm-btn adm-btn--secondary adm-btn--md border-dashed">＋ 添加参赛步骤</button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredRules.map(({ rule, index }) => (
                <article key={index} className={`border ${rule.confirmed === false ? "border-[var(--adm-line)] bg-[var(--adm-surface-2)]" : "border-[var(--adm-line-soft)]"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{rule.title}</h3>{editingRule === index && <SourceBadge rule={rule} />}{rule.emphasis === "warning" && <span className="adm-chip" data-tone={rule.confirmed === false ? "attention" : "done"}>{rule.confirmed === false ? "待负责人确认" : "已确认"}</span>}</div>
                    <div className="flex gap-3">{rule.emphasis === "warning" && <button type="button" onClick={() => updateRule(index, { confirmed: rule.confirmed === false }, false)} className="text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-warn-text)]">{rule.confirmed === false ? "确认条款" : "撤销确认"}</button>}<button type="button" onClick={() => setEditingRule(editingRule === index ? null : index)} className="adm-btn adm-btn--ghost adm-btn--md">{editingRule === index ? "收起" : "编辑"}</button></div>
                  </div>
                  {editingRule === index ? (
                    <div className="border-t border-[var(--adm-line-soft)] bg-[var(--adm-surface-2)] p-4">
                      <div className="grid gap-3 md:grid-cols-[1fr_11rem_9rem_auto]"><input value={rule.title} onChange={(change) => updateRule(index, { title: change.target.value })} className={inputClass} /><select value={rule.category ?? "conduct"} onChange={(change) => updateRule(index, { category: change.target.value as NonNullable<EditableRule["category"]> })} className={inputClass}>{RULE_CATEGORY_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select><select value={rule.emphasis ?? "normal"} onChange={(change) => updateRule(index, { emphasis: change.target.value as NonNullable<EditableRule["emphasis"]>, confirmed: change.target.value === "warning" ? false : true })} className={inputClass}><option value="normal">常规</option><option value="important">重点</option><option value="warning">警示</option></select><button type="button" onClick={() => patchEvent({ rules: event.rules.filter((_, ruleIndex) => ruleIndex !== index) })} className="adm-btn adm-btn--danger adm-btn--md">删除</button></div>
                      <textarea rows={3} value={rule.detail} onChange={(change) => updateRule(index, { detail: change.target.value })} className={`${textareaClass} mt-3`} />
                    </div>
                  ) : <p className="border-t border-[var(--adm-line-soft)] px-4 py-3 text-[length:var(--adm-fs-md)] leading-[1.75] text-[var(--adm-text-soft)]">{rule.detail}</p>}
                </article>
              ))}
              <button type="button" onClick={() => { const next = event.rules.length; patchEvent({ rules: [...event.rules, { title: "新规则", detail: "待填写", category: handbookSection, emphasis: "normal", source: "event", customized: true, confirmed: true }] }); setEditingRule(next); }} className="adm-btn adm-btn--secondary adm-btn--md border-dashed">＋ 添加本届规则</button>
            </div>
          )}
        </Panel>
      )}

      {view === "maps" && (
        <Panel eyebrow="地图池" title="地图与 BP">
          <div className="mb-4 flex items-center justify-between gap-3"><p className="text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">当前启用 {event.mapPool.length} 张地图</p>{event.mapPool.length < 5 && <span className="text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-red-text)]">BO5 至少需要5张地图</span>}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {MAP_CATALOG.map((map) => { const active = event.mapPool.some((item) => item.id === map.id); return <button key={map.id} type="button" onClick={() => toggleMap(map)} aria-pressed={active} className={`overflow-hidden border text-left transition ${active ? "border-[var(--adm-red)] bg-[var(--adm-surface)]" : "border-[var(--adm-line-soft)] bg-[var(--adm-surface)] hover:border-[var(--adm-line)]"}`}>{mapImageOf(map) && <Image src={mapImageOf(map)!} alt={map.name} width={320} height={80} className={`h-20 w-full object-cover ${active ? "opacity-100" : "opacity-40"}`} />}<span className="flex items-center justify-between px-3 py-2 text-[length:var(--adm-fs-md)]"><span className={active ? "font-semibold text-[var(--adm-text)]" : "text-[var(--adm-text-soft)]"}>{map.name}</span><span className={`text-[length:var(--adm-fs-xs)] ${active ? "text-[var(--adm-red-text)]" : "text-[var(--adm-text-mute)]"}`}>{active ? "已启用" : "未启用"}</span></span></button>; })}
          </div>
        </Panel>
      )}

      {view === "public" && (
        <Panel eyebrow="公开内容" title="玩家页面">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2"><Field label="赛事简介"><textarea rows={4} value={event.description} onChange={(change) => patchEvent({ description: change.target.value })} className={textareaClass} /></Field></div>
            <div className="md:col-span-2"><Field label="奖项说明"><textarea rows={3} value={event.prizePool} onChange={(change) => patchEvent({ prizePool: change.target.value })} className={textareaClass} /></Field></div>
            <Field label="赛事主题色"><input type="color" value={event.coverColor} onChange={(change) => patchEvent({ coverColor: change.target.value })} className={`${inputClass} h-[44px] p-1`} /></Field>
            <Field label="赛事海报"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPoster} className="block w-full border border-[var(--adm-line)] bg-[var(--adm-surface)] text-[length:var(--adm-fs-md)] text-[var(--adm-text-soft)] file:mr-3 file:border-0 file:bg-[var(--adm-red)] file:px-3 file:py-2.5 file:text-[length:var(--adm-fs-md)] file:font-bold file:text-white" /></Field>
            {event.posterImage && <div className="md:col-span-2 flex items-start gap-4 border border-[var(--adm-line-soft)] p-4"><Image src={event.posterImage} alt="赛事海报预览" width={96} height={128} className="h-32 w-24 object-cover" /><div><p className="text-[length:var(--adm-fs-md)] font-bold">当前海报</p><button type="button" onClick={() => patchEvent({ posterImage: "" })} className="adm-btn adm-btn--danger adm-btn--md mt-3">移除海报</button></div></div>}
          </div>
        </Panel>
      )}
      </div>
    </div>
  );
}
