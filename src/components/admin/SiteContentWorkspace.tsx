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
        <section className="border border-[#ff4655]/35 bg-[#fff1f2] p-5">
          <p className="font-mono text-[0.625rem] font-black tracking-[0.15em] text-[#c83242]">POST-EVENT UPDATE</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <ul className="space-y-1 text-xs font-bold text-[#34383f]">
              {issues.map((issue) => <li key={issue}>— {issue}</li>)}
            </ul>
            <button
              type="button"
              onClick={() => {
                setDescription(suggestedDescription);
                setFooterStatus(suggestedFooterStatus);
                setMessage("");
              }}
              className="min-h-11 border border-[#ff4655] bg-white px-4 py-2 text-xs font-black text-[#c83242] transition hover:bg-[#ff4655] hover:text-white"
            >
              填入赛后文案
            </button>
          </div>
        </section>
      )}

      <section className="border border-black/10 bg-[#fffdf8]">
        <div className="border-b border-black/10 px-5 py-4 sm:px-6">
          <p className="font-mono text-[0.625rem] font-black tracking-[0.15em] text-[#c83242]">HOME EVENT COPY</p>
          <h2 className="mt-1 text-lg font-black text-[#171a1f]">首页赛事简介</h2>
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
            className="w-full resize-y border border-black/15 bg-white px-4 py-3 text-sm font-medium leading-7 text-[#171a1f] outline-none transition focus:border-[#ff4655] focus:ring-2 focus:ring-[#ff4655]/15"
          />
        </div>
      </section>

      <section className="border border-black/10 bg-[#fffdf8]">
        <div className="border-b border-black/10 px-5 py-4 sm:px-6">
          <p className="font-mono text-[0.625rem] font-black tracking-[0.15em] text-[#c83242]">FOOTER STATUS</p>
          <h2 className="mt-1 text-lg font-black text-[#171a1f]">页脚状态</h2>
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
            className="h-12 w-full border border-black/15 bg-white px-4 text-sm font-bold text-[#171a1f] outline-none transition focus:border-[#ff4655] focus:ring-2 focus:ring-[#ff4655]/15"
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-black/15 pt-5">
        <div className="flex gap-3">
          <Link href="/" target="_blank" className="border border-black/15 bg-[#fffdf8] px-4 py-3 text-xs font-black text-[#34383f]">预览官网</Link>
          <Link href={`/admin/events/${eventId}/schedule`} className="border border-black/15 bg-[#fffdf8] px-4 py-3 text-xs font-black text-[#34383f]">返回赛事</Link>
        </div>
        <div className="flex items-center gap-3">
          {message && <p className={`text-xs font-bold ${message === "已同步官网" ? "text-emerald-700" : "text-red-700"}`} role="status">{message}</p>}
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty || description.trim().length < 10 || footerStatus.trim().length < 4}
            className="min-h-12 bg-[#ff4655] px-6 py-3 text-xs font-black text-white transition hover:bg-[#d93746] disabled:cursor-not-allowed disabled:bg-[#d9a6aa]"
          >
            {saving ? "正在保存…" : `保存并同步 ${eventName}`}
          </button>
        </div>
      </div>
    </div>
  );
}
