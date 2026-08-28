"use client";

import { use, useState } from "react";
import Link from "next/link";
import Container from "@/components/layout/Container";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import { useParticipant } from "@/lib/scheduling/useParticipant";

const RANKS = ["铁", "青铜", "白银", "黄金", "铂金", "钻石", "超凡", "神话", "无畏战魂"];
const inputClass = "h-10 w-full border border-black/15 bg-[#fffdf8] px-3 text-sm font-semibold text-[#171a1f] outline-none focus:border-[#ff4655]";

function formatMatchTime(value: string): string {
  if (!value) return "时间待定";
  return value.slice(0, 16).replace("T", " ");
}

export default function ParticipantManagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const event = useCurrentEventConfig(id);
  const participant = useParticipant(id);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [inviteGameId, setInviteGameId] = useState("");
  const [role, setRole] = useState<"首发" | "替补" | "教练">("首发");
  const [proposedTime, setProposedTime] = useState("");
  const [proposedReason, setProposedReason] = useState("");
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
    return <Container className="py-16"><div className="border border-black/10 bg-[#fffdf8] p-12 text-center text-sm font-bold text-[#60656d]">正在读取参赛信息…</div></Container>;
  }

  if (!participant.data) {
    return (
      <Container className="py-12">
        <div className="mx-auto max-w-lg border border-black/10 bg-[#fffdf8] p-6 sm:p-8">
          <p className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-[#c83242]">PARTICIPANT ACCESS</p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">进入参赛管理</h1>
          <p className="mt-2 text-sm font-bold text-[#34383f]">{event.name}</p>
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
            <span className="font-bold text-[#60656d]">尚未报名</span>
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
    <Container className="py-8 sm:py-10">
      <div className="mb-6 flex flex-col gap-4 border-b border-black/15 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-[#c83242]">MY TOURNAMENT</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">参赛中心</h1>
          <p className="mt-2 text-sm font-bold text-[#34383f]">{event.name} · {data.player.gameId}</p>
        </div>
        <button onClick={disconnect} className="self-start border border-black/15 px-4 py-2.5 text-xs font-black text-[#34383f] hover:border-[#ff4655] hover:text-[#c83242]">切换身份</button>
      </div>

      {(participant.error || message) && (
        <div className={`mb-6 border p-4 text-sm ${participant.error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {participant.error || message}
        </div>
      )}

      <nav className="mb-6 grid border border-black/10 bg-[#fffdf8] sm:grid-cols-3" aria-label="参赛中心导航">
        <a href="#schedule" className="border-b border-black/10 px-5 py-3.5 text-sm font-black text-[#171a1f] transition hover:bg-[#fff1f2] hover:text-[#c83242] sm:border-b-0 sm:border-r">我的比赛</a>
        <a href="#teams" className="border-b border-black/10 px-5 py-3.5 text-sm font-black text-[#171a1f] transition hover:bg-[#fff1f2] hover:text-[#c83242] sm:border-b-0 sm:border-r">队伍管理</a>
        <a href="#profile" className="px-5 py-3.5 text-sm font-black text-[#171a1f] transition hover:bg-[#fff1f2] hover:text-[#c83242]">报名信息</a>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section id="profile" className="order-4 scroll-mt-24 border border-black/10 bg-[#fffdf8] p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-950">报名信息</h2>
              <span className="bg-emerald-50 px-2 py-1 text-[0.625rem] font-bold text-emerald-700">{data.player.status}</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-600">游戏 ID<input value={profile.gameId} onChange={(e) => setProfileDraft({ ...profileDraft, gameId: e.target.value })} className={inputClass} /></label>
              <label className="text-xs font-bold text-slate-600">当前段位<select value={profile.rank} onChange={(e) => setProfileDraft({ ...profileDraft, rank: e.target.value })} className={inputClass}>{RANKS.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="text-xs font-bold text-slate-600">QQ<input value={profile.qq} onChange={(e) => setProfileDraft({ ...profileDraft, qq: e.target.value })} className={inputClass} /></label>
              <label className="text-xs font-bold text-slate-600">微信<input value={profile.wechat} onChange={(e) => setProfileDraft({ ...profileDraft, wechat: e.target.value })} className={inputClass} /></label>
              <label className="text-xs font-bold text-slate-600">手机号<input value={profile.phone} onChange={(e) => setProfileDraft({ ...profileDraft, phone: e.target.value })} className={inputClass} /></label>
              <label className="text-xs font-bold text-slate-600">学院<input value={profile.college} onChange={(e) => setProfileDraft({ ...profileDraft, college: e.target.value })} className={inputClass} /></label>
            </div>
            <button onClick={() => run(() => participant.saveProfile(profile), "报名信息已更新。") } disabled={busy} className="mt-5 bg-[#ff4655] px-5 py-2.5 text-xs font-black text-white disabled:opacity-50">保存修改</button>
          </section>

          <section id="teams" className="order-2 scroll-mt-24 border border-black/10 bg-[#fffdf8] p-5 sm:p-6">
            <h2 className="text-lg font-black text-slate-950">我的队伍</h2>
            {data.team ? (
              <div className="mt-4">
                <div className="flex items-center justify-between bg-slate-50 p-4">
                  <div><p className="font-bold text-slate-900">{data.team.name}</p><p className="mt-1 text-xs text-slate-500">{data.isCaptain ? "你是队长" : "你是队员"} · {data.team.status}</p></div>
                  <span className="text-xs font-bold text-slate-500">5 首发 · 1 替补 · 1 教练</span>
                </div>
                <div className="mt-3 grid gap-3">
                  {([
                    { role: "首发" as const, limit: 5 },
                    { role: "替补" as const, limit: 1 },
                    { role: "教练" as const, limit: 1 },
                  ]).map(({ role: rosterRole, limit }) => {
                    const roleMembers = data.team!.members.filter((member) => member.role === rosterRole);
                    return (
                      <div key={rosterRole} className="grid gap-2 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
                        <div className="pt-2 text-xs font-black text-slate-500">{rosterRole} {roleMembers.length}/{limit}</div>
                        <div className={`grid gap-2 ${rosterRole === "首发" ? "sm:grid-cols-2" : ""}`}>
                          {Array.from({ length: limit }, (_, index) => {
                            const member = roleMembers[index];
                            return <div key={member?.id ?? `${rosterRole}-${index}`} className={`min-h-11 border px-3 py-2 text-sm ${member ? "border-slate-200 bg-white" : "border-dashed border-slate-300 bg-slate-50 text-slate-400"}`}><strong>{member?.gameId ?? `${rosterRole === "首发" ? `首发 ${index + 1}` : rosterRole} · 空缺`}</strong></div>;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {data.isCaptain && !data.teamRegistrationClosed && (
                  <div className="mt-5 border-t border-slate-100 pt-5">
                    <p className="text-sm font-bold text-slate-900">邀请队员</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
                      <input value={inviteGameId} onChange={(e) => setInviteGameId(e.target.value)} placeholder="完整游戏 ID（昵称#编号）" className={inputClass} />
                      <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className={inputClass}><option>首发</option><option>替补</option><option>教练</option></select>
                      <button onClick={() => run(() => participant.sendTeamRequest({ type: "invitation", teamId: data.team!.id, targetGameId: inviteGameId, role }), "邀请已发送，等待对方确认。") } disabled={busy || !inviteGameId.trim()} className="bg-[#ff4655] px-4 py-3 text-xs font-black text-white disabled:opacity-50">发送邀请</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4">
                <div className="border-l-2 border-[#ff4655] bg-[#f2eee6] p-4 text-sm font-black text-[#34383f]">尚未加入队伍</div>
                {!data.teamRegistrationClosed && <div className="mt-4 flex gap-2"><input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="队伍名称" className={inputClass} /><button onClick={() => run(() => participant.createTeam(teamName), "队伍已创建，你已成为队长。") } disabled={busy || !teamName.trim()} className="shrink-0 bg-[#ff4655] px-5 text-xs font-black text-white disabled:opacity-50">创建队伍</button></div>}
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {data.teams.map((team) => <div key={team.id} className="border border-slate-200 p-4"><div className="flex justify-between gap-3"><div><p className="font-bold text-slate-900">{team.name}</p><p className="mt-1 text-xs text-slate-500">首发 {team.starterCount}/5 · 替补 {team.substituteCount}/1 · 教练 {team.coachCount}/1</p></div>{!data.teamRegistrationClosed && team.starterCount < 5 && <button onClick={() => run(() => participant.sendTeamRequest({ type: "application", teamId: team.id, role: "首发" }), "申请已发送，等待队长处理。") } disabled={busy} className="self-start border border-[#ff4655] px-3 py-1.5 text-xs font-bold text-[#c83242]">申请加入</button>}</div></div>)}
                </div>
              </div>
            )}
          </section>

          <section id="schedule" className="order-1 scroll-mt-24 border border-black/10 bg-[#fffdf8] p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-[#c83242]">MY MATCH</p>
                <h2 className="mt-2 text-lg font-black text-slate-950">我的比赛</h2>
              </div>
              {data.nextMatch && <span className="border border-slate-200 px-2 py-1 text-[0.625rem] font-bold text-slate-500">{data.nextMatch.id} · {data.nextMatch.boType}</span>}
            </div>

            {!data.team ? (
              <p className="mt-5 border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">尚未加入队伍</p>
            ) : !data.nextMatch ? (
              <p className="mt-5 text-sm text-slate-500">暂无待安排比赛</p>
            ) : (
              <div className="mt-5 space-y-5">
                <div className="grid gap-3 border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <p className="text-sm font-black text-slate-950">{data.nextMatch.teamAName} vs {data.nextMatch.teamBName}</p>
                    <p className="mt-1 text-xs text-slate-500">{data.nextMatch.phase} · 当前时间：{formatMatchTime(data.nextMatch.startTime)}</p>
                  </div>
                  <span className="text-xs font-bold text-slate-500">赛程 v{data.scheduleVersion}</span>
                </div>

                {(data.scheduleRequests ?? []).length > 0 && (
                  <div className="space-y-3">
                    {(data.scheduleRequests ?? []).map((request) => (
                      <div key={request.id} className={`border p-4 ${request.status === "待对手确认" || request.status === "待审批" ? "border-[#ff4655]/40 bg-[#fff7f7]" : "border-slate-200"}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-black text-slate-950">{formatMatchTime(request.newStartTime)}</p>
                            <p className="mt-1 text-xs text-slate-500">{request.teamAName} vs {request.teamBName} · {request.reason || "双方协商时间"}</p>
                          </div>
                          <span className="border border-current px-2 py-1 text-[0.625rem] font-bold text-[#c83242]">{request.status}</span>
                        </div>
                        <p className="mt-3 text-xs font-medium text-slate-600">
                          {request.status === "待对手确认"
                            ? request.canConfirm ? "对手队长已提出时间，请确认双方是否达成一致。" : "已提交，等待对手队长确认。"
                            : request.status === "待审批" ? "双方已经确认，等待赛事负责人批准后生效。"
                              : request.status === "已批准" ? "赛事负责人已批准，最新时间已写入赛程。"
                                : request.status === "已失效" ? "赛程或约束已经变化，请重新协商时间。" : "该申请未生效。"}
                        </p>
                        {request.conflicts.length > 0 && <ul className="mt-3 space-y-1 text-xs text-red-600">{request.conflicts.map((conflict) => <li key={`${request.id}-${conflict.code}`}>[{conflict.code}] {conflict.message}</li>)}</ul>}
                        {request.canConfirm && (
                          <div className="mt-4 flex gap-2">
                            <button disabled={busy} onClick={() => run(() => participant.resolveScheduleRequest(request.id, "reject"), "已拒绝该时间，请双方重新协商。") } className="border border-slate-300 px-4 py-2.5 text-xs font-bold disabled:opacity-50">拒绝</button>
                            <button disabled={busy} onClick={() => run(() => participant.resolveScheduleRequest(request.id, "accept"), "已确认时间，等待赛事负责人审批。") } className="bg-[#ff4655] px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">确认时间</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {data.isCaptain && (
                  !(data.scheduleRequests ?? []).some((request) => request.matchId === data.nextMatch!.id && ["待对手确认", "待审批"].includes(request.status)) && (
                    <div className="border-t border-slate-100 pt-5">
                      <p className="text-sm font-black text-slate-950">队长约赛与改期</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                        <input type="datetime-local" value={proposedTime} onChange={(event) => setProposedTime(event.target.value)} className={inputClass} />
                        <input value={proposedReason} onChange={(event) => setProposedReason(event.target.value)} placeholder={data.nextMatch.startTime ? "改期原因" : "备注（选填）"} className={inputClass} />
                        <button
                          disabled={busy || !proposedTime || !data.scheduleConfigConfirmed}
                          onClick={() => run(
                            () => participant.createScheduleRequest(data.nextMatch!.id, proposedTime, proposedReason),
                            "约赛时间已提交，等待对手队长确认。",
                          ).then(() => { setProposedTime(""); setProposedReason(""); })}
                          className="bg-[#ff4655] px-5 py-3 text-xs font-black text-white disabled:opacity-50"
                        >提交时间</button>
                      </div>
                      <p className={`mt-3 text-[0.625rem] font-medium ${data.scheduleConfigConfirmed ? "text-slate-400" : "text-amber-700"}`}>{data.scheduleConfigConfirmed ? `允许范围：${formatMatchTime(data.scheduleConfig.stageStart)} 至 ${formatMatchTime(data.scheduleConfig.stageEnd)} · 同时最多 ${data.scheduleConfig.maxConcurrentMatches} 场` : "赛事负责人尚未确认排程时间范围，当前不能提交。"}</p>
                    </div>
                  )
                )}
              </div>
            )}
          </section>

          <section className="order-3 border border-black/10 bg-[#fffdf8] p-5 sm:p-6">
            <h2 className="text-lg font-black text-slate-950">组队请求</h2>
            {data.requests.filter((item) => item.status === "pending").length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">暂无组队请求</p>
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
          <section className="border border-black/10 bg-[#fffdf8] p-5">
            <p className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-[#c83242]">NEXT MATCH</p>
            <h2 className="mt-2 text-lg font-black text-[#171a1f]">我的下一场</h2>
            {data.nextMatch ? <div className="mt-4 border-l-2 border-[#ff4655] pl-4"><p className="text-lg font-black">{data.nextMatch.teamAName} vs {data.nextMatch.teamBName}</p><p className="mt-2 text-sm font-bold text-[#34383f]">{data.nextMatch.startTime ? data.nextMatch.startTime.replace("T", " ") : "待排期"}</p><p className="mt-1 text-xs font-bold text-[#60656d]">{data.nextMatch.phase} · {data.nextMatch.boType}</p></div> : <p className="mt-4 text-sm font-bold text-[#60656d]">尚未排定</p>}
          </section>
          <section className="border border-black/10 border-t-[3px] border-t-[#ff4655] bg-[#fffdf8] p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[0.625rem] font-black tracking-[0.14em] text-[#c83242]">ACCESS CODE</p>
                <h2 className="mt-2 text-lg font-black text-[#171a1f]">参赛管理码</h2>
              </div>
              <span className="bg-[#f2eee6] px-2 py-1 text-[0.625rem] font-black text-[#34383f]">本设备已保存</span>
            </div>
            <p className="mt-3 text-xs font-bold text-[#60656d]">换设备或浏览器时使用</p>
            <code className="mt-4 block min-h-11 break-all border border-black/10 bg-[#f2eee6] p-3 text-xs font-bold text-[#34383f]">{showCode ? participant.token : "••••••••••••••••••••••••"}</code>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => setShowCode((value) => !value)} className="border border-black/15 px-3 py-2.5 text-xs font-black text-[#34383f]">{showCode ? "隐藏" : "显示"}</button>
              <button onClick={() => navigator.clipboard.writeText(participant.token).then(() => setMessage("管理码已复制。"))} className="bg-[#ff4655] px-3 py-2.5 text-xs font-black text-white">复制</button>
            </div>
          </section>
        </aside>
      </div>
    </Container>
  );
}
