"use client";

import { use, useState } from "react";
import Link from "next/link";
import Container from "@/components/layout/Container";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import { participantTokenKey, usePublicRegistration } from "@/lib/scheduling/usePublicRegistration";
import { useParticipant } from "@/lib/scheduling/useParticipant";
import { POSITIONS } from "@/lib/scheduling/registration-data";

const RANKS = ["铁", "青铜", "白银", "黄金", "铂金", "钻石", "超凡", "神话", "无畏战魂"];

const inputClass =
  "w-full border border-gray-300 px-2.5 py-2 text-sm placeholder:text-xs placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#ff4655] focus:border-transparent";

export default function RegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const event = useCurrentEventConfig(id);
  const { state } = usePublicRegistration(id);
  const participant = useParticipant(id);

  const now = new Date();
  const start = event.registrationStart ? new Date(`${event.registrationStart}T00:00:00`) : null;
  const end = event.registrationEnd ? new Date(`${event.registrationEnd}T23:59:59`) : null;
  const phase: "not-open" | "open" | "closed" =
    start && now < start ? "not-open" : state.playerRegistrationClosed || (end && now > end) ? "closed" : "open";

  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [gameId, setGameId] = useState("");
  const [rank, setRank] = useState("");
  const [qq, setQq] = useState("");
  const [phone, setPhone] = useState("");
  const [positions, setPositions] = useState<string[]>([]);
  const [intro, setIntro] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [manageToken, setManageToken] = useState("");
  const [copied, setCopied] = useState(false);

  function togglePosition(position: string) {
    setPositions((current) =>
      current.includes(position) ? current.filter((item) => item !== position) : [...current, position],
    );
  }

  async function handleSubmit() {
    if (phase !== "open") return;
    if (!name.trim() || !studentId.trim() || !gameId.trim() || !rank) {
      setError("姓名、学号、游戏 ID 和段位为必填项。");
      return;
    }
    if (!qq.trim() || !phone.trim()) {
      setError("QQ 号和手机号为必填项，用于后续通知。");
      return;
    }
    if (positions.length === 0) {
      setError("请至少选择一个擅长位置。");
      return;
    }
    try {
      const response = await fetch("/api/public/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: id,
          name: name.trim(),
          studentId: studentId.trim(),
          gameId: gameId.trim(),
          rank,
          qq: qq.trim(),
          phone: phone.trim(),
          positions,
          intro: intro.trim() || undefined,
        }),
      });
      const result = await response.json() as { manageToken?: string; message?: string };
      if (!response.ok || !result.manageToken) throw new Error(result.message ?? "报名提交失败，请稍后重试。");
      localStorage.setItem(participantTokenKey(id), result.manageToken);
      setManageToken(result.manageToken);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "报名提交失败，请稍后重试。");
      return;
    }
    setError("");
    setDone(true);
  }

  if (participant.data && !done) {
    return (
      <Container className="py-10">
        <div className="mx-auto max-w-lg border border-black/10 bg-[#fffdf8] p-7 text-center sm:p-9">
          <p className="font-mono text-[0.625rem] font-black tracking-[0.16em] text-[#c83242]">REGISTRATION COMPLETE</p>
          <h1 className="mt-3 text-2xl font-black text-[#171a1f]">已完成参赛报名</h1>
          <p className="mt-2 text-sm font-bold text-[#34383f]">{participant.data.player.gameId}</p>
          <Link href={`/events/${id}/manage?section=team`} className="mt-7 block bg-[#ff4655] px-5 py-3 text-sm font-black text-white transition hover:bg-[#d83b48]">
            {participant.data.team ? "查看我的队伍" : "创建或加入队伍"}
          </Link>
          <Link href={`/events/${id}`} className="mt-3 block border border-black/15 px-5 py-3 text-sm font-black text-[#34383f]">
            返回赛事页
          </Link>
        </div>
      </Container>
    );
  }

  if (done) {
    return (
      <Container className="py-8">
        <div className="mx-auto max-w-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center  bg-emerald-50 text-emerald-600">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900">报名成功</h2>
          <p className="mt-3 text-sm font-medium text-slate-600">参赛身份已保存在当前浏览器</p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Link href={`/events/${id}/manage?section=team&mode=create`} className="bg-[#ff4655] px-5 py-3 text-sm font-black text-white transition hover:bg-[#d83b48]">
              创建队伍
            </Link>
            <Link href={`/events/${id}/manage?section=team`} className="border border-[#ff4655] px-5 py-3 text-sm font-black text-[#c83242] transition hover:bg-red-50">
              加入队伍
            </Link>
          </div>
          <Link href={`/events/${id}/manage?section=profile`} className="mt-2 block border border-gray-300 px-5 py-3 text-sm font-bold text-gray-700 transition hover:border-gray-500">
            查看报名信息
          </Link>
          <details className="mt-5 border-t border-slate-200 pt-4 text-left">
            <summary className="cursor-pointer text-xs font-bold text-slate-500">备用参赛码</summary>
            <code className="mt-3 block break-all bg-slate-50 p-3 text-xs text-slate-600">{manageToken}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(manageToken).then(() => setCopied(true))}
              className="mt-2 w-full border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
            >
              {copied ? "已复制" : "复制参赛码"}
            </button>
          </details>
          <div className="mt-5 text-xs font-medium text-slate-500">
            换设备时可用学号和报名手机号找回
          </div>
        </div>
      </Container>
    );
  }

  return (
    <Container className="py-6 md:py-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-4 text-center md:mb-6">
          <h1 className="text-xl font-bold text-gray-900 md:text-2xl">{event.name} · 选手报名</h1>
          <Link href={`/events/${id}/manage?recover=1`} className="mt-3 inline-block text-xs font-bold text-[#c83242]">已经报过名？找回参赛信息</Link>
          {phase !== "open" && (
            <div className={`mx-auto mt-3 max-w-md px-4 py-2.5 text-xs font-bold md:mt-4 md:py-3 md:text-sm ${phase === "not-open" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
              {phase === "not-open"
                ? `报名未开放，开始时间：${event.registrationStart || "待公布"}`
                : `报名已截止（截止 ${event.registrationEnd || ""}）`}
            </div>
          )}
        </div>

        <div className="border border-gray-200 bg-white p-5 shadow-sm md:p-6">
          <div className="space-y-3 md:space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">姓名 <span className="text-red-500">*</span></label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="真实姓名（仅负责人可见）" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">学号 <span className="text-red-500">*</span></label>
              <input type="text" value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="用于身份核验（仅负责人可见）" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">游戏 ID <span className="text-red-500">*</span></label>
              <input type="text" value={gameId} onChange={(e) => setGameId(e.target.value)} placeholder="如：玩家昵称#1234" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">当前段位 <span className="text-red-500">*</span></label>
              <select value={rank} onChange={(e) => setRank(e.target.value)} className={inputClass}>
                <option value="">请选择段位</option>
                {RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div className="border-t border-gray-100 pt-3 md:pt-4">
              <p className="mb-3 text-xs font-medium text-gray-500">联系方式（必填）</p>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">QQ 号 <span className="text-red-500">*</span></label>
                  <input type="text" value={qq} onChange={(e) => setQq(e.target.value)} placeholder="QQ 号" className={inputClass} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">手机号 <span className="text-red-500">*</span></label>
                  <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="手机号" className={inputClass} />
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">擅长位置 <span className="text-red-500">*</span></label>
              <p className="mb-2 text-xs text-gray-500">可多选，将用于分组与队伍位置协调</p>
              <div className="flex flex-wrap gap-2">
                {POSITIONS.map((pos) => {
                  const active = positions.includes(pos);
                  return (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => togglePosition(pos)}
                      className={`border px-4 py-2 text-sm transition ${active ? "border-[#ff4655] bg-[#ff4655] text-white" : "border-gray-300 bg-white text-gray-700 hover:border-[#ff4655]"}`}
                    >
                      {pos}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">自我介绍（选填）</label>
              <textarea value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="简单介绍自己，比如擅长英雄、参赛经历等" rows={4} className={inputClass} />
            </div>

            {error && (
              <div className="bg-red-50 p-3 text-sm text-red-600">{error}</div>
            )}

            <button
              onClick={handleSubmit}
              disabled={phase !== "open"}
              className={`w-full py-3 text-sm font-bold text-white transition ${phase === "open" ? "bg-[#ff4655] hover:bg-[#d83b48]" : "cursor-not-allowed bg-slate-300"}`}
            >
              {phase === "not-open" ? "报名未开放" : phase === "closed" ? "报名已截止" : "提交报名"}
            </button>
          </div>
        </div>
      </div>
    </Container>
  );
}
