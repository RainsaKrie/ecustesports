"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FORMAT_TEMPLATES, STAGE_TYPE_LABELS, STAGE_TYPE_DEFAULT_BO, estimateStageConfig, type StageConfig, type StageType } from "@/lib/scheduling/format-templates";
import { resolveSupportedFormat } from "@/lib/scheduling/format-support";

const inputClass = "h-[44px] w-full border border-[var(--adm-line)] bg-[var(--adm-surface)] px-3 text-[length:var(--adm-fs-lg)] font-normal text-[var(--adm-text)] outline-none transition focus:border-[var(--adm-red)]";

function StepHeader({ step, title }: { step: number; title: string }) {
  return (
    <div className="mb-6">
      <p className="text-[length:var(--adm-fs-sm)] font-medium tracking-[0.14em] text-[var(--adm-text-mute)]">新建赛事 · 第 {step} 步 / 共 4 步</p>
      <h1 className="mt-2 text-[length:var(--adm-fs-xl)] font-semibold text-[var(--adm-text)]">{title}</h1>
    </div>
  );
}

export default function NewEventPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ① 基础信息
  const [name, setName] = useState("");
  const [organizer, setOrganizer] = useState("华东理工大学电竞社");
  const [game, setGame] = useState("无畏契约");
  const [registrationStart, setRegistrationStart] = useState("");
  const [registrationEnd, setRegistrationEnd] = useState("");
  const [eventDateLabel, setEventDateLabel] = useState("");
  const [coverColor, setCoverColor] = useState("#ff4655");

  // ② 赛制配置：从瓦理杯预设起步，可增删改
  const [stages, setStages] = useState<StageConfig[]>(() => {
    const t = FORMAT_TEMPLATES.find((x) => x.id === "val-16gsl-8de");
    return (t?.stages ?? []).map((st) => ({
      name: st.name,
      type: st.type,
      teamCount: st.teamCount,
      boType: st.boType,
      ...(st.groupCount !== undefined ? { groupCount: st.groupCount } : {}),
    }));
  });

  const estimate = useMemo(() => estimateStageConfig(stages), [stages]);
  const formatSupport = useMemo(() => resolveSupportedFormat(stages), [stages]);

  function updateStage(index: number, patch: Partial<StageConfig>) {
    setStages((s) => s.map((st, i) => (i === index ? { ...st, ...patch } : st)));
  }
  function addStage() {
    setStages((s) => [...s, { name: "新阶段", type: "single-elim", teamCount: 8, boType: "BO1" }]);
  }
  function removeStage(index: number) {
    setStages((s) => s.filter((_, i) => i !== index));
  }

  const handleCreate = async () => {
    if (!name.trim() || !organizer.trim()) {
      setError("赛事名称和主办方为必填项。");
      return;
    }
    if (stages.length === 0) {
      setError("至少配置一个比赛阶段。");
      return;
    }
    if (formatSupport.kind === "unsupported") {
      setError(formatSupport.message);
      setStep(2);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, organizer, game, registrationStart, registrationEnd, eventDateLabel, coverColor,
          stageConfigs: stages,
        }),
      });
      const result = await response.json() as { event?: { id: string }; message?: string };
      if (!response.ok || !result.event) throw new Error(result.message ?? "创建失败");
      router.push(`/admin/events/${result.event.id}/settings`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败，请稍后重试。");
      setSaving(false);
    }
  };

  const steps = [
    { n: 1, label: "基础信息" },
    { n: 2, label: "赛制配置" },
  ];

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <div className="mb-8 flex items-center border border-[var(--adm-line-soft)] bg-[var(--adm-surface)]">
        {steps.map((s, i) => (
          <div key={s.n} className="flex flex-1 items-center">
            <button
              type="button"
              onClick={() => s.n < step && setStep(s.n)}
              className={`flex flex-1 items-center gap-3 px-4 py-3 text-left transition ${s.n === step ? "border-b-2 border-b-[var(--adm-red)]" : s.n < step ? "hover:bg-[var(--adm-surface-2)]" : "opacity-50"}`}
            >
              <span className={`text-[length:var(--adm-fs-md)] font-semibold tabular-nums ${s.n === step ? "text-[var(--adm-red-text)]" : s.n < step ? "text-[var(--adm-text)]" : "text-[var(--adm-text-mute)]"}`}>
                {s.n < step ? "✓" : `0${s.n}`}
              </span>
              <span className={`text-[length:var(--adm-fs-lg)] ${s.n === step ? "font-semibold text-[var(--adm-text)]" : "text-[var(--adm-text-soft)]"}`}>{s.label}</span>
            </button>
            {i < steps.length - 1 && <span className="h-px w-6 shrink-0 bg-[var(--adm-surface-3)]" />}
          </div>
        ))}
      </div>

      {error && <div className="adm-note adm-note--danger mb-5 text-[length:var(--adm-fs-lg)] font-semibold">{error}</div>}

      {/* ① 基础信息 */}
      {step === 1 && (
        <div>
          <StepHeader step={1} title="基础信息" />
          <div className="grid gap-4 border border-[var(--adm-line-soft)] bg-[var(--adm-surface)] p-5 md:grid-cols-2">
            <label className="block text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)] md:col-span-2">
              赛事名称 <span className="text-[var(--adm-red)]">*</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：第三届华理瓦理杯" className={inputClass} />
            </label>
            <label className="block text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">
              主办方 <span className="text-[var(--adm-red)]">*</span>
              <input value={organizer} onChange={(e) => setOrganizer(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">
              比赛项目
              <input value={game} onChange={(e) => setGame(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">
              报名开始
              <input type="date" value={registrationStart} onChange={(e) => setRegistrationStart(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">
              报名截止
              <input type="date" value={registrationEnd} onChange={(e) => setRegistrationEnd(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">
              比赛日期展示
              <input value={eventDateLabel} onChange={(e) => setEventDateLabel(e.target.value)} placeholder="如：2026 年 10 月每周六、日（可留空）" className={inputClass} />
            </label>
            <label className="block text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">
              主题色
              <input type="color" value={coverColor} onChange={(e) => setCoverColor(e.target.value)} className={`${inputClass} p-1`} />
            </label>
          </div>
          <div className="mt-6 flex justify-between">
            <button type="button" onClick={() => router.push("/admin")} className="adm-btn adm-btn--secondary adm-btn--md">取消</button>
            <button type="button" onClick={() => setStep(2)} className="adm-btn adm-btn--primary adm-btn--md">下一步 →</button>
          </div>
        </div>
      )}

      {/* ② 赛制配置 */}
      {step === 2 && (
        <div>
          <StepHeader step={2} title="赛制配置" />
          <div className="space-y-3">
            {stages.map((st, index) => (
              <div key={index} className="border border-[var(--adm-line-soft)] bg-[var(--adm-surface)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[length:var(--adm-fs-sm)] font-medium text-[var(--adm-text-mute)]">阶段 {index + 1}</p>
                  {stages.length > 1 && (
                    <button type="button" onClick={() => removeStage(index)} className="adm-btn adm-btn--ghost adm-btn--md hover:text-[var(--adm-red-text)]">删除阶段</button>
                  )}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">
                    阶段名
                    <input value={st.name} onChange={(e) => updateStage(index, { name: e.target.value })} placeholder="如 小组赛" className={inputClass} />
                  </label>
                  <label className="block text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">
                    赛制类型
                    <select
                      value={st.type}
                      onChange={(e) => {
                        const type = e.target.value as StageType;
                        updateStage(index, { type, boType: STAGE_TYPE_DEFAULT_BO[type], ...(type === "gsl-groups" || type === "round-robin" ? { groupCount: 4 } : {}) });
                      }}
                      className={inputClass}
                    >
                      {(Object.keys(STAGE_TYPE_LABELS) as StageType[]).map((t) => (
                        <option key={t} value={t}>{STAGE_TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">
                    队伍数
                    <input type="number" min={2} max={128} value={st.teamCount} onChange={(e) => updateStage(index, { teamCount: Number(e.target.value) })} className={inputClass} />
                  </label>
                  <label className="block text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">
                    比赛局制
                    <select value={st.boType} onChange={(e) => updateStage(index, { boType: e.target.value as StageConfig["boType"] })} className={inputClass}>
                      <option value="BO1">BO1</option>
                      <option value="BO3">BO3</option>
                      <option value="BO5">BO5</option>
                    </select>
                  </label>
                  {(st.type === "gsl-groups" || st.type === "round-robin") && (
                    <label className="block text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">
                      分组数
                      <input type="number" min={1} max={16} value={st.groupCount ?? 4} onChange={(e) => updateStage(index, { groupCount: Number(e.target.value) })} className={inputClass} />
                    </label>
                  )}
                </div>
              </div>
            ))}
            <button type="button" onClick={addStage} className="adm-btn adm-btn--secondary adm-btn--md border-dashed">
              ＋ 添加阶段
            </button>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-[var(--adm-line-soft)] bg-[var(--adm-surface)] px-5 py-4">
            <p className="text-[length:var(--adm-fs-lg)] font-bold text-[var(--adm-text-soft)]">
              预估：<span className="font-semibold text-[var(--adm-text)]">{estimate.matchCount} 场</span> · 约 {estimate.hourEstimate} 比赛小时
            </p>
            {formatSupport.kind === "unsupported" && <p className="text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-warn-text)]">{formatSupport.message}</p>}
          </div>
          <div className="mt-6 flex justify-between">
            <button type="button" onClick={() => setStep(1)} className="adm-btn adm-btn--secondary adm-btn--md">← 上一步</button>
            <button type="button" onClick={handleCreate} disabled={saving || formatSupport.kind === "unsupported"} className="adm-btn adm-btn--primary adm-btn--md">
              {saving ? "创建中…" : "创建赛事"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
