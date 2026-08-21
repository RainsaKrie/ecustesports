"use client";

import { use, useState } from "react";
import Link from "next/link";
import Container from "@/components/layout/Container";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import { useParticipant } from "@/lib/scheduling/useParticipant";

const RANKS = ["铁", "青铜", "白银", "黄金", "铂金", "钻石", "超凡", "神话", "无畏战魂"];
const inputClass = "h-11 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#ff4655]";

export default function ParticipantManagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const event = useCurrentEventConfig(id);
  const participant = useParticipant(id);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [inviteGameId, setInviteGameId] = useState("");
  const [role, setRole] = useState<"首发" | "替补" | "教练">("首发");
  const [profileDraft, setProfileDraft] = useState<Partial<{ gameId: string; rank: string; qq: string; wechat: string; phone: string; college: string }>>({});

  function disconnect() {
    participant.disconnect();
    setMessage("");
    setCode("");
    setProfileDraft({});
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    participant.setError("");
    try {
      await action();
      setMessage(success);
    } catch (reason) {
      participant.setError(reason instanceof Error ? reason.message : "操作失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  if (participant.loading) {
    return <Container className="py-16"><div className="border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">正在读取参赛信息…</div></Container>;
  }

  if (!participant.data) {
    return (
      <Container className="py-12">
        <div className="mx-auto max-w-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-[#c83242]">PARTICIPANT ACCESS</p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">进入参赛管理</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{event.name} · 输入报名成功时保存的参赛管理码，无需注册账号。</p>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="粘贴参赛管理码" className={`${inputClass} mt-6 font-mono`} />
          {(participant.error || message) && <p className="mt-3 text-sm text-red-600">{participant.error || message}</p>}
          <button
            type="button"
            onClick={() => run(() => participant.connect(code), "已进入参赛管理。")}
            disabled={!code.trim() || busy}
            className="mt-4 w-full bg-[#ff4655] py-3 text-sm font-black text-white disabled:opacity-50"
          >
            {busy ? "验证中…" : "进入参赛管理"}
          </button>
          <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs">
            <span className="text-slate-500">还没有报名？</span>
            <Link href={`/events/${id}/register`} className="font-bold text-[#c83242]">前往选手报名 →</Link>
          </div>
        </div>
      </Container>
    );
  }

  const { data } = participant;
  const profile = {
    gameId: profileDraft.gameId ?? data.player.gameId,
    rank: profileDraft.rank ?? data.player.rank,
    qq: profileDraft.qq ?? data.player.qq ?? "",
    wechat: profileDraft.wechat ?? data.player.wechat ?? "",
    phone: profileDraft.phone ?? data.player.phone ?? "",
    college: profileDraft.college ?? data.player.college ?? "",
  };
  return (
    <Container className="py-8 sm:py-12">
      <div className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-[#c83242]">MY TOURNAMENT</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">我的参赛管理</h1>
          <p className="mt-2 text-sm text-slate-500">{event.name} · {data.player.gameId}</p>
        </div>
        <button onClick={disconnect} className="self-start border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600">退出当前身份</button>
      </div>

      {(participant.error || message) && (
        <div className={`mb-6 border p-4 text-sm ${participant.error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {participant.error || message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <section className="border border-slate-200 bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-950">报名信息</h2>
              <span className="bg-emerald-50 px-2 py-1 text-[0.625rem] font-bold text-emerald-700">{data.player.status}</span>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-600">游戏 ID<input value={profile.gameId} onChange={(e) => setProfileDraft({ ...profileDraft, gameId: e.target.value })} className={inputClass} /></label>
              <label className="text-xs font-bold text-slate-600">当前段位<select value={profile.rank} onChange={(e) => setProfileDraft({ ...profileDraft, rank: e.target.value })} className={inputClass}>{RANKS.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="text-xs font-bold text-slate-600">QQ<input value={profile.qq} onChange={(e) => setProfileDraft({ ...profileDraft, qq: e.target.value })} className={inputClass} /></label>
              <label className="text-xs font-bold text-slate-600">微信<input value={profile.wechat} onChange={(e) => setProfileDraft({ ...profileDraft, wechat: e.target.value })} className={inputClass} /></label>
              <label className="text-xs font-bold text-slate-600">手机号<input value={profile.phone} onChange={(e) => setProfileDraft({ ...profileDraft, phone: e.target.value })} className={inputClass} /></label>
              <label className="text-xs font-bold text-slate-600">学院<input value={profile.college} onChange={(e) => setProfileDraft({ ...profileDraft, college: e.target.value })} className={inputClass} /></label>
            </div>
            <button onClick={() => run(() => participant.saveProfile(profile), "报名信息已更新。") } disabled={busy} className="mt-5 bg-slate-950 px-5 py-2.5 text-xs font-black text-white disabled:opacity-50">保存修改</button>
          </section>

          <section id="teams" className="border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-lg font-black text-slate-950">我的队伍</h2>
            {data.team ? (
              <div className="mt-4">
                <div className="flex items-center justify-between bg-slate-50 p-4">
                  <div><p className="font-bold text-slate-900">{data.team.name}</p><p className="mt-1 text-xs text-slate-500">{data.isCaptain ? "你是队长" : "你是队员"} · {data.team.status}</p></div>
                  <span className="text-xs font-bold text-slate-500">首发 {data.team.members.filter((item) => item.role === "首发").length}/5</span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {data.team.members.map((member) => <div key={member.id} className="border border-slate-100 px-3 py-2 text-sm"><strong>{member.gameId}</strong><span className="ml-2 text-xs text-slate-400">{member.role}</span></div>)}
                </div>
                {data.isCaptain && !data.teamRegistrationClosed && (
                  <div className="mt-5 border-t border-slate-100 pt-5">
                    <p className="text-sm font-bold text-slate-900">邀请队员</p>
                    <p className="mt-1 text-xs text-slate-500">为保护报名信息，请输入对方完整游戏 ID；对方同意后才会入队。</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
                      <input value={inviteGameId} onChange={(e) => setInviteGameId(e.target.value)} placeholder="昵称#编号" className={inputClass} />
                      <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className={inputClass}><option>首发</option><option>替补</option><option>教练</option></select>
                      <button onClick={() => run(() => participant.sendTeamRequest({ type: "invitation", teamId: data.team!.id, targetGameId: inviteGameId, role }), "邀请已发送，等待对方确认。") } disabled={busy || !inviteGameId.trim()} className="bg-[#ff4655] px-4 py-3 text-xs font-black text-white disabled:opacity-50">发送邀请</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4">
                <div className="bg-amber-50 p-4 text-sm text-amber-800">你还没有加入队伍。可以创建队伍，或向下方队伍发送加入申请。</div>
                {!data.teamRegistrationClosed && <div className="mt-4 flex gap-2"><input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="输入新队伍名称" className={inputClass} /><button onClick={() => run(() => participant.createTeam(teamName), "队伍已创建，你已成为队长。") } disabled={busy || !teamName.trim()} className="shrink-0 bg-slate-950 px-5 text-xs font-black text-white disabled:opacity-50">创建队伍</button></div>}
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {data.teams.map((team) => <div key={team.id} className="border border-slate-200 p-4"><div className="flex justify-between gap-3"><div><p className="font-bold text-slate-900">{team.name}</p><p className="mt-1 text-xs text-slate-500">首发 {team.starterCount}/5</p></div>{!data.teamRegistrationClosed && team.starterCount < 5 && <button onClick={() => run(() => participant.sendTeamRequest({ type: "application", teamId: team.id, role: "首发" }), "申请已发送，等待队长处理。") } disabled={busy} className="self-start border border-[#ff4655] px-3 py-1.5 text-xs font-bold text-[#c83242]">申请加入</button>}</div></div>)}
                </div>
              </div>
            )}
          </section>

          <section className="border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-lg font-black text-slate-950">组队请求</h2>
            {data.requests.filter((item) => item.status === "pending").length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">当前没有待处理或等待确认的请求。</p>
            ) : (
              <div className="mt-4 space-y-3">
                {data.requests.filter((item) => item.status === "pending").map((request) => {
                  const title = request.type === "application"
                    ? request.canResolve
                      ? `${request.playerGameId} 申请加入 ${request.teamName}`
                      : `申请加入 ${request.teamName}`
                    : request.canResolve
                      ? `${request.teamName} 邀请你加入`
                      : `已邀请 ${request.playerGameId}`;
                  return (
                    <div key={request.id} className="flex flex-col gap-3 border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{title}</p>
                        <p className="mt-1 text-xs text-slate-500">{request.canResolve ? "等待你处理" : "等待对方处理"} · 角色：{request.role}</p>
                      </div>
                      {request.canResolve && (
                        <div className="flex gap-2">
                          <button disabled={busy} onClick={() => run(() => participant.resolveTeamRequest(request.id, "reject"), "已拒绝请求。") } className="border border-slate-300 px-3 py-2 text-xs font-bold disabled:opacity-50">拒绝</button>
                          <button disabled={busy} onClick={() => run(() => participant.resolveTeamRequest(request.id, "accept"), "已确认入队。") } className="bg-[#ff4655] px-3 py-2 text-xs font-black text-white disabled:opacity-50">同意</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-black text-slate-950">我的下一场</h2>
            {data.nextMatch ? <div className="mt-4"><p className="text-lg font-black">{data.nextMatch.teamAName} vs {data.nextMatch.teamBName}</p><p className="mt-2 text-sm text-slate-500">{data.nextMatch.startTime ? data.nextMatch.startTime.replace("T", " ") : "等待赛事组排期"}</p><p className="mt-1 text-xs text-slate-400">{data.nextMatch.phase} · {data.nextMatch.boType}</p></div> : <p className="mt-4 text-sm text-slate-400">暂无已确定的下一场比赛。</p>}
          </section>
          <section className="border border-slate-200 bg-[#101820] p-5 text-white">
            <h2 className="text-sm font-black">参赛管理码</h2>
            <p className="mt-2 text-xs leading-5 text-slate-400">换设备时需要使用，请不要发给他人。</p>
            <code className="mt-4 block break-all bg-black/25 p-3 text-xs text-slate-200">{participant.token}</code>
            <button onClick={() => navigator.clipboard.writeText(participant.token).then(() => setMessage("管理码已复制。"))} className="mt-3 border border-slate-600 px-3 py-2 text-xs font-bold">复制管理码</button>
          </section>
        </aside>
      </div>
    </Container>
  );
}
