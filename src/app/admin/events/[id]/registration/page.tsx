"use client";

import { use, useState, useSyncExternalStore } from "react";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useCurrentEventConfig } from "@/hooks/useCurrentEventConfig";
import { useRegistration } from "@/lib/scheduling/useRegistration";
import type { RegistrationPlayer } from "@/lib/scheduling/registration-data";
import { QRCodeSVG } from "qrcode.react";

interface RegistrationPageProps {
  params: Promise<{ id: string }>;
}

const inputClass =
  "w-full border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff4655] focus:border-transparent";

function contactOf(p: RegistrationPlayer): string {
  return p.qq || p.wechat || p.phone || "未填";
}

const subscribeStatic = () => () => {};

export default function RegistrationPage({ params }: RegistrationPageProps) {
  const { id } = use(params);
  const origin = useSyncExternalStore(subscribeStatic, () => window.location.origin, () => "");
  const registerUrl = origin ? `${origin}/events/${id}/register` : "";
  const event = useCurrentEventConfig(id);
  const {
    state,
    createTeam,
    assignPlayer,
    removePlayerFromTeam,
    approveTeam,
    removeTeam,
    togglePlayerRegistration,
    toggleTeamRegistration,
    reset,
  } = useRegistration(id);

  const pool = state.players.filter((p) => p.status === "已报名");
  const [tab, setTab] = useState<"players" | "teams">("players");
  const [showCreate, setShowCreate] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [captainId, setCaptainId] = useState("");
  const [assigning, setAssigning] = useState<RegistrationPlayer | null>(null);
  const [assignTeam, setAssignTeam] = useState("");
  const [assignRole, setAssignRole] = useState<"首发" | "替补" | "教练">("首发");

  function handleCreateTeam() {
    if (state.teamRegistrationClosed || !teamName.trim() || !captainId) return;
    const teamId = createTeam(teamName.trim(), captainId);
    assignPlayer(captainId, teamId, "首发");
    setTeamName("");
    setCaptainId("");
    setShowCreate(false);
  }

  function handleAssign() {
    if (state.teamRegistrationClosed || !assigning || !assignTeam) return;
    assignPlayer(assigning.id, assignTeam, assignRole);
    setAssigning(null);
    setAssignTeam("");
    setAssignRole("首发");
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow="MODULE 02 / REGISTER"
        title="报名与队伍"
        description="选手报名、队伍申报与名单审核。"
        status={
          state.playerRegistrationClosed && state.teamRegistrationClosed
            ? "报名与申报均已截止"
            : state.playerRegistrationClosed
              ? "选手报名已截止 · 队伍申报中"
              : state.teamRegistrationClosed
                ? "队伍申报已截止"
                : `${pool.length} 人待组队`
        }
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={() => setShowCreate(true)}
              disabled={state.teamRegistrationClosed}
              className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-500 hover:border-slate-950 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
            >
              代建队伍
            </button>
            <button onClick={togglePlayerRegistration} className="border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:border-slate-950">
              {state.playerRegistrationClosed ? "重新开放选手报名" : "截止选手报名"}
            </button>
            <button onClick={toggleTeamRegistration} className={`px-4 py-2.5 text-xs font-bold ${state.teamRegistrationClosed ? "border border-slate-300 bg-white text-slate-700 hover:border-slate-950" : "bg-[#ff4655] text-white hover:bg-[#d83b48]"}`}>
              {state.teamRegistrationClosed ? "重新开放队伍申报" : "截止队伍申报"}
            </button>
          </div>
        }
      />

      {/* 报名入口 */}
      <section className="mb-5 border border-slate-200 bg-white">
        <div className="flex items-center gap-6 p-5">
          {registerUrl ? (
            <div className="shrink-0 border border-slate-200 bg-white p-2">
              <QRCodeSVG value={registerUrl} size={112} />
            </div>
          ) : (
            <div className="h-[128px] w-[128px] shrink-0 border border-slate-200 bg-slate-50" />
          )}
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-700">报名二维码</p>
            <p className="mt-1 break-all text-xs text-slate-500">{registerUrl || "加载中…"}</p>
            <p className="mt-2 text-[0.625rem] text-slate-400">
              选手报名截止 {event.registrationEnd || "待定"} · 队伍申报截止 {event.teamRegistrationEnd || "待定"}
            </p>
          </div>
        </div>
      </section>

      {/* 单列 + 切换 */}
      <section className="border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200">
          <div className="flex">
            <button
              type="button"
              onClick={() => setTab("players")}
              className={`border-r border-slate-200 px-5 py-3.5 text-sm font-bold transition ${tab === "players" ? "border-b-2 border-b-[#ff4655] bg-[#fff1f2] text-slate-950" : "text-slate-500 hover:text-slate-950"}`}
            >
              选手 <span className="ml-1 font-mono text-[0.625rem] text-slate-400">{pool.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("teams")}
              className={`px-5 py-3.5 text-sm font-bold transition ${tab === "teams" ? "border-b-2 border-b-[#ff4655] bg-[#fff1f2] text-slate-950" : "text-slate-500 hover:text-slate-950"}`}
            >
              队伍 <span className="ml-1 font-mono text-[0.625rem] text-slate-400">{state.teams.length}</span>
            </button>
          </div>
          <button onClick={reset} className="px-5 py-3.5 text-xs font-bold text-slate-400 hover:text-slate-700">重置</button>
        </div>

        {/* 选手列表 */}
        {tab === "players" && (
          pool.length === 0 ? (
            <p className="px-5 py-16 text-center text-xs text-slate-400">暂无待组队选手</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left">
                <thead className="bg-slate-50 text-[0.625rem] text-slate-400">
                  <tr>
                    <th className="px-4 py-3">游戏 ID</th>
                    <th className="px-4 py-3">段位</th>
                    <th className="px-4 py-3">联系方式</th>
                    <th className="px-4 py-3">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pool.map((p) => (
                    <tr key={p.id} className="text-xs">
                      <td className="px-4 py-3 font-bold text-slate-900">{p.gameId}</td>
                      <td className="px-4 py-3 text-slate-600">{p.rank}</td>
                      <td className="px-4 py-3 text-slate-500">{contactOf(p)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => { setAssigning(p); setAssignTeam(""); setAssignRole("首发"); }}
                          disabled={state.teamRegistrationClosed}
                          className="font-bold text-[#c83242] disabled:cursor-not-allowed disabled:text-slate-300"
                        >
                          组队
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* 队伍列表 */}
        {tab === "teams" && (
          state.teams.length === 0 ? (
            <p className="px-5 py-16 text-center text-xs text-slate-400">队长在玩家侧创建队伍后，会出现在这里待审核。</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {state.teams.map((team) => {
                const members = state.players.filter((p) => p.teamId === team.id);
                const starters = members.filter((m) => m.role === "首发");
                const subs = members.filter((m) => m.role === "替补");
                const coaches = members.filter((m) => m.role === "教练");
                return (
                  <div key={team.id} className="px-5 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-black text-slate-900">{team.name}</p>
                        <p className="mt-1 text-[0.625rem] text-slate-400">
                          首发 {starters.length}/5 · 替补 {subs.length} · 教练 {coaches.length}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {team.status === "报名中" ? (
                          <>
                            <button onClick={() => approveTeam(team.id)} className="bg-[#ff4655] px-3 py-2 text-xs font-bold text-white">审核通过</button>
                            <button onClick={() => removeTeam(team.id)} className="border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600">删除</button>
                          </>
                        ) : (
                          <span className="border border-emerald-200 bg-emerald-50 px-2 py-1 text-[0.5625rem] font-bold text-emerald-700">已通过</span>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {members.map((m) => (
                        <span key={m.id} className="inline-flex items-center gap-1 border border-slate-200 bg-slate-50 px-2 py-1 text-[0.625rem]">
                          {m.gameId}
                          <span className="text-slate-400">·{m.role ?? "成员"}</span>
                          {team.status === "报名中" && !state.teamRegistrationClosed && (
                            <button onClick={() => removePlayerFromTeam(m.id)} className="ml-1 text-slate-400 hover:text-red-600">×</button>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-black">代建队伍</h2>
              <button onClick={() => setShowCreate(false)} className="text-slate-400">关闭</button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">队伍名称</label>
                <input type="text" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="如：星辰电竞" className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">队长（从选手池选）</label>
                <select value={captainId} onChange={(e) => setCaptainId(e.target.value)} className={inputClass}>
                  <option value="">请选择队长</option>
                  {pool.map((p) => <option key={p.id} value={p.id}>{p.gameId}（{p.rank}）</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button onClick={() => setShowCreate(false)} className="border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-600">取消</button>
              <button onClick={handleCreateTeam} className="bg-[#ff4655] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#d83b48]">创建</button>
            </div>
          </div>
        </div>
      )}

      {assigning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-black">组队 · {assigning.gameId}</h2>
              <button onClick={() => setAssigning(null)} className="text-slate-400">关闭</button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">加入队伍</label>
                <select value={assignTeam} onChange={(e) => setAssignTeam(e.target.value)} className={inputClass}>
                  <option value="">请选择队伍</option>
                  {state.teams.filter((t) => t.status === "报名中").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">队内角色</label>
                <select value={assignRole} onChange={(e) => setAssignRole(e.target.value as "首发" | "替补" | "教练")} className={inputClass}>
                  <option value="首发">首发</option>
                  <option value="替补">替补</option>
                  <option value="教练">教练</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button onClick={() => setAssigning(null)} className="border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-600">取消</button>
              <button onClick={handleAssign} className="bg-[#ff4655] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#d83b48]">确认</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
