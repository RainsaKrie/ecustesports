"use client";

import { use, useState } from "react";
import Button from "@/components/ui/Button";
import Link from "next/link";
import Container from "@/components/layout/Container";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import { useParticipant } from "@/hooks/useParticipant";
import { getGameConfig } from "@/lib/games";

/** 段位阶梯、擅长位置与队伍人数上限取自游戏配置层（原先本文件里各写了一遍）。 */
const GAME = getGameConfig();
const inputClass = "h-[44px] w-full border border-[var(--pub-line-soft)] bg-white/[0.04] px-3 text-sm font-semibold text-[var(--pub-txt)] outline-none focus:border-[var(--pub-red)] focus:ring-2 focus:ring-[var(--pub-red)]";
type Section = "team" | "matches" | "profile";
type RosterRole = "首发" | "替补" | "教练";
const APPLICATION_ROLES: Array<{ role: RosterRole; limit: number }> = [
  { role: "首发", limit: GAME.roster.starters },
  { role: "替补", limit: GAME.roster.maxSubstitutes },
  { role: "教练", limit: GAME.roster.maxCoaches },
];

function formatMatchTime(value: string): string {
  if (!value) return "时间待定";
  return value.slice(0, 16).replace("T", " ");
}

function sectionHref(eventId: string, section: Section): string {
  return `/events/${eventId}/manage?section=${section}`;
}

