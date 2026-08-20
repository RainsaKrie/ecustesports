"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { stageConfigSummary, type StageConfig } from "@/lib/scheduling/format-templates";
import type { EditableEvent } from "@/lib/site-config-schema";

interface PlanningPageProps {
  params: Promise<{ id: string }>;
}

const inputClass = "h-11 w-full border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 outline-none transition focus:border-[#ff4655]";
const textareaClass = "w-full border border-slate-300 bg-white px-3 py-3 text-sm font-normal leading-6 text-slate-900 outline-none transition focus:border-[#ff4655]";

interface ProposalFields {
  background: string;
  purpose: string;
  budget: string;
  prizes: string;
  leader: string;
  contact: string;
}

function buildProposal(event: EditableEvent, fields: ProposalFields): string {
  const stageText = stageConfigSummary(event.stageConfigs ?? []);
  const rulesText = (event.rules ?? []).map((r) => `- ${r.title}：${r.detail}`).join("\n");
  return `# ${event.name} 赛事策划案

## 一、赛事概述
- 赛事名称：${event.name}
- 主办单位：${event.organizer}
- 比赛项目：${event.game}
- 参赛规模：${event.teamCount} 支队伍，每队 ${event.teamSize} 名首发

## 二、赛事背景与目的
${fields.background || "（待填写）"}

${fields.purpose || "（待填写）"}

## 三、参赛对象与规模
- 参赛对象：华东理工大学在校学生
- 预计参赛人数：${event.teamCount * event.teamSize} 人

## 四、比赛形式与赛制
${stageText}

## 五、比赛时间与地点
- 比赛时间：${event.eventDateLabel || "（待确认）"}
- 比赛地点：（待确认）

## 六、组织架构
- 赛事负责人：${fields.leader || "（待填写）"}
- 联系方式：${fields.contact || "（待填写）"}
- 裁判组：3—4 名裁判，负责 BP 主持与赛后报分
- 报名组：负责报名审核、队伍联系与通知发布

## 七、经费预算
${fields.budget || "（待填写）"}

## 八、奖项设置
${fields.prizes || "（待填写）"}

## 九、参赛规则
${rulesText || "（详见赛事设置）"}

## 十、风险预案
- 参赛队伍迟到或弃权：按参赛规则处理，由当值裁判记录并报赛事负责人
- 临时改期：两队协商新时间后由系统校验冲突，负责人确认后发布
- 比赛争议：第一时间联系当值裁判，不得自行判定赛果
`;
}

export default function PlanningPage({ params }: PlanningPageProps) {
  const { id } = use(params);
  const router = useRouter();

  const [event, setEvent] = useState<EditableEvent | null>(null);
  const [fields, setFields] = useState<ProposalFields>({ background: "", purpose: "", budget: "", prizes: "", leader: "", contact: "" });
  const [view, setView] = useState<"edit" | "doc">("edit");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/site-config", { cache: "no-store" })
      .then((r) => r.json())
      .then((config: { events?: EditableEvent[] }) => {
        if (cancelled) return;
        const ev = config.events?.find((e) => e.id === id) ?? null;
        setEvent(ev);
        if (ev) {
          setFields({
            background: ev.proposal.background,
            purpose: ev.proposal.purpose,
            budget: ev.proposal.budget,
            prizes: ev.proposal.prizes,
            leader: ev.proposal.leader,
            contact: ev.proposal.contact,
          });
        }
      })
      .catch(() => {
        // 忽略
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const doc = useMemo(() => (event ? buildProposal(event, fields) : ""), [event, fields]);

  const patch = (key: keyof ProposalFields, value: string) => setFields((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (!event) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/events/proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id, proposal: fields }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "保存失败");
      setMessage("已保存");
      setTimeout(() => setMessage(""), 2000);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const exportPdf = () => {
    window.print();
  };

  if (!event) {
    return <div className="border border-slate-200 bg-white p-16 text-center text-sm text-slate-500">加载中…</div>;
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow="MODULE 01 / PROPOSAL"
        title="策划案"
        description="查看、编辑并导出提交审核的策划案。赛制章节由新建比赛配置自动带入。"
        status={view === "edit" ? "编辑中" : "已生成"}
        actions={
          view === "edit" ? (
            <div className="flex gap-2">
              <button onClick={save} disabled={saving} className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:border-slate-950">{saving ? "保存中…" : "保存"}</button>
              <button onClick={() => setView("doc")} className="bg-[#ff4655] px-4 py-2.5 text-xs font-black text-white hover:bg-[#d83b48]">生成策划案</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setView("edit")} className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:border-slate-950">编辑</button>
              <button onClick={exportPdf} className="bg-[#ff4655] px-4 py-2.5 text-xs font-black text-white hover:bg-[#d83b48]">导出 PDF</button>
            </div>
          )
        }
      />

      {message && <p className="mb-4 text-xs font-bold text-emerald-600">{message}</p>}

      {view === "edit" ? (
        <div className="grid gap-4 border border-slate-200 bg-white p-5">
          <div className="border-l-2 border-slate-200 pl-4">
            <p className="font-mono text-[0.5625rem] font-black tracking-[0.12em] text-[#c83242]">赛制（自动带入，无需填写）</p>
            <p className="mt-2 text-sm font-bold text-slate-900">{stageConfigSummary(event.stageConfigs ?? [])}</p>
            <p className="mt-1 text-[0.625rem] text-slate-400">要改赛制请在新建比赛时配置，或在后续「赛程」中调整。</p>
          </div>
          <label className="block text-xs font-bold text-slate-700">
            赛事背景
            <textarea rows={3} value={fields.background} onChange={(e) => patch("background", e.target.value)} placeholder="为什么办这场比赛？" className={textareaClass} />
          </label>
          <label className="block text-xs font-bold text-slate-700">
            赛事目的
            <textarea rows={3} value={fields.purpose} onChange={(e) => patch("purpose", e.target.value)} placeholder="想达到什么效果？" className={textareaClass} />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-xs font-bold text-slate-700">
              经费预算
              <textarea rows={2} value={fields.budget} onChange={(e) => patch("budget", e.target.value)} className={textareaClass} />
            </label>
            <label className="block text-xs font-bold text-slate-700">
              奖项设置
              <textarea rows={2} value={fields.prizes} onChange={(e) => patch("prizes", e.target.value)} className={textareaClass} />
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-xs font-bold text-slate-700">
              赛事负责人
              <input value={fields.leader} onChange={(e) => patch("leader", e.target.value)} className={inputClass} />
            </label>
            <label className="block text-xs font-bold text-slate-700">
              联系方式
              <input value={fields.contact} onChange={(e) => patch("contact", e.target.value)} placeholder="手机号或 QQ" className={inputClass} />
            </label>
          </div>
        </div>
      ) : (
        <div className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-3 text-[0.625rem] text-slate-400">打印时另存为 PDF（A4）</div>
          <pre className="proposal-doc max-h-[80vh] overflow-auto whitespace-pre-wrap bg-white p-8 font-mono text-sm leading-7 text-slate-800">{doc}</pre>
        </div>
      )}
    </div>
  );
}
