"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { VALORANT_MAPS, mapImageOf } from "@/lib/maps";
import { buildDefaultEventRules } from "@/lib/scheduling/format-templates";
import type { EditableEvent, EditableRule, EditableStep } from "@/lib/site-config-schema";
import { publicationChecklist } from "@/lib/publication-check";

type ViewKey = "overview" | "event" | "handbook" | "maps" | "public";
type HandbookSection = "steps" | NonNullable<EditableRule["category"]>;
type SaveState = "idle" | "saving" | "saved" | "error";

const inputClass = "w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#ff4655] focus:ring-2 focus:ring-[#ff4655]/20";
const textareaClass = `${inputClass} resize-y`;

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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function Panel({ eyebrow, title, children, actions }: { eyebrow: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <p className="font-mono text-[0.5625rem] font-black tracking-[0.14em] text-[#c83242]">{eyebrow}</p>
          <h2 className="mt-1 text-base font-black text-slate-950">{title}</h2>
        </div>
        {actions}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function SourceBadge({ rule }: { rule: EditableRule }) {
  const source = rule.source ?? "event";
  return (
    <span className={`border px-2 py-1 text-[0.5625rem] font-bold ${
      source === "format"
        ? "border-blue-200 bg-blue-50 text-blue-700"
        : source === "common"
          ? "border-slate-200 bg-slate-50 text-slate-600"
          : "border-[#ff4655]/30 bg-[#fff1f2] text-[#c83242]"
    }`}>
      {SOURCE_LABELS[source]}{rule.customized ? " · 本届已调整" : ""}
    </span>
  );
}

export default function EventSettingsWorkspace({ initialEvent, initialCommonRules, eventCount }: { initialEvent: EditableEvent; initialCommonRules: EditableRule[]; eventCount: number }) {
  const router = useRouter();
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

  async function archiveEvent() {
    if (dirty) {
      setSaveState("error");
      setMessage("请先保存当前修改，再归档赛事。");
      return;
    }
    if (event.status !== "completed") return;
    if (!window.confirm("归档后赛事资料与赛果继续保留，并标记为往届赛事。确认归档？")) return;

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
    <div className="space-y-5">
      <nav aria-label="赛事设置分区" className="overflow-x-auto border border-slate-200 bg-white">
        <div className="grid min-w-[45rem] grid-cols-5 xl:min-w-0">
          {VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setView(item.key)}
              className={`border-r border-slate-200 px-5 py-4 text-left transition ${view === item.key ? "border-b-[3px] border-b-[#ff4655] bg-[#fff7f6]" : "border-b-[3px] border-b-transparent hover:bg-slate-50"}`}
            >
              <span className="font-mono text-[0.5625rem] font-black text-[#c83242]">{item.index}</span>
              <span className="ml-3 text-xs font-black text-slate-800">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {view !== "overview" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 bg-white px-5 py-3">
          <button type="button" onClick={() => setView("overview")} className="text-xs font-bold text-slate-600 hover:text-slate-950">← 返回发布概览</button>
          <div className="flex items-center gap-3">
            {message && <span className={`text-xs font-bold ${saveState === "error" ? "text-red-600" : "text-emerald-700"}`}>{message}</span>}
            <button type="button" onClick={save} disabled={!dirty || saveState === "saving" || uploading} className="bg-[#ff4655] px-5 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40">
              {saveState === "saving" ? "正在保存…" : dirty ? "保存当前修改" : "已保存"}
            </button>
          </div>
        </div>
      )}

      {view === "overview" && (
        <>
          <section className="border border-l-4 border-slate-200 border-l-[#ff4655] bg-white px-5 py-5">
            <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-black text-slate-950">发布状态</h2>
                  <span className={`border px-2 py-1 text-[0.5625rem] font-bold ${event.visibility === "public" ? "border-[#ff4655] bg-[#ff4655] text-white" : "border-[#ff4655]/40 bg-[#fff1f2] text-[#c83242]"}`}>{event.visibility === "public" ? "已公开" : "未公开"}</span>
                  <span className="border border-slate-200 bg-slate-50 px-2 py-1 text-[0.5625rem] font-bold text-slate-600">{STATUS_OPTIONS.find((item) => item.value === event.status)?.label}</span>
                </div>
                <p className="mt-2 text-xs font-bold text-slate-600">{readyToPublish ? "发布前检查已通过" : `仍有 ${publishChecks.filter((item) => !item.ok).length} 项需要确认`}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {dirty && (
                  <button type="button" onClick={save} disabled={saveState === "saving" || uploading} className="border border-[#ff4655] bg-white px-4 py-2.5 text-xs font-black text-[#c83242] disabled:opacity-40">
                    {saveState === "saving" ? "正在保存…" : "保存全部修改"}
                  </button>
                )}
                <Link href={`/events/${event.id}?preview=1`} target="_blank" className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700">预览玩家页面</Link>
                {event.visibility === "public" ? (
                  <button type="button" onClick={() => updatePublication("unpublish")} disabled={publishing || dirty} className="border border-red-300 bg-white px-4 py-2.5 text-xs font-black text-red-700 disabled:opacity-40">从玩家侧撤回</button>
                ) : (
                  <button type="button" onClick={() => updatePublication("publish")} disabled={publishing || dirty || !readyToPublish} className="bg-[#ff4655] px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">发布到玩家侧</button>
                )}
              </div>
            </div>
            {dirty && <p className="mt-4 border-t border-amber-200 pt-3 text-xs font-bold text-amber-800">存在未保存修改，保存后方可更新公开状态。</p>}
          </section>

          <Panel eyebrow="PUBLICATION CHECK" title="发布前待确认">
            <div className="grid border-l border-t border-slate-200 sm:grid-cols-2 lg:grid-cols-3">
              {publishChecks.map((item) => (
                <button key={item.key} type="button" onClick={() => setView(checkView(item.key))} className="flex min-h-24 items-start justify-between gap-4 border-b border-r border-slate-200 p-4 text-left hover:bg-slate-50">
                  <div>
                    <p className="text-xs font-black text-slate-900">{item.label}</p>
                    <p className="mt-2 text-[0.625rem] leading-5 text-slate-500">{item.detail}</p>
                  </div>
                  <span className={`font-mono text-xs font-black ${item.ok ? "text-emerald-600" : "text-red-600"}`}>{item.ok ? "PASS" : "TODO"}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel eyebrow="CONFIGURATION" title="配置摘要">
            <div className="grid border-l border-t border-slate-200 md:grid-cols-2">
              <button type="button" onClick={() => setView("event")} className="border-b border-r border-slate-200 p-5 text-left hover:bg-slate-50">
                <p className="font-mono text-[0.5625rem] font-black text-[#c83242]">01 / EVENT</p>
                <h3 className="mt-2 text-sm font-black text-slate-950">赛事与报名</h3>
                <p className="mt-2 text-xs text-slate-600">{event.name} · {event.teamCount} 队 · {event.registrationStart || "报名时间待定"}</p>
              </button>
              <button type="button" onClick={() => setView("handbook")} className="border-b border-r border-slate-200 p-5 text-left hover:bg-slate-50">
                <p className="font-mono text-[0.5625rem] font-black text-[#c83242]">02 / HANDBOOK</p>
                <h3 className="mt-2 text-sm font-black text-slate-950">赛事规程</h3>
                <p className="mt-2 text-xs text-slate-600">赛制规则 {formatRuleCount} · 通用规则 {commonRuleCount} · 本届新增 {eventRuleCount}{pendingRuleCount ? ` · ${pendingRuleCount} 条处罚待确认` : ""}</p>
              </button>
              <button type="button" onClick={() => setView("maps")} className="border-b border-r border-slate-200 p-5 text-left hover:bg-slate-50">
                <p className="font-mono text-[0.5625rem] font-black text-[#c83242]">03 / MAP & BP</p>
                <h3 className="mt-2 text-sm font-black text-slate-950">地图与 BP</h3>
                <p className="mt-2 text-xs text-slate-600">已启用 {event.mapPool.length} 张赛事地图</p>
              </button>
              <button type="button" onClick={() => setView("public")} className="border-b border-r border-slate-200 p-5 text-left hover:bg-slate-50">
                <p className="font-mono text-[0.5625rem] font-black text-[#c83242]">04 / PUBLIC PAGE</p>
                <h3 className="mt-2 text-sm font-black text-slate-950">玩家页面</h3>
                <p className="mt-2 text-xs text-slate-600">简介、奖项与赛事视觉</p>
              </button>
            </div>
          </Panel>

          <Panel eyebrow="EVENT MANAGEMENT" title="赛事归档与删除">
            <div className="divide-y divide-slate-200 border border-slate-200">
              <div className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center">
                <div>
                  <h3 className="text-sm font-black text-slate-950">归档为往届赛事</h3>
                  <p className="mt-1 text-xs font-medium text-slate-600">保留报名、赛程、赛果及 BP 数据，赛事标记为已归档。</p>
                </div>
                <button type="button" onClick={archiveEvent} disabled={!canArchive} className="min-h-11 shrink-0 border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">
                  {event.status === "archived" ? "已归档" : eventAction === "archiving" ? "正在归档…" : event.status === "completed" ? "归档赛事" : "赛事结束后可归档"}
                </button>
              </div>

              <div className="p-4">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-sm font-black text-red-700">永久删除测试赛事</h3>
                    <p className="mt-1 text-xs font-medium text-slate-600">报名、队伍、抽签、赛程和 BP 数据将全部删除，无法恢复。</p>
                    {event.visibility === "public" && <p className="mt-2 text-xs font-bold text-red-700">请先从玩家侧撤回赛事。</p>}
                    {event.visibility === "private" && event.status !== "draft" && event.status !== "archived" && <p className="mt-2 text-xs font-bold text-red-700">只有筹备中或已归档赛事可以永久删除。</p>}
                    {eventCount <= 1 && <p className="mt-2 text-xs font-bold text-red-700">系统至少需要保留一场赛事。</p>}
                  </div>
                  <button type="button" onClick={() => { setDeleteConfirmOpen(true); setDeleteConfirmName(""); setMessage(""); }} disabled={!canDelete} className="min-h-11 shrink-0 border border-red-300 bg-white px-4 py-2.5 text-xs font-black text-red-700 disabled:cursor-not-allowed disabled:opacity-40">
                    永久删除
                  </button>
                </div>

                {deleteConfirmOpen && deleteEligible && (
                  <div className="mt-4 border border-red-300 bg-red-50 p-4">
                    <p className="text-xs font-black text-red-800">输入完整赛事名称确认：{event.name}</p>
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                      <input value={deleteConfirmName} onChange={(change) => setDeleteConfirmName(change.target.value)} autoComplete="off" className={`${inputClass} border-red-300`} />
                      <button type="button" onClick={deleteEventPermanently} disabled={deleteConfirmName.trim() !== event.name || eventAction === "deleting"} className="min-h-11 shrink-0 bg-red-700 px-5 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40">
                        {eventAction === "deleting" ? "正在删除…" : "确认永久删除"}
                      </button>
                      <button type="button" onClick={() => { setDeleteConfirmOpen(false); setDeleteConfirmName(""); }} disabled={eventAction === "deleting"} className="min-h-11 shrink-0 border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700 disabled:opacity-40">取消</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {message && <p className={`mt-3 text-xs font-bold ${saveState === "error" ? "text-red-700" : "text-emerald-700"}`}>{message}</p>}
          </Panel>
        </>
      )}

      {view === "event" && (
        <Panel eyebrow="EVENT & REGISTRATION" title="赛事与报名">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="赛事名称"><input value={event.name} onChange={(change) => patchEvent({ name: change.target.value })} className={inputClass} /></Field>
            <Field label="比赛项目"><input value={event.game} onChange={(change) => patchEvent({ game: change.target.value })} className={inputClass} /></Field>
            <Field label="主办方"><input value={event.organizer} onChange={(change) => patchEvent({ organizer: change.target.value })} className={inputClass} /></Field>
            <Field label="赛事阶段"><select value={event.status} onChange={(change) => patchEvent({ status: change.target.value as EditableEvent["status"] })} className={inputClass}>{STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          </div>
          <div className="mt-5 grid border-l border-t border-slate-200 sm:grid-cols-3">
            <div className="border-b border-r border-slate-200 p-4"><p className="text-[0.625rem] font-bold text-slate-500">参赛规模</p><p className="mt-1 text-sm font-black">{event.teamCount} 队 / 每队 {event.teamSize} 名首发</p></div>
            <div className="border-b border-r border-slate-200 p-4 sm:col-span-2"><p className="text-[0.625rem] font-bold text-slate-500">赛制摘要</p><p className="mt-1 text-sm font-black leading-6">{event.stageSummary}</p></div>
          </div>
          <div className="mt-6 grid gap-4 border-t border-slate-200 pt-5 md:grid-cols-2">
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
          eyebrow="COMPETITION HANDBOOK"
          title="赛事规程"
          actions={<div className="flex flex-wrap gap-2"><button type="button" onClick={saveAsCommonPreset} disabled={syncingPreset} className="border border-[#ff4655] px-3 py-2 text-xs font-bold text-[#c83242] disabled:opacity-40">{syncingPreset ? "正在保存…" : "保存为以后赛事的通用规则"}</button><button type="button" onClick={() => { if (window.confirm("将按当前赛制和通用规则重新生成本届全部规则，已修改及新增内容会被覆盖，参赛程序不受影响。确认继续？")) patchEvent({ rules: buildDefaultEventRules(event.stageConfigs, event.teamSize, commonPreset) }); }} className="border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600">重新生成本届规则</button></div>}
        >
          <div className="mb-5 grid border-l border-t border-slate-200 sm:grid-cols-4">
            <div className="border-b border-r border-slate-200 p-3"><p className="text-[0.5625rem] text-slate-500">赛制规则</p><p className="mt-1 text-lg font-black">{formatRuleCount}</p></div>
            <div className="border-b border-r border-slate-200 p-3"><p className="text-[0.5625rem] text-slate-500">通用规则</p><p className="mt-1 text-lg font-black">{commonRuleCount}</p></div>
            <div className="border-b border-r border-slate-200 p-3"><p className="text-[0.5625rem] text-slate-500">本届新增</p><p className="mt-1 text-lg font-black">{eventRuleCount}</p></div>
            <div className={`border-b border-r border-slate-200 p-3 ${pendingRuleCount ? "bg-amber-50" : ""}`}><p className="text-[0.5625rem] text-slate-500">待确认处罚</p><p className={`mt-1 text-lg font-black ${pendingRuleCount ? "text-amber-700" : "text-emerald-700"}`}>{pendingRuleCount}</p></div>
          </div>

          <div className="mb-5 overflow-x-auto border-y border-slate-200">
            <div className="flex min-w-max">
              {HANDBOOK_SECTIONS.map((item) => {
                const count = item.key === "steps" ? event.preparationSteps.length : event.rules.filter((rule) => (rule.category ?? "conduct") === item.key).length;
                return <button key={item.key} type="button" onClick={() => { setHandbookSection(item.key); setEditingRule(null); setEditingStep(null); }} className={`border-r border-slate-200 px-4 py-3 text-xs font-bold ${handbookSection === item.key ? "bg-[#171a1f] text-white" : "text-slate-600 hover:bg-slate-50"}`}>{item.label} <span className="ml-1 opacity-60">{count}</span></button>;
              })}
            </div>
          </div>

          {handbookSection === "steps" ? (
            <div className="space-y-2">
              {event.preparationSteps.map((step, index) => (
                <article key={index} className="border border-slate-200">
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="flex items-center gap-4"><span className="font-mono text-[0.625rem] font-black text-[#c83242]">{step.number}</span><h3 className="text-sm font-black">{step.title}</h3></div>
                    <button type="button" onClick={() => setEditingStep(editingStep === index ? null : index)} className="text-xs font-bold text-slate-600">{editingStep === index ? "收起" : "编辑"}</button>
                  </div>
                  {editingStep === index && <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-4 md:grid-cols-[5rem_12rem_1fr_auto]"><input value={step.number} onChange={(change) => updateStep(index, { number: change.target.value })} className={inputClass} /><input value={step.title} onChange={(change) => updateStep(index, { title: change.target.value })} className={inputClass} /><textarea rows={2} value={step.detail} onChange={(change) => updateStep(index, { detail: change.target.value })} className={textareaClass} /><button type="button" onClick={() => patchEvent({ preparationSteps: event.preparationSteps.filter((_, stepIndex) => stepIndex !== index) })} className="self-end border border-red-200 px-3 py-2.5 text-xs font-bold text-red-600">删除</button></div>}
                </article>
              ))}
              <button type="button" onClick={() => { const next = event.preparationSteps.length; patchEvent({ preparationSteps: [...event.preparationSteps, { number: String(next + 1).padStart(2, "0"), title: "新步骤", detail: "待填写" }] }); setEditingStep(next); }} className="border border-dashed border-slate-300 px-4 py-3 text-xs font-bold text-slate-600">＋ 添加参赛步骤</button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredRules.map(({ rule, index }) => (
                <article key={index} className={`border ${rule.confirmed === false ? "border-amber-300" : "border-slate-200"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-black text-slate-950">{rule.title}</h3>{editingRule === index && <SourceBadge rule={rule} />}{rule.emphasis === "warning" && <span className={`border px-2 py-1 text-[0.5625rem] font-bold ${rule.confirmed === false ? "border-amber-300 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{rule.confirmed === false ? "待负责人确认" : "已确认"}</span>}</div>
                    <div className="flex gap-3">{rule.emphasis === "warning" && <button type="button" onClick={() => updateRule(index, { confirmed: rule.confirmed === false }, false)} className="text-xs font-bold text-amber-700">{rule.confirmed === false ? "确认条款" : "撤销确认"}</button>}<button type="button" onClick={() => setEditingRule(editingRule === index ? null : index)} className="text-xs font-bold text-slate-600">{editingRule === index ? "收起" : "编辑"}</button></div>
                  </div>
                  {editingRule === index ? (
                    <div className="border-t border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-3 md:grid-cols-[1fr_11rem_9rem_auto]"><input value={rule.title} onChange={(change) => updateRule(index, { title: change.target.value })} className={inputClass} /><select value={rule.category ?? "conduct"} onChange={(change) => updateRule(index, { category: change.target.value as NonNullable<EditableRule["category"]> })} className={inputClass}>{RULE_CATEGORY_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select><select value={rule.emphasis ?? "normal"} onChange={(change) => updateRule(index, { emphasis: change.target.value as NonNullable<EditableRule["emphasis"]>, confirmed: change.target.value === "warning" ? false : true })} className={inputClass}><option value="normal">常规</option><option value="important">重点</option><option value="warning">警示</option></select><button type="button" onClick={() => patchEvent({ rules: event.rules.filter((_, ruleIndex) => ruleIndex !== index) })} className="border border-red-200 px-3 py-2.5 text-xs font-bold text-red-600">删除</button></div>
                      <textarea rows={3} value={rule.detail} onChange={(change) => updateRule(index, { detail: change.target.value })} className={`${textareaClass} mt-3`} />
                    </div>
                  ) : <p className="border-t border-slate-100 px-4 py-3 text-xs leading-6 text-slate-600">{rule.detail}</p>}
                </article>
              ))}
              <button type="button" onClick={() => { const next = event.rules.length; patchEvent({ rules: [...event.rules, { title: "新规则", detail: "待填写", category: handbookSection, emphasis: "normal", source: "event", customized: true, confirmed: true }] }); setEditingRule(next); }} className="border border-dashed border-slate-300 px-4 py-3 text-xs font-bold text-slate-600">＋ 添加本届规则</button>
            </div>
          )}
        </Panel>
      )}

      {view === "maps" && (
        <Panel eyebrow="MAP POOL & BP" title="地图与 BP">
          <div className="mb-4 flex items-center justify-between gap-3"><p className="text-xs font-bold text-slate-600">当前启用 {event.mapPool.length} 张地图</p>{event.mapPool.length < 5 && <span className="text-xs font-bold text-red-600">BO5 至少需要5张地图</span>}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {VALORANT_MAPS.map((map) => { const active = event.mapPool.some((item) => item.id === map.id); return <button key={map.id} type="button" onClick={() => toggleMap(map)} className={`overflow-hidden border text-left ${active ? "border-[#ff4655] bg-[#fff1f2]" : "border-slate-200 bg-white"}`}>{mapImageOf(map) && <Image src={mapImageOf(map)!} alt={map.name} width={320} height={80} className={`h-20 w-full object-cover ${active ? "opacity-100" : "opacity-45"}`} />}<span className="flex items-center justify-between px-3 py-2 text-xs font-bold">{map.name}<span className={active ? "text-[#c83242]" : "text-slate-400"}>{active ? "已启用" : "未启用"}</span></span></button>; })}
          </div>
        </Panel>
      )}

      {view === "public" && (
        <Panel eyebrow="PUBLIC EVENT PAGE" title="玩家页面">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2"><Field label="赛事简介"><textarea rows={4} value={event.description} onChange={(change) => patchEvent({ description: change.target.value })} className={textareaClass} /></Field></div>
            <div className="md:col-span-2"><Field label="奖项说明"><textarea rows={3} value={event.prizePool} onChange={(change) => patchEvent({ prizePool: change.target.value })} className={textareaClass} /></Field></div>
            <Field label="赛事主题色"><input type="color" value={event.coverColor} onChange={(change) => patchEvent({ coverColor: change.target.value })} className={`${inputClass} h-11 p-1`} /></Field>
            <Field label="赛事海报"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPoster} className="block w-full border border-slate-300 bg-white text-xs text-slate-500 file:mr-3 file:border-0 file:bg-[#ff4655] file:px-3 file:py-2.5 file:text-xs file:font-bold file:text-white" /></Field>
            {event.posterImage && <div className="md:col-span-2 flex items-start gap-4 border border-slate-200 p-4"><Image src={event.posterImage} alt="赛事海报预览" width={96} height={128} className="h-32 w-24 object-cover" /><div><p className="text-xs font-bold">当前海报</p><button type="button" onClick={() => patchEvent({ posterImage: "" })} className="mt-3 border border-red-200 px-3 py-2 text-xs font-bold text-red-600">移除海报</button></div></div>}
          </div>
        </Panel>
      )}
    </div>
  );
}
