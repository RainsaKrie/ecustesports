"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { VALORANT_MAPS, mapImageOf } from "@/lib/maps";
import type { EditableEvent, EditableRule, EditableStep } from "@/lib/site-config-schema";

interface EventSettingsEditorProps {
  initialEvent: EditableEvent;
}

type SaveState = "idle" | "saving" | "saved" | "error";

const inputClass =
  "w-full border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#ff4655] focus:ring-2 focus:ring-[#ff4655]/20";
const textareaClass = `${inputClass} resize-y`;

const STATUS_OPTIONS: { value: EditableEvent["status"]; label: string }[] = [
  { value: "draft", label: "筹备中" },
  { value: "registration", label: "报名中" },
  { value: "ongoing", label: "比赛中" },
  { value: "completed", label: "已结束" },
  { value: "archived", label: "已归档" },
];

function Section({ index, title, description, children }: { index: string; title: string; description: string; children: ReactNode }) {
  return (
    <section className="border border-slate-200 bg-white">
      <header className="grid gap-2 border-b border-slate-200 px-5 py-4 md:grid-cols-[4rem_1fr]">
        <span className="font-mono text-xs font-black tracking-[0.18em] text-[#ff4655]">{index}</span>
        <div>
          <h2 className="text-base font-black text-slate-950">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[0.625rem] leading-4 text-slate-400">{hint}</span>}
    </label>
  );
}

