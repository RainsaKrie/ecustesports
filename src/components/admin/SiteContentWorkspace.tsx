"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SiteContentWorkspaceProps {
  eventId: string;
  eventName: string;
  initialDescription: string;
  initialFooterStatus: string;
  suggestedDescription: string;
  suggestedFooterStatus: string;
  issues: string[];
}

export default function SiteContentWorkspace({
  eventId,
  eventName,
  initialDescription,
  initialFooterStatus,
  suggestedDescription,
  suggestedFooterStatus,
  issues,
}: SiteContentWorkspaceProps) {
  const router = useRouter();
  const [description, setDescription] = useState(initialDescription);
  const [footerStatus, setFooterStatus] = useState(initialFooterStatus);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const dirty = description !== initialDescription || footerStatus !== initialFooterStatus;

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/site-content", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, description, footerStatus }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "保存失败");
      setMessage("已同步官网");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {issues.length > 0 && (
        <section className="adm-note adm-note--danger p-5">
          <p className="text-[length:var(--adm-fs-sm)] font-medium tracking-[0.15em] text-[var(--adm-text-mute)]">赛后更新</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <ul className="space-y-1 text-[length:var(--adm-fs-md)] font-bold text-[var(--adm-text-soft)]">
              {issues.map((issue) => <li key={issue}>— {issue}</li>)}
            </ul>
            <button
              type="button"
              onClick={() => {
                setDescription(suggestedDescription);
                setFooterStatus(suggestedFooterStatus);
                setMessage("");
              }}
              className="adm-btn adm-btn--danger adm-btn--md hover:bg-[var(--adm-red)]"
            >
              填入赛后文案
            </button>
          </div>
        </section>
      )}

      <section className="adm-panel">
        <div className="border-b border-[var(--adm-line-soft)] px-5 py-4 sm:px-6">
          <p className="text-[length:var(--adm-fs-sm)] font-medium tracking-[0.15em] text-[var(--adm-text-mute)]">首页文案</p>
          <h2 className="mt-1 text-[length:var(--adm-fs-xl)] font-semibold text-[var(--adm-text)]">首页赛事简介</h2>
        </div>
        <div className="p-5 sm:p-6">
          <textarea
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setMessage("");
            }}
            rows={4}
            maxLength={280}
            aria-label="首页赛事简介"
            className="w-full resize-y adm-panel px-4 py-3 text-[length:var(--adm-fs-lg)] font-medium leading-[1.85] text-[var(--adm-text)] outline-none transition focus:border-[var(--adm-red)] focus:ring-2 focus:ring-[rgba(255,70,85,0.15)]"
          />
        </div>
      </section>

      <section className="adm-panel">
        <div className="border-b border-[var(--adm-line-soft)] px-5 py-4 sm:px-6">
          <p className="text-[length:var(--adm-fs-sm)] font-medium tracking-[0.15em] text-[var(--adm-text-mute)]">站点页脚</p>
          <h2 className="mt-1 text-[length:var(--adm-fs-xl)] font-semibold text-[var(--adm-text)]">页脚状态</h2>
        </div>
        <div className="p-5 sm:p-6">
          <input
            value={footerStatus}
            onChange={(event) => {
              setFooterStatus(event.target.value);
              setMessage("");
            }}
            maxLength={100}
            aria-label="页脚状态"
            className="h-[44px] w-full adm-panel px-4 text-[length:var(--adm-fs-lg)] font-bold text-[var(--adm-text)] outline-none transition focus:border-[var(--adm-red)] focus:ring-2 focus:ring-[rgba(255,70,85,0.15)]"
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--adm-line)] pt-5">
        <div className="flex gap-3">
          <Link href="/" target="_blank" className="adm-btn adm-btn--secondary adm-btn--md">预览官网</Link>
          <Link href={`/admin/events/${eventId}/schedule`} className="adm-btn adm-btn--secondary adm-btn--md">返回赛事</Link>
        </div>
        <div className="flex items-center gap-3">
          {message && <p className={`text-[length:var(--adm-fs-md)] font-bold ${message === "已同步官网" ? "text-[var(--adm-ok-text)]" : "text-[var(--adm-red-text)]"}`} role="status">{message}</p>}
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty || description.trim().length < 10 || footerStatus.trim().length < 4}
            className="adm-btn adm-btn--primary adm-btn--md hover:bg-[var(--adm-red-hover)]"
          >
            {saving ? "正在保存…" : `保存并同步 ${eventName}`}
          </button>
        </div>
      </div>
    </div>
  );
}
