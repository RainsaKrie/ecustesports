"use client";

import { use, useState } from "react";
import Link from "next/link";
import Container from "@/components/layout/Container";
import Button from "@/components/ui/Button";
import GroupNotice from "@/components/events/GroupNotice";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import { participantTokenKey, usePublicRegistration } from "@/hooks/usePublicRegistration";
import { useParticipant } from "@/hooks/useParticipant";
import { getGameConfig } from "@/lib/games";

/** 段位阶梯与擅长位置取自游戏配置层（原先本文件里各写了一遍段位表与位置表）。 */
const GAME = getGameConfig();

/** 表单控件统一规格（2026-10-20 v8）：深底 + 1px 14% 线 + 44px 高 + 聚焦红框。
 *  高度用 px 定值 —— 桌面根字号 150%，rem 会把控件撑到 66px。 */
const inputClass =
  "min-h-[44px] w-full border border-[var(--pub-line-soft)] bg-white/[0.04] px-3 py-2 text-[14px] text-[var(--pub-txt)] placeholder:text-[13px] placeholder:text-[var(--pub-txt-mute)] focus:border-[var(--pub-red)] focus:outline-none focus:ring-2 focus:ring-[var(--pub-red)]";

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
      <Container className="ui-page">
        <div className="ui-frame ui-pad mx-auto max-w-[560px] text-center">
          <p className="ui-eyebrow">REGISTRATION COMPLETE</p>
          <h1 className="mt-2 text-[24px] font-black tracking-[-0.02em] text-[var(--pub-txt)]">已完成参赛报名</h1>
          <p className="mt-2 text-sm font-bold text-[var(--pub-txt-soft)]">{participant.data.player.gameId}</p>
          {/* 原来这里没有群号——换设备找回参赛信息的人就永远看不到群公告。
              这类人恰好最需要它（换了设备，群里消息可能也没了）。 */}
          {event.eventQqGroup && (
            <div className="mt-5 text-left">
              <GroupNotice group={event.eventQqGroup} />
            </div>
          )}
          <Link href={`/events/${id}/manage?section=team`} className="mt-5 block bg-[#ff4655] px-5 py-3 text-sm font-black text-white transition hover:bg-[#d83b48]">
            {participant.data.team ? "查看我的队伍" : "创建或加入队伍"}
          </Link>
          <Link href={`/events/${id}`} className="mt-3 block border border-[var(--pub-line)] px-5 py-3 text-sm font-black text-[var(--pub-txt-soft)]">
            返回赛事页
          </Link>
        </div>
      </Container>
    );
  }

  if (done) {
    return (
      <Container className="ui-page">
        <div className="ui-frame ui-pad mx-auto max-w-[560px] text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center border-l-2 border-l-[var(--pub-line)] bg-[var(--pub-card)] text-[var(--pub-txt)]">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-[var(--pub-txt)]">报名成功</h2>
          <p className="mt-3 text-sm font-medium text-[var(--pub-txt-soft)]">参赛身份已保存在当前浏览器</p>
          {event.eventQqGroup && (
            <div className="mt-4 text-left">
              <GroupNotice group={event.eventQqGroup} />
            </div>
          )}
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Link href={`/events/${id}/manage?section=team&mode=create`} className="bg-[#ff4655] px-5 py-3 text-sm font-black text-white transition hover:bg-[#d83b48]">
              创建队伍
            </Link>
            <Link href={`/events/${id}/manage?section=team`} className="border border-[#ff4655] px-5 py-3 text-sm font-black text-[var(--pub-red)] transition hover:bg-[rgba(255,70,85,0.12)]">
              加入队伍
            </Link>
          </div>
          <Link href={`/events/${id}/manage?section=profile`} className="mt-2 block border border-[var(--pub-line)] px-5 py-3 text-sm font-bold text-[var(--pub-txt-soft)] transition hover:border-[var(--pub-txt-mute)]">
            查看报名信息
          </Link>
          <details className="mt-5 border-t border-[var(--pub-line)] pt-4 text-left">
            <summary className="cursor-pointer text-xs font-bold text-[var(--pub-txt-soft)]">备用参赛码</summary>
            <code className="mt-3 block break-all bg-white/[0.06] p-3 text-xs text-[var(--pub-txt-soft)]">{manageToken}</code>
            <Button
              variant="secondary"
              size="md"
              onClick={() => navigator.clipboard.writeText(manageToken).then(() => setCopied(true))}
              className="mt-2 w-full"
            >
              {copied ? "已复制" : "复制参赛码"}
            </Button>
          </details>
          <div className="mt-5 text-xs font-medium text-[var(--pub-txt-soft)]">
            换设备时可用学号和报名手机号找回
          </div>
        </div>
      </Container>
    );
  }

  return (
    <Container className="ui-page">
      <div className="mx-auto max-w-[640px]">
        <header className="ui-hero">
          <p className="ui-eyebrow">REGISTRATION / 选手报名</p>
          <h1>
            选手报名<em>.</em>
          </h1>
          <p className="ui-sub">{event.name} · 填写真实信息完成报名，提交后会生成你的参赛码。</p>
          <Link href={`/events/${id}/manage?recover=1`} className="mt-4 inline-flex min-h-[36px] items-center text-[13px] font-bold text-[var(--pub-red)] hover:underline">已经报过名？找回参赛信息</Link>
          {phase !== "open" && (
            <div className={`mt-4 border-l-2 px-3 py-2 text-[12.5px] font-bold ${phase === "not-open" ? "border-l-[var(--pub-red)] bg-[rgba(255,70,85,0.10)] text-[var(--pub-red)]" : "border-l-[var(--pub-line)] bg-white/[0.04] text-[var(--pub-txt-soft)]"}`}>
              {phase === "not-open"
                ? `报名未开放，开始时间：${event.registrationStart || "待公布"}`
                : `报名已截止（截止 ${event.registrationEnd || ""}）`}
            </div>
          )}
        </header>

        {/* 群公告放**表单之前**：一进页面就能看到，也方便先加群问清楚再报名。
            原先放在表单最底部（自我介绍之后），等于填完才看到——
            和「报完名才知道」是同一个问题，只提前了一步。 */}
        {event.eventQqGroup && (
          <div className="mt-5">
            <GroupNotice group={event.eventQqGroup} />
          </div>
        )}

        <div className="ui-frame ui-pad mt-5">
          <div className="space-y-3 md:space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--pub-txt-soft)]">姓名 <span className="text-[var(--pub-red)]">*</span></label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="真实姓名（仅负责人可见）" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--pub-txt-soft)]">学号 <span className="text-[var(--pub-red)]">*</span></label>
              <input type="text" value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="用于身份核验（仅负责人可见）" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--pub-txt-soft)]">游戏 ID <span className="text-[var(--pub-red)]">*</span></label>
              <input type="text" value={gameId} onChange={(e) => setGameId(e.target.value)} placeholder="如：玩家昵称#1234" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--pub-txt-soft)]">当前段位 <span className="text-[var(--pub-red)]">*</span></label>
              <select value={rank} onChange={(e) => setRank(e.target.value)} className={inputClass}>
                <option value="">请选择段位</option>
                {GAME.ranks.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div className="border-t border-[var(--pub-line-soft)] pt-3 md:pt-4">
              <p className="mb-3 text-xs font-medium text-[var(--pub-txt-soft)]">联系方式（必填）</p>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-[var(--pub-txt-soft)]">QQ 号 <span className="text-[var(--pub-red)]">*</span></label>
                  <input type="text" inputMode="numeric" value={qq} onChange={(e) => setQq(e.target.value)} placeholder="QQ 号" className={inputClass} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-[var(--pub-txt-soft)]">手机号 <span className="text-[var(--pub-red)]">*</span></label>
                  <input type="text" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="手机号" className={inputClass} />
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--pub-txt-soft)]">擅长位置 <span className="text-[var(--pub-red)]">*</span></label>
              <p className="mb-2 text-xs text-[var(--pub-txt-soft)]">可多选，将用于分组与队伍位置协调</p>
              <div className="flex flex-wrap gap-2">
                {GAME.positions.map((pos) => {
                  const active = positions.includes(pos);
                  return (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => togglePosition(pos)}
                      className={`inline-flex h-[38px] items-center border px-4 text-[13.5px] font-bold transition-colors ${active ? "border-[var(--pub-red)] bg-[rgba(255,70,85,0.12)] text-[var(--pub-red)]" : "border-[var(--pub-line-soft)] bg-transparent text-[var(--pub-txt-soft)] hover:border-[var(--pub-line)] hover:text-[var(--pub-txt)]"}`}
                    >
                      {pos}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--pub-txt-soft)]">自我介绍（选填）</label>
              <textarea value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="简单介绍自己，比如擅长英雄、参赛经历等" rows={4} className={inputClass} />
            </div>

            {error && (
              <div className="border-l-2 border-l-[var(--pub-red)] bg-[rgba(255,70,85,0.08)] px-3 py-2 text-[13px] font-bold text-[var(--pub-red)]">{error}</div>
            )}

            <Button
              variant="primary"
              size="lg"
              type="submit"
              onClick={handleSubmit}
              disabled={phase !== "open"}
              className="w-full"
            >
              {phase === "not-open" ? "报名未开放" : phase === "closed" ? "报名已截止" : "提交报名"}
            </Button>
          </div>
        </div>
      </div>
    </Container>
  );
}