export default function ParticipantManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string; recover?: string; mode?: string }>;
}) {
  const { id } = use(params);
  const query = use(searchParams);
  const event = useCurrentEventConfig(id);
  const participant = useParticipant(id);
  const [code, setCode] = useState("");
  const [studentId, setStudentId] = useState("");
  const [recoveryPhone, setRecoveryPhone] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [createRole, setCreateRole] = useState<RosterRole>("首发");
  const [myRole, setMyRole] = useState<RosterRole>("首发");
  const [editingTeamName, setEditingTeamName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [inviteGameId, setInviteGameId] = useState("");
  const [inviteRole, setInviteRole] = useState<RosterRole>("首发");
  const [confirmTeamAction, setConfirmTeamAction] = useState<"leave" | "dissolve" | null>(null);
  const [proposedTime, setProposedTime] = useState("");
  const [proposedReason, setProposedReason] = useState("");
  const [profileDraft, setProfileDraft] = useState<Partial<{
    gameId: string;
    rank: string;
    qq: string;
    phone: string;
    positions: string[];
    intro: string;
  }>>({});

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

  async function recover() {
    await run(async () => {
      const response = await fetch("/api/public/participant/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: id, studentId, phone: recoveryPhone }),
      });
      const result = await response.json() as { manageToken?: string; message?: string };
      if (!response.ok || !result.manageToken) throw new Error(result.message ?? "找回失败，请稍后重试。");
      await participant.connect(result.manageToken);
    }, "参赛信息已找回。");
  }

  function disconnect() {
    participant.disconnect();
    setMessage("");
    setCode("");
    setProfileDraft({});
  }

  if (participant.loading) {
    return <Container className="py-12"><div className="border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-8 text-center text-sm font-bold text-[var(--pub-txt-soft)]">正在读取参赛信息…</div></Container>;
  }

  if (!participant.data) {
    return (
      <Container className="py-6 sm:py-12">
        <div className="mx-auto max-w-[560px] border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-5 sm:p-8">
          <h1 className="text-[24px] font-black text-[var(--pub-txt)]">找回参赛信息</h1>
          <p className="mt-2 text-sm font-bold text-[var(--pub-txt-soft)]">{event.name}</p>
          <div className="mt-6 grid gap-3">
            <input value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="报名学号" autoComplete="username" className={inputClass} />
            <input type="tel" inputMode="tel" value={recoveryPhone} onChange={(e) => setRecoveryPhone(e.target.value)} placeholder="报名手机号" autoComplete="tel" className={inputClass} />
            <Button variant="primary" size="md" onClick={recover} disabled={!studentId.trim() || !recoveryPhone.trim() || busy} className="w-full">
              {busy ? "正在验证…" : "找回并进入"}
            </Button>
          </div>

          {(participant.error || message) && <p className={`mt-4 text-sm ${participant.error ? "text-[var(--pub-red)]" : "text-[var(--pub-txt)]"}`}>{participant.error || message}</p>}

          <details className="mt-6 border-t border-[var(--pub-line-soft)] pt-5" open={query.recover !== "1" && Boolean(participant.error)}>
            <summary className="cursor-pointer text-sm font-bold text-[var(--pub-txt-soft)]">使用备用参赛码</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="粘贴参赛码" className={`${inputClass} font-mono`} />
              <button type="button" onClick={() => run(() => participant.connect(code), "已进入参赛管理。") } disabled={!code.trim() || busy} className="h-[44px] border border-[var(--pub-red)] bg-[var(--pub-card)] px-5 text-sm font-black text-[var(--pub-txt)] disabled:opacity-50">验证参赛码</button>
            </div>
          </details>

          <div className="mt-6 flex items-center justify-between border-t border-[var(--pub-line-soft)] pt-5 text-xs">
            <span className="font-bold text-[var(--pub-txt-soft)]">还没有报名</span>
            <Link href={`/events/${id}/register`} className="font-bold text-[var(--pub-red)]">前往报名</Link>
          </div>
        </div>
      </Container>
    );
  }

  const { data } = participant;
  const requestedSection = ["team", "matches", "profile"].includes(query.section ?? "")
    ? query.section as Section
    : data.team ? "matches" : "team";
  const profile = {
    gameId: profileDraft.gameId ?? data.player.gameId,
    rank: profileDraft.rank ?? data.player.rank,
    qq: profileDraft.qq ?? data.player.qq ?? "",
    phone: profileDraft.phone ?? data.player.phone ?? "",
    positions: profileDraft.positions ?? data.player.positions ?? [],
    intro: profileDraft.intro ?? data.player.intro ?? "",
  };
  const teamKeyword = teamSearch.trim().toLowerCase();
  const filteredTeams = teamKeyword
    ? data.teams.filter((team) => team.name.toLowerCase().includes(teamKeyword))
    : data.teams;
  const pendingRequests = data.requests.filter((item) => item.status === "pending");
  const appliedTeamIds = new Set(
    data.requests
      .filter((item) => item.status === "pending" && item.type === "application" && item.playerId === data.player.id)
      .map((item) => item.teamId),
  );

  return (
    <Container className="py-5 sm:py-10">
      <div className="mb-4 flex items-end justify-between gap-3 border-b-2 border-[var(--pub-red)] pb-4 sm:mb-6 sm:pb-5">
        <div className="min-w-0">
          <h1 className="truncate text-[24px] font-black text-[var(--pub-txt)] sm:text-[30px]">{data.player.gameId}</h1>
          <p className="mt-1 truncate text-xs font-bold text-[var(--pub-txt-soft)] sm:text-sm">{event.name}</p>
        </div>
        <button onClick={disconnect} className="inline-flex min-h-[44px] shrink-0 items-center border border-[var(--pub-line)] px-3 text-xs font-black text-[var(--pub-txt-soft)]">切换身份</button>
      </div>

      {(participant.error || message) && (
        <div className={`mb-4 border p-3 text-sm ${participant.error ? "border-[var(--pub-line-soft)] border-l-2 border-l-[var(--pub-red)] bg-[var(--pub-card)] text-[var(--pub-red)]" : "border-[var(--pub-line-soft)] border-l-2 border-l-[var(--pub-line)] bg-[var(--pub-card)] text-[var(--pub-txt)]"}`}>{participant.error || message}</div>
      )}

      <nav className="sticky top-16 z-20 mb-5 grid grid-cols-3 border border-[var(--pub-line-soft)] bg-[var(--pub-card)] sm:static sm:mb-6" aria-label="参赛管理导航">
        {([
          ["team", data.team ? "我的队伍" : "组队"] as const,
          ["matches", "我的比赛"] as const,
          ["profile", "报名信息"] as const,
        ]).map(([section, label]) => (
          <Link key={section} href={sectionHref(id, section)} className={`inline-flex min-h-[44px] items-center justify-center border-r border-[var(--pub-line-soft)] px-2 text-center text-xs font-black last:border-r-0 sm:text-sm ${requestedSection === section ? "bg-[rgba(255,70,85,0.12)] text-[var(--pub-red)]" : "text-[var(--pub-txt-soft)] hover:bg-white/[0.06]"}`}>{label}</Link>
        ))}
      </nav>

      {requestedSection === "team" && (
        <div className="grid gap-5">
          <section className="border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[18px] font-black text-[var(--pub-txt)]">{data.team ? "我的队伍" : "创建或加入队伍"}</h2>
              {pendingRequests.length > 0 && <span className="border border-[var(--pub-red)] px-2 py-1 text-[11px] font-black text-[var(--pub-red)]">{pendingRequests.length} 条待处理</span>}
            </div>

            {data.team ? (
              <div className="mt-4">
                <div className="flex flex-col gap-2 bg-white/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="font-black text-[var(--pub-txt)]">{data.team.name}</p><p className="mt-1 text-xs text-[var(--pub-txt-soft)]">{data.isCaptain ? "队长" : "队员"} · {data.team.status} · 我的角色：{data.player.role ?? "未定"}</p></div>
                  <span className="text-xs font-bold text-[var(--pub-txt-soft)]">5 首发 · 1 替补 · 1 教练</span>
                </div>
                {data.team.status === "报名中" && (
                  <div className="mt-4 space-y-3 border-t border-[var(--pub-line-soft)] pt-4">
                    {roleOpen ? (
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                        <select value={myRole} onChange={(e) => setMyRole(e.target.value as RosterRole)} className={inputClass}><option>首发</option><option>替补</option><option>教练</option></select>
                        <Button type="button" onClick={() => setRoleOpen(false)} disabled={busy} variant="secondary" size="md">取消</Button>
                        <Button type="button" onClick={() => run(() => participant.setMyRole(myRole), "角色已更新。").then(() => setRoleOpen(false))} disabled={busy} variant="primary" size="md">确认改角色</Button>
                      </div>
                    ) : (
                      <Button type="button" onClick={() => { setMyRole(data.player.role ?? "首发"); setRoleOpen(true); setRenameOpen(false); }} variant="secondary" size="sm">调整我的角色</Button>
                    )}

                    {data.isCaptain && (renameOpen ? (
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                        <input value={editingTeamName} onChange={(e) => setEditingTeamName(e.target.value)} placeholder="新队名（≤40 字）" className={inputClass} />
                        <Button type="button" onClick={() => setRenameOpen(false)} disabled={busy} variant="secondary" size="md">取消</Button>
                        <Button type="button" onClick={() => run(() => participant.renameTeam(editingTeamName), "队名已更新。").then(() => setRenameOpen(false))} disabled={busy || !editingTeamName.trim()} variant="primary" size="md">确认改名</Button>
                      </div>
                    ) : (
                      <Button type="button" onClick={() => { setEditingTeamName(data.team!.name); setRenameOpen(true); setRoleOpen(false); }} variant="secondary" size="sm">修改队名</Button>
                    ))}

                    {confirmTeamAction ? (
                      <div className="border border-[var(--pub-line-soft)] border-l-2 border-l-[var(--pub-red)] bg-[var(--pub-card)] p-4">
                        <p className="text-sm font-bold text-[var(--pub-txt)]">{confirmTeamAction === "leave" ? "确定退出这支队伍吗？" : "确定解散这支队伍吗？"}</p>
                        <p className="mt-1 text-xs text-[var(--pub-txt)]">{confirmTeamAction === "leave" ? "你将回到未组队状态，之后可以重新申请其他队伍。" : "整支队伍会被删除，所有成员回到未组队状态，此操作不可撤销。"}</p>
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
                          <Button variant="secondary" size="md" onClick={() => setConfirmTeamAction(null)} disabled={busy}>取消</Button>
                          <Button variant="danger" size="md" onClick={() => run(() => (confirmTeamAction === "leave" ? participant.leaveTeam() : participant.dissolveTeam()), confirmTeamAction === "leave" ? "已退出队伍。" : "队伍已解散。").then(() => setConfirmTeamAction(null))} disabled={busy}>{confirmTeamAction === "leave" ? "确认退出" : "确认解散"}</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-bold text-[var(--pub-txt-soft)]">{data.isCaptain ? "组队期可随时解散重来" : "组队期可退出并重新加入其他队伍"}</p>
                        <button type="button" onClick={() => setConfirmTeamAction(data.isCaptain ? "dissolve" : "leave")} className="shrink-0 border border-[var(--pub-line-soft)] px-3 py-2 text-xs font-black text-[var(--pub-red)] hover:bg-white/[0.06]">{data.isCaptain ? "解散队伍" : "退出队伍"}</button>
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-3 grid gap-3">
                  {([["首发", 5], ["替补", 1], ["教练", 1]] as Array<[RosterRole, number]>).map(([rosterRole, limit]) => {
                    const roleMembers = data.team!.members.filter((member) => member.role === rosterRole);
                    return (
                      <div key={rosterRole} className="grid gap-2 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
                        <div className="text-xs font-black text-[var(--pub-txt-soft)] sm:pt-2">{rosterRole} {roleMembers.length}/{limit}</div>
                        <div className={`grid gap-2 ${rosterRole === "首发" ? "sm:grid-cols-2" : ""}`}>
                          {Array.from({ length: limit }, (_, index) => {
                            const member = roleMembers[index];
                            return <div key={member?.id ?? `${rosterRole}-${index}`} className={`min-h-[40px] border px-3 py-2 text-sm ${member ? "border-[var(--pub-line)] bg-[var(--pub-card)]" : "border-dashed border-[var(--pub-line)] bg-white/[0.06] text-[var(--pub-txt-mute)]"}`}><strong>{member?.gameId ?? `${rosterRole === "首发" ? `首发 ${index + 1}` : rosterRole} · 空缺`}</strong></div>;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {data.isCaptain && !data.teamRegistrationClosed && (
                  <div className="mt-5 border-t border-[var(--pub-line-soft)] pt-5">
                    <h3 className="text-sm font-black text-[var(--pub-txt)]">邀请队员</h3>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
                      <input value={inviteGameId} onChange={(e) => setInviteGameId(e.target.value)} placeholder="完整游戏 ID" className={inputClass} />
                      <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as RosterRole)} className={inputClass}><option>首发</option><option>替补</option><option>教练</option></select>
                      <Button onClick={() => run(() => participant.sendTeamRequest({ type: "invitation", teamId: data.team!.id, targetGameId: inviteGameId, role: inviteRole }), "邀请已发送。") } disabled={busy || !inviteGameId.trim()} variant="primary" size="md">发送邀请</Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4">
                {!data.teamRegistrationClosed && (
                  <div className="grid gap-2 border-b border-[var(--pub-line-soft)] pb-5 sm:grid-cols-[1fr_8rem_auto]">
                    <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="输入队伍名称" autoFocus={query.mode === "create"} className={inputClass} />
                    <select value={createRole} onChange={(e) => setCreateRole(e.target.value as RosterRole)} className={inputClass}><option>首发</option><option>替补</option><option>教练</option></select>
                    <Button variant="primary" size="md" onClick={() => run(() => participant.createTeam(teamName, createRole), "队伍已创建，你已成为队长。") } disabled={busy || !teamName.trim()}>创建队伍</Button>
                  </div>
                )}
                <div className="mt-5">
                  <input value={teamSearch} onChange={(e) => setTeamSearch(e.target.value)} placeholder="搜索队伍" className={inputClass} />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {filteredTeams.map((team) => {
                    const applied = appliedTeamIds.has(team.id);
                    return (
                      <div key={team.id} className="grid gap-3 border border-[var(--pub-line)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div className="min-w-0"><p className="truncate text-sm font-black text-[var(--pub-txt)]">{team.name}</p><p className="mt-1 text-xs text-[var(--pub-txt-soft)]">首发 {team.starterCount}/5 · 替补 {team.substituteCount}/1 · 教练 {team.coachCount}/1</p></div>
                        {data.teamRegistrationClosed ? (
                          <span className="border border-[var(--pub-line)] px-3 py-2 text-center text-xs font-black text-[var(--pub-txt-mute)]">组队已结束</span>
                        ) : applied ? (
                          <span className="whitespace-nowrap border border-[var(--pub-line)] bg-white/[0.06] px-3 py-2 text-center text-xs font-black text-[var(--pub-txt-soft)]">等待队长处理</span>
                        ) : (
                          <div className="grid grid-cols-3 gap-1.5">
                            {APPLICATION_ROLES.map(({ role, limit }) => {
                              const count = role === "首发" ? team.starterCount : role === "替补" ? team.substituteCount : team.coachCount;
                              const canApply = count < limit;
                              return (
                                <button
                                  key={role}
                                  type="button"
                                  onClick={() => run(() => participant.sendTeamRequest({ type: "application", teamId: team.id, role }), `已申请${role}。`) }
                                  disabled={busy || !canApply}
                                  className="h-[36px] whitespace-nowrap border border-[var(--pub-red)] px-1.5 text-[11px] font-black text-[var(--pub-red)] disabled:border-[var(--pub-line)] disabled:text-[var(--pub-txt-mute)]"
                                >
                                  {canApply ? `申请${role}` : `${role}已满`}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {filteredTeams.length === 0 && <p className="mt-4 text-center text-sm text-[var(--pub-txt-mute)]">没有匹配的队伍</p>}
              </div>
            )}
          </section>

          <section className="border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-4 sm:p-6">
            <h2 className="text-[18px] font-black text-[var(--pub-txt)]">组队请求</h2>
            {pendingRequests.length === 0 ? <p className="mt-3 text-sm text-[var(--pub-txt-mute)]">暂无组队请求</p> : (
              <div className="mt-3 grid gap-2">
                {pendingRequests.map((request) => {
                  const title = request.type === "application"
                    ? request.canResolve ? `${request.playerGameId} 申请加入 ${request.teamName}` : `申请加入 ${request.teamName}`
                    : request.canResolve ? `${request.teamName} 邀请你加入` : `已邀请 ${request.playerGameId}`;
                  return (
                    <div key={request.id} className="flex flex-col gap-3 border border-[var(--pub-line)] p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div><p className="text-sm font-bold text-[var(--pub-txt)]">{title}</p><p className="mt-1 text-xs text-[var(--pub-txt-soft)]">{request.canResolve ? "等待你处理" : "等待对方处理"} · {request.role}</p></div>
                      {request.canResolve && <div className="grid grid-cols-2 gap-2 sm:flex"><Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => participant.resolveTeamRequest(request.id, "reject"), "已拒绝请求。") }>拒绝</Button><Button variant="primary" size="sm" disabled={busy} onClick={() => run(() => participant.resolveTeamRequest(request.id, "accept"), "已确认入队。") }>同意</Button></div>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {requestedSection === "matches" && (
        <section className="border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-[18px] font-black text-[var(--pub-txt)]">我的比赛</h2>{data.nextMatch && <span className="border border-[var(--pub-line)] px-2 py-1 text-xs font-bold text-[var(--pub-txt-soft)]">{data.nextMatch.id} · {data.nextMatch.boType}</span>}</div>
          {!data.team ? (
            <div className="mt-4 border border-[var(--pub-line-soft)] border-l-2 border-l-[var(--pub-red)] bg-[var(--pub-card)] p-4"><p className="text-sm font-bold text-[var(--pub-txt)]">加入队伍后显示比赛</p><Link href={sectionHref(id, "team")} className="mt-3 inline-flex min-h-[44px] items-center text-sm font-black text-[var(--pub-red)]">前往组队</Link></div>
          ) : !data.nextMatch ? (
            <p className="mt-4 text-sm text-[var(--pub-txt-soft)]">暂无待安排比赛</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="grid gap-2 border border-[var(--pub-line)] bg-white/[0.06] p-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="text-base font-black text-[var(--pub-txt)]">{data.nextMatch.teamAName} vs {data.nextMatch.teamBName}</p><p className="mt-1 text-xs text-[var(--pub-txt-soft)]">{data.nextMatch.phase} · {formatMatchTime(data.nextMatch.startTime)}</p></div><span className="text-xs font-bold text-[var(--pub-txt-soft)]">赛程 v{data.scheduleVersion}</span></div>
              {data.scheduleRequests.map((request) => (
                <div key={request.id} className={`border p-4 ${["待对手确认", "待审批"].includes(request.status) ? "border-[var(--pub-line-soft)] border-l-2 border-l-[var(--pub-red)] bg-[var(--pub-card)]" : "border-[var(--pub-line)]"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-black text-[var(--pub-txt)]">{formatMatchTime(request.newStartTime)}</p><p className="mt-1 text-xs text-[var(--pub-txt-soft)]">{request.reason || "双方协商时间"}</p></div><span className="border border-current px-2 py-1 text-xs font-bold text-[var(--pub-red)]">{request.status}</span></div>
                  {request.conflicts.length > 0 && <ul className="mt-3 space-y-1 text-xs text-[var(--pub-red)]">{request.conflicts.map((conflict) => <li key={`${request.id}-${conflict.code}`}>[{conflict.code}] {conflict.message}</li>)}</ul>}
                  {request.canConfirm && <div className="mt-4 grid grid-cols-2 gap-2 sm:flex"><Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => participant.resolveScheduleRequest(request.id, "reject"), "已拒绝该时间。") }>拒绝</Button><Button variant="primary" size="sm" disabled={busy} onClick={() => run(() => participant.resolveScheduleRequest(request.id, "accept"), "已确认时间，等待负责人审批。") }>确认时间</Button></div>}
                </div>
              ))}
              {data.isCaptain && !data.scheduleRequests.some((request) => request.matchId === data.nextMatch!.id && ["待对手确认", "待审批"].includes(request.status)) && (
                <div className="border-t border-[var(--pub-line-soft)] pt-5">
                  <h3 className="text-sm font-black text-[var(--pub-txt)]">队长约赛与改期</h3>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input type="datetime-local" value={proposedTime} onChange={(e) => setProposedTime(e.target.value)} className={inputClass} /><input value={proposedReason} onChange={(e) => setProposedReason(e.target.value)} placeholder="备注" className={inputClass} /><Button variant="primary" size="md" disabled={busy || !proposedTime || !data.scheduleConfigConfirmed} onClick={() => run(() => participant.createScheduleRequest(data.nextMatch!.id, proposedTime, proposedReason), "约赛时间已提交。") }>提交时间</Button></div>
                  {!data.scheduleConfigConfirmed && <p className="mt-2 text-xs font-medium text-[var(--pub-txt)]">负责人尚未开放约赛时间</p>}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {requestedSection === "profile" && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-4 sm:p-6">
            <div className="flex items-center justify-between"><h2 className="text-[18px] font-black text-[var(--pub-txt)]">报名信息</h2><span className="border-l-2 border-l-[var(--pub-line)] bg-[var(--pub-card)] px-2 py-1 text-xs font-bold text-[var(--pub-txt)]">{data.player.status}</span></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-[var(--pub-txt-soft)]">游戏 ID<input value={profile.gameId} onChange={(e) => setProfileDraft({ ...profileDraft, gameId: e.target.value })} className={inputClass} /></label>
              <label className="text-xs font-bold text-[var(--pub-txt-soft)]">当前段位<select value={profile.rank} onChange={(e) => setProfileDraft({ ...profileDraft, rank: e.target.value })} className={inputClass}>{GAME.ranks.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="text-xs font-bold text-[var(--pub-txt-soft)]">QQ<input value={profile.qq} onChange={(e) => setProfileDraft({ ...profileDraft, qq: e.target.value })} className={inputClass} /></label>
              <label className="text-xs font-bold text-[var(--pub-txt-soft)]">手机号<input value={profile.phone} onChange={(e) => setProfileDraft({ ...profileDraft, phone: e.target.value })} className={inputClass} /></label>
            </div>
            <div className="mt-4"><p className="text-xs font-bold text-[var(--pub-txt-soft)]">擅长位置</p><div className="mt-2 flex flex-wrap gap-2">{GAME.positions.map((pos) => { const active = profile.positions.includes(pos); return <button key={pos} type="button" onClick={() => setProfileDraft({ ...profileDraft, positions: active ? profile.positions.filter((item) => item !== pos) : [...profile.positions, pos] })} className={`inline-flex min-h-[44px] items-center border px-3 text-xs ${active ? "border-[var(--pub-red)] bg-[rgba(255,70,85,0.12)] text-[var(--pub-red)]" : "border-[var(--pub-line)] bg-[var(--pub-card)] text-[var(--pub-txt-soft)]"}`}>{pos}</button>; })}</div></div>
            <label className="mt-4 block text-xs font-bold text-[var(--pub-txt-soft)]">自我介绍<textarea value={profile.intro} onChange={(e) => setProfileDraft({ ...profileDraft, intro: e.target.value })} rows={3} className="mt-1 w-full border border-[var(--pub-line)] bg-[var(--pub-card)] px-3 py-2 text-sm font-semibold outline-none focus:border-[var(--pub-red)]" /></label>
            <Button variant="primary" size="md" onClick={() => run(() => participant.saveProfile(profile), "报名信息已更新。") } disabled={busy} className="mt-5 w-full sm:w-auto">保存修改</Button>
          </section>
          <section className="border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-4 sm:p-5">
            <h2 className="text-[18px] font-black text-[var(--pub-txt)]">备用参赛码</h2>
            <code className="mt-4 block min-h-[44px] break-all border border-[var(--pub-line-soft)] bg-white/[0.06] p-3 text-xs font-bold text-[var(--pub-txt-soft)]">{showCode ? participant.token : "••••••••••••••••••••••••"}</code>
            <div className="mt-3 grid grid-cols-2 gap-2"><Button variant="secondary" size="md" onClick={() => setShowCode((value) => !value)}>{showCode ? "隐藏" : "显示"}</Button><Button variant="primary" size="md" onClick={() => navigator.clipboard.writeText(participant.token).then(() => setMessage("参赛码已复制。"))}>复制</Button></div>
          </section>
        </div>
      )}
    </Container>
  );
}