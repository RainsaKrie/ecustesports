// =====================
// 抽签页的三个面板组件（2026-10-26 从 FormatDrawWorkspace.tsx 拆出）
// 拆分原因：主文件 980 行被架构守卫锁行。这三个是**纯展示组件**、props 自洽，搬出来零风险。
// =====================

import { FORMAT_TEMPLATES, type FormatStageConfig } from "@/lib/domains/schedule/format-templates";
import { AdminModal } from "@/components/admin/ui";

export function FormatChangeModal({
  hint,
  targetTemplate,
  onSelect,
  onClose,
  onConfirm,
  onCustom,
  busy,
}: {
  hint: string;
  targetTemplate: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  /** 自定义赛段链：交给父组件开编排器 */
  onCustom: () => void;
  busy: boolean;
}) {
  return (
    <AdminModal
      title="调整赛制"
      subtitle="报名人数与预期不符时，可在生成赛程前调整赛制；已生成赛程后将无法调整。"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onCustom} className="mr-auto adm-btn adm-btn--ghost adm-btn--md">自定义赛段链</button>
          <button type="button" onClick={onClose} className="adm-btn adm-btn--secondary adm-btn--md">取消</button>
          <button type="button" onClick={onConfirm} disabled={busy || !targetTemplate} className="adm-btn adm-btn--primary adm-btn--md">{busy ? "调整中…" : "确认调整"}</button>
        </>
      }
    >
      <>
        <div className="space-y-3 p-5">
          {hint && <p className="border border-[var(--adm-line-soft)] bg-white/[0.03] px-3 py-2.5 text-[length:var(--adm-fs-md)] font-bold leading-[1.65] text-[var(--adm-text-soft)]">{hint}</p>}
          {FORMAT_TEMPLATES.filter((template) => template.teamCount >= 8).map((template) => (
            <label key={template.id} className={`flex cursor-pointer items-start gap-3 border p-4 transition ${targetTemplate === template.id ? "border-[var(--adm-red)] bg-[var(--adm-red-soft)]" : "border-[var(--adm-line-soft)] bg-[var(--adm-surface)] hover:border-[var(--adm-text)]"}`}>
              <input type="radio" name="template" value={template.id} checked={targetTemplate === template.id} onChange={() => onSelect(template.id)} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-text)]">{template.name}</span>
                <span className="mt-1 block text-[length:var(--adm-fs-md)] leading-[1.65] text-[var(--adm-text-soft)]">{template.description}</span>
              </span>
            </label>
          ))}
        </div>
      </>
    </AdminModal>
  );
}

export function DrawActions({
  publishLabel,
  done,
  publishing,
  remaining,
  onOne,
  onAll,
  onRedraw,
  onPublish,
  lastText,
}: {
  publishLabel: string;
  done: boolean;
  publishing: boolean;
  remaining: number;
  onOne: () => void;
  onAll: () => void;
  onRedraw: () => void;
  onPublish: () => void;
  lastText: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 border-t border-[var(--adm-line-soft)] p-6">
      {done ? (
        <>
          <button onClick={onPublish} disabled={publishing} className="adm-btn adm-btn--primary adm-btn--lg hover:bg-[var(--adm-red-hover)]">{publishing ? "发布中…" : publishLabel}</button>
          <button onClick={onRedraw} className="adm-btn adm-btn--secondary adm-btn--lg">重新抽签</button>
        </>
      ) : (
        <>
          <button onClick={onOne} disabled={remaining === 0} className="adm-btn adm-btn--primary adm-btn--lg hover:bg-[var(--adm-red-hover)]">抽下一队</button>
          <button onClick={onAll} disabled={remaining === 0} className="adm-btn adm-btn--secondary adm-btn--lg">一键抽完</button>
          <button onClick={onRedraw} className="adm-btn adm-btn--ghost adm-btn--md hover:text-[var(--adm-red-text)]">重新开始</button>
        </>
      )}
      {lastText && <p className="w-full text-center text-[length:var(--adm-fs-lg)] font-semibold text-[var(--adm-red-text)]">{lastText}</p>}
    </div>
  );
}

export function StageProgress({ stages, activeIndex, complete }: { stages: FormatStageConfig[]; activeIndex: number; complete: boolean }) {
  return (
    <div className="mb-5 grid adm-panel sm:grid-cols-3">
      {stages.map((stage, index) => {
        const finished = complete || index < activeIndex;
        const active = !complete && index === activeIndex;
        const label = finished ? "已完成" : active ? "当前阶段" : "未解锁";
        return (
          <div key={`${stage.name}-${index}`} className={`flex items-center gap-3 px-4 py-4 ${index > 0 ? "border-t border-[var(--adm-line-soft)] sm:border-l sm:border-t-0" : ""}`}>
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center text-[length:var(--adm-fs-md)] font-medium ${finished ? "border border-[var(--adm-text-soft)] bg-transparent text-[var(--adm-text)]" : active ? "bg-[var(--adm-red)] text-white" : "bg-[var(--adm-surface-3)] text-[var(--adm-text-mute)]"}`}>{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0">
              <p className={`truncate text-[length:var(--adm-fs-lg)] font-semibold ${active ? "text-[var(--adm-red-text)]" : "text-[var(--adm-text)]"}`}>{stage.name}</p>
              <p className="mt-0.5 text-[length:var(--adm-fs-sm)] font-bold text-[var(--adm-text-mute)]">{label} · {stage.teamCount} 队 · {stage.boType}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

