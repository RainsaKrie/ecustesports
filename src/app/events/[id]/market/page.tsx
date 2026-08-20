"use client";

import { use, useState } from "react";
import Container from "@/components/layout/Container";
import Button from "@/components/ui/Button";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import { useRegistration } from "@/lib/scheduling/useRegistration";

interface MarketPageProps {
  params: Promise<{ id: string }>;
}

function contactOf(p: { qq?: string; wechat?: string; phone?: string }): string {
  return p.qq || p.wechat || p.phone || "未留联系方式";
}

function teamMembers(memberIds: string[], players: ReturnType<typeof useRegistration>["state"]["players"]) {
  return memberIds.map((id) => players.find((p) => p.id === id)).filter((p) => p !== undefined);
}

export default function MarketPage({ params }: MarketPageProps) {
  const { id } = use(params);
  const event = useCurrentEventConfig(id);
  const { state, currentPlayerId, createTeamAsPlayer, joinTeamPublic } = useRegistration(id);

  const me = state.players.find((p) => p.id === currentPlayerId);
  const myTeam = me ? state.teams.find((t) => t.memberIds.includes(me.id)) : undefined;
  const isCaptain = myTeam ? myTeam.captainId === me?.id : false;
  const pool = state.players.filter((p) => p.status === "已报名");

  const [showCreate, setShowCreate] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [addTarget, setAddTarget] = useState<"首发" | "替补" | "教练" | null>(null);
  const [addPlayerId, setAddPlayerId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (state.teamRegistrationClosed || !teamName.trim()) return;
    setBusy(true);
    setError("");
    try {
      await createTeamAsPlayer(teamName.trim());
      setTeamName("");
      setShowCreate(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "建队失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    if (state.teamRegistrationClosed || !myTeam || !addPlayerId || !addTarget) return;
    setBusy(true);
    setError("");
    try {
      await joinTeamPublic(addPlayerId, myTeam.id, addTarget);
      setAddTarget(null);
      setAddPlayerId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "入队失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container className="py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">人才市场</h1>
            <p className="mt-1 text-sm text-gray-500">{event.name} · 寻找队友或队伍</p>
          </div>
          {!myTeam && me && !state.teamRegistrationClosed && (
            <Button onClick={() => setShowCreate(true)}>＋ 创建队伍</Button>
          )}
          {!me && (
            <Button href={`/events/${event.id}/register`}>先去报名</Button>
          )}
        </div>

        {error && (
          <div className="mb-6 border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>
        )}

        {state.teamRegistrationClosed && (
          <div className="mb-6 border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
            队伍申报已截止，当前名单仅供查看。如需更正，请联系赛事负责人。
          </div>
        )}

        {/* 我的队伍 / 创建提示 */}
        {me && myTeam && (
          <div className="mb-6 border border-[#ff4655]/25 bg-[#fff1f2] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">我的队伍：{myTeam.name}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {isCaptain ? "你是队长，可以从下方选手池添加成员" : "你已加入队伍，等待队长确认名单"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">
                  首发 {teamMembers(myTeam.memberIds, state.players).filter((p) => p!.role === "首发").length}/5
                  · 替补 {teamMembers(myTeam.memberIds, state.players).filter((p) => p!.role === "替补").length}
                  · 教练 {teamMembers(myTeam.memberIds, state.players).filter((p) => p!.role === "教练").length}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {teamMembers(myTeam.memberIds, state.players).map((p) => (
                <span key={p!.id} className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2 py-1 text-xs">
                  {p!.gameId}
                  <span className="text-slate-400">·{p!.role ?? "成员"}</span>
                </span>
              ))}
            </div>
            {isCaptain && !state.teamRegistrationClosed && (
              <div className="mt-3 flex gap-2">
                {(["首发", "替补", "教练"] as const).map((role) => (
                  <button key={role} onClick={() => { setAddTarget(role); setAddPlayerId(""); }} className="border border-[#c83242] px-3 py-1.5 text-xs font-bold text-[#c83242] hover:bg-[#c83242] hover:text-white">
                    ＋ 加{role}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {me && !myTeam && (
          <div className="mb-6 border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            {state.teamRegistrationClosed
              ? "队伍申报已截止，你目前未加入队伍。如有遗漏，请联系赛事负责人。"
              : "你还没有加入队伍。可以「创建队伍」当队长，或在下方队伍列表里联系队长加入。"}
          </div>
        )}

        {/* 队伍列表 */}
        <h2 className="mb-3 text-sm font-bold text-gray-900">队伍列表</h2>
        {state.teams.length === 0 ? (
          <div className="border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
            {state.teamRegistrationClosed ? "队伍申报已截止，暂无已申报队伍" : "暂无队伍，快来创建第一支队伍吧"}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {state.teams.map((team) => {
              const members = teamMembers(team.memberIds, state.players);
              const captain = state.players.find((p) => p.id === team.captainId);
              const starters = members.filter((p) => p!.role === "首发").length;
              const full = starters >= 5;
              return (
                <div key={team.id} className="border border-gray-200 bg-white p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-base font-bold text-gray-900">{team.name}</p>
                    <span className={`px-2 py-1 text-[0.625rem] font-bold ${full ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>
                      {full ? "首发已满" : `缺 ${5 - starters} 名首发`}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {members.map((p) => (
                      <span key={p!.id} className="inline-flex items-center gap-1 bg-slate-50 px-2 py-1 text-xs text-slate-700">
                        {p!.gameId}
                        <span className="text-slate-400">·{p!.role ?? "成员"}</span>
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                    队长：{captain?.gameId ?? "未知"} · 联系：{captain ? contactOf(captain) : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 选手列表 */}
        <h2 className="mb-3 mt-8 text-sm font-bold text-gray-900">已报名选手</h2>
        <div className="overflow-hidden border border-gray-200 bg-white">
          {pool.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">暂无已报名选手</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3">游戏 ID</th>
                  <th className="px-4 py-3">段位</th>
                  <th className="px-4 py-3">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pool.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{p.gameId}</td>
                    <td className="px-4 py-3 text-gray-600">{p.rank}</td>
                    <td className="px-4 py-3 text-gray-500">{p.status === "已报名" ? "待组队" : "已入队"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 创建队伍弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-bold text-gray-900">创建队伍</h3>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="输入队伍名称"
              className="mt-3 w-full border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff4655]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowCreate(false)} disabled={busy}>取消</Button>
              <Button onClick={handleCreate} disabled={busy}>{busy ? "创建中…" : "创建"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* 加人弹窗 */}
      {addTarget && myTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-bold text-gray-900">添加{addTarget} · {myTeam.name}</h3>
            <select value={addPlayerId} onChange={(e) => setAddPlayerId(e.target.value)} className="mt-3 w-full border border-gray-300 px-3 py-2.5 text-sm">
              <option value="">从选手池选择</option>
              {pool.map((p) => (
                <option key={p.id} value={p.id}>{p.gameId}（{p.rank}）</option>
              ))}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAddTarget(null)} disabled={busy}>取消</Button>
              <Button onClick={handleAdd} disabled={busy}>{busy ? "添加中…" : "确认添加"}</Button>
            </div>
          </div>
        </div>
      )}
    </Container>
  );
}
