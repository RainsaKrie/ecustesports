"use client";

// =====================
// 自定义赛制弹窗（2026-10-19）
//
// 从「调整赛制」弹窗里的「自定义赛段链」进入。里面是 StageChainEditor（漏斗 + 13 条规则实时校验）。
//
// 与既有模板流程的关系：**不动模板流程**，这是并列的第二条路。
// 保存走同一个接口（`api/admin/events/format` 的 `stages` 入参），
// 因此沿用它已有的两道护栏（已生成阶段不许改 / 晋级人数不许变）与留痕。
// =====================

import { useState } from "react";
import AdminModal from "@/components/admin/ui/AdminModal";
import StageChainEditor, { type EditorStage } from "@/components/admin/StageChainEditor";
import type { StageType } from "@/lib/domains/schedule/stage-chain-rules";

export interface ExistingStage {
  name: string;
  type: string;
  teamCount: number;
  boType: "BO1" | "BO3" | "BO5";
}

/** 把库里存的赛段转成编辑器形状：晋级数 = 下一段的进入数（末段为 1） */
function toEditorStages(stages: ExistingStage[]): EditorStage[] {
  return stages.map((stage, index) => {
    const next = stages[index + 1];
    const bo = Number.parseInt(stage.boType.replace("BO", ""), 10);
    return {
      name: stage.name,
      type: stage.type as StageType,
      advance: next ? next.teamCount : 1,
      bo: (bo === 1 || bo === 5 ? bo : 3) as 1 | 3 | 5,
    };
  });
}

export default function CustomFormatModal({
  eventId,
  teams,
  stages,
  onClose,
  onSaved,
}: {
  eventId: string;
  /** 当前确认参赛的队伍数（第一段的进入数） */
  teams: number;
  stages: ExistingStage[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<EditorStage[]>(() => toEditorStages(stages));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      // 编辑器只存 {名称, 类型, 晋级, BO} —— 这里补出库里要的 teamCount 与 boType
      let cursor = teams;
      const payload = value.map((stage) => {
        const row = {
          name: stage.name,
          type: stage.type,
          teamCount: cursor,
          boType: `BO${stage.bo}` as "BO1" | "BO3" | "BO5",
          ...(stage.type === "gsl-groups" || stage.type === "group-single-elim"
            ? { groupCount: Math.max(1, Math.round(cursor / 4)) }
            : {}),
        };
        cursor = stage.advance;
        return row;
      });
      const response = await fetch("/api/admin/events/format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, stages: payload }),
      });
      const data = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "保存赛制失败");
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存赛制失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminModal
      title="自定义赛制"
      subtitle={`${teams} 支队伍 · 从上往下就是赛程`}
      width="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="adm-btn adm-btn--secondary adm-btn--md">取消</button>
          <button type="button" onClick={save} disabled={busy} className="adm-btn adm-btn--primary adm-btn--md">
            {busy ? "保存中…" : "保存赛制"}
          </button>
        </>
      }
    >
      <div className="p-5">
        <StageChainEditor entrants={teams} value={value} onChange={setValue} />
        {error && (
          <p className="mt-3 border border-[var(--adm-red-line)] bg-[var(--adm-red-soft)] px-3 py-2 text-[length:var(--adm-fs-sm)] font-bold text-[var(--adm-red-text)]">
            {error}
          </p>
        )}
      </div>
    </AdminModal>
  );
}