export default function EventSettingsEditor({ initialEvent }: EventSettingsEditorProps) {
  const router = useRouter();
  const [event, setEvent] = useState(initialEvent);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  function patchEvent(patch: Partial<EditableEvent>) {
    setEvent((current) => ({ ...current, ...patch }));
    setSaveState("idle");
    setMessage("");
  }

  function updateRule(index: number, patch: Partial<EditableRule>) {
    patchEvent({ rules: event.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule) });
  }

  function updateStep(index: number, patch: Partial<EditableStep>) {
    patchEvent({ preparationSteps: event.preparationSteps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) });
  }

  function toggleMap(map: { id: string; name: string }) {
    const active = event.mapPool.some((item) => item.id === map.id);
    patchEvent({
      mapPool: active
        ? event.mapPool.filter((item) => item.id !== map.id)
        : [...event.mapPool, { id: map.id, name: map.name }],
    });
  }

  async function uploadPoster(change: ChangeEvent<HTMLInputElement>) {
    const file = change.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/admin/upload", { method: "POST", body: formData });
      const result = (await response.json()) as { path?: string; message?: string };
      if (!response.ok || !result.path) throw new Error(result.message || "图片上传失败");
      patchEvent({ posterImage: result.path });
    } catch (error) {
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
      const result = (await response.json()) as { message?: string; event?: EditableEvent };
      if (!response.ok || !result.event) throw new Error(result.message || "保存失败");
      setEvent(result.event);
      setSaveState("saved");
      setMessage("已保存，并同步到玩家侧赛事页面。");
      router.refresh();
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "保存失败，请稍后重试");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 bg-white px-5 py-4">
        <div>
          <p className="text-xs font-bold text-slate-700">正在编辑：{event.name}</p>
          <p className="mt-1 text-[0.625rem] text-slate-400">赛事 ID：{event.id} · 这里只修改本届赛事，不影响其他赛事和站点导航。</p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className={`text-xs font-bold ${saveState === "error" ? "text-red-600" : "text-emerald-700"}`}>{message}</span>}
          <button type="button" onClick={save} disabled={saveState === "saving" || uploading} className="bg-[#ff4655] px-5 py-2.5 text-xs font-black text-white hover:bg-[#d83b48] disabled:cursor-not-allowed disabled:opacity-50">
            {saveState === "saving" ? "正在保存…" : "保存赛事设置"}
          </button>
        </div>
      </div>

      <Section index="01" title="赛事信息" description="控制赛事身份、状态、报名窗口和玩家侧显示的赛制摘要。">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="赛事名称"><input value={event.name} onChange={(change) => patchEvent({ name: change.target.value })} className={inputClass} /></Field>
          <Field label="游戏项目"><input value={event.game} onChange={(change) => patchEvent({ game: change.target.value })} className={inputClass} /></Field>
          <Field label="主办方"><input value={event.organizer} onChange={(change) => patchEvent({ organizer: change.target.value })} className={inputClass} /></Field>
          <Field label="赛事状态">
            <select value={event.status} onChange={(change) => patchEvent({ status: change.target.value as EditableEvent["status"] })} className={inputClass}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="目标队伍数"><input type="number" min="2" max="128" value={event.teamCount} onChange={(change) => patchEvent({ teamCount: Number(change.target.value) })} className={inputClass} /></Field>
          <Field label="每队首发人数"><input type="number" min="1" max="20" value={event.teamSize} onChange={(change) => patchEvent({ teamSize: Number(change.target.value) })} className={inputClass} /></Field>
          <Field label="报名开始日期"><input type="date" value={event.registrationStart} onChange={(change) => patchEvent({ registrationStart: change.target.value })} className={inputClass} /></Field>
          <Field label="选手报名截止" hint="截止后不再接收新的个人报名，已有选手仍可完成组队。"><input type="date" value={event.registrationEnd} onChange={(change) => patchEvent({ registrationEnd: change.target.value })} className={inputClass} /></Field>
          <Field label="队伍申报截止" hint="截止后停止建队和名单调整，通常应晚于选手报名截止。"><input type="date" value={event.teamRegistrationEnd} onChange={(change) => patchEvent({ teamRegistrationEnd: change.target.value })} className={inputClass} /></Field>
          <Field label="比赛时间展示"><input value={event.eventDateLabel} onChange={(change) => patchEvent({ eventDateLabel: change.target.value })} placeholder="如：10 月每周六、日 12:00—18:00" className={inputClass} /></Field>
          <Field label="报名状态文案"><input value={event.registrationLabel} onChange={(change) => patchEvent({ registrationLabel: change.target.value })} placeholder="如：报名进行中" className={inputClass} /></Field>
          <Field label="赛制摘要"><input value={event.stageSummary} onChange={(change) => patchEvent({ stageSummary: change.target.value })} className={inputClass} /></Field>
        </div>
      </Section>

      <Section index="02" title="参赛规则" description="玩家在赛事详情页看到的正式规则；修改后由负责人保存发布。">
        <div className="space-y-3">
          {event.rules.map((rule, index) => (
            <div key={index} className="grid gap-3 border border-slate-200 p-4 md:grid-cols-[12rem_1fr_auto]">
              <input value={rule.title} onChange={(change) => updateRule(index, { title: change.target.value })} aria-label={`规则 ${index + 1} 标题`} className={inputClass} />
              <textarea rows={2} value={rule.detail} onChange={(change) => updateRule(index, { detail: change.target.value })} aria-label={`规则 ${index + 1} 内容`} className={textareaClass} />
              <button type="button" onClick={() => patchEvent({ rules: event.rules.filter((_, ruleIndex) => ruleIndex !== index) })} disabled={event.rules.length === 1} className="self-end border border-red-200 px-3 py-2.5 text-xs font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">删除</button>
            </div>
          ))}
          <button type="button" onClick={() => patchEvent({ rules: [...event.rules, { title: "新规则", detail: "待填写" }] })} className="border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:border-slate-950">＋ 添加规则</button>
        </div>
      </Section>

      <Section index="03" title="地图池" description="点击地图启用或停用；BP 工具会直接读取这里保存的地图池。">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {VALORANT_MAPS.map((map) => {
            const active = event.mapPool.some((item) => item.id === map.id);
            return (
              <button key={map.id} type="button" onClick={() => toggleMap(map)} className={`overflow-hidden border text-left transition ${active ? "border-[#ff4655] bg-[#fff1f2]" : "border-slate-200 bg-white hover:border-slate-500"}`}>
                {mapImageOf(map) && <Image src={mapImageOf(map)!} alt={map.name} width={320} height={80} className={`h-20 w-full object-cover ${active ? "opacity-100" : "opacity-55"}`} />}
                <span className="flex items-center justify-between px-3 py-2 text-xs font-bold text-slate-800">
                  {map.name}
                  <span className={active ? "text-[#ff4655]" : "text-slate-400"}>{active ? "已启用" : "未启用"}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className={`mt-3 text-xs font-bold ${event.mapPool.length < 5 ? "text-red-600" : "text-slate-500"}`}>当前启用 {event.mapPool.length} 张地图{event.mapPool.length < 5 ? "；BO5 至少需要 5 张地图" : ""}</p>
      </Section>

      <Section index="04" title="公开内容" description="维护玩家侧赛事详情中的简介、奖项、海报与参赛准备事项。">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2"><Field label="赛事简介"><textarea rows={4} value={event.description} onChange={(change) => patchEvent({ description: change.target.value })} className={textareaClass} /></Field></div>
          <div className="md:col-span-2"><Field label="奖项说明"><textarea rows={3} value={event.prizePool} onChange={(change) => patchEvent({ prizePool: change.target.value })} className={textareaClass} /></Field></div>
          <Field label="主题色"><input type="color" value={event.coverColor} onChange={(change) => patchEvent({ coverColor: change.target.value })} className={`${inputClass} h-11 p-1`} /></Field>
          <Field label="赛事海报" hint="支持 JPG、PNG、WebP，最大 5MB；上传后仍需点击保存。">
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPoster} className="block w-full border border-slate-300 bg-white text-xs text-slate-500 file:mr-3 file:border-0 file:bg-[#ff4655] file:px-3 file:py-2.5 file:text-xs file:font-bold file:text-white" />
          </Field>
          {event.posterImage && (
            <div className="md:col-span-2 flex items-start gap-4 border border-slate-200 p-4">
              <Image src={event.posterImage} alt="赛事海报预览" width={96} height={128} className="h-32 w-24 object-cover" />
              <div>
                <p className="text-xs font-bold text-slate-700">当前海报</p>
                <p className="mt-1 break-all text-[0.625rem] text-slate-400">{event.posterImage}</p>
                <button type="button" onClick={() => patchEvent({ posterImage: "" })} className="mt-3 border border-red-200 px-3 py-2 text-xs font-bold text-red-600">移除海报</button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 border-t border-slate-200 pt-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-900">参赛准备事项</h3>
              <p className="mt-1 text-[0.625rem] text-slate-400">按玩家实际参赛顺序维护，不固定为三项。</p>
            </div>
            <button type="button" onClick={() => patchEvent({ preparationSteps: [...event.preparationSteps, { number: String(event.preparationSteps.length + 1).padStart(2, "0"), title: "新步骤", detail: "待填写" }] })} className="border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">＋ 添加</button>
          </div>
          <div className="space-y-3">
            {event.preparationSteps.map((step, index) => (
              <div key={index} className="grid gap-3 border border-slate-200 p-4 md:grid-cols-[5rem_12rem_1fr_auto]">
                <input value={step.number} onChange={(change) => updateStep(index, { number: change.target.value })} aria-label={`步骤 ${index + 1} 编号`} className={inputClass} />
                <input value={step.title} onChange={(change) => updateStep(index, { title: change.target.value })} aria-label={`步骤 ${index + 1} 标题`} className={inputClass} />
                <textarea rows={2} value={step.detail} onChange={(change) => updateStep(index, { detail: change.target.value })} aria-label={`步骤 ${index + 1} 内容`} className={textareaClass} />
                <button type="button" onClick={() => patchEvent({ preparationSteps: event.preparationSteps.filter((_, stepIndex) => stepIndex !== index) })} className="self-end border border-red-200 px-3 py-2.5 text-xs font-bold text-red-600">删除</button>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <div className="flex items-center justify-end gap-3 border-t border-slate-300 pt-5">
        {message && <span className={`text-xs font-bold ${saveState === "error" ? "text-red-600" : "text-emerald-700"}`}>{message}</span>}
        <button type="button" onClick={save} disabled={saveState === "saving" || uploading} className="bg-[#ff4655] px-6 py-3 text-xs font-black text-white hover:bg-[#d83b48] disabled:cursor-not-allowed disabled:opacity-50">
          {saveState === "saving" ? "正在保存…" : "保存全部修改"}
        </button>
      </div>
    </div>
  );
}
