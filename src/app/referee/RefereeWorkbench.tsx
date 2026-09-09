"use client";

// =====================
// RPT-05 手机端裁判工作台
// 流程：登录 → 我的比赛 → 逐局报分（自动算大比分）→ 凭证上传 → 汇总确认（回显系统判定胜者）→ 提交结果
// 数据：走真实 /api/referee/*（本地 file 后端即可跑，接 Supabase 只改 DATA_BACKEND）。
// 凭证只存内存，刷新即清；本地草稿不伪装成已提交。
// =====================

import { useMemo, useRef, useState } from "react";
import { VALORANT_MAPS } from "@/lib/maps";

type MatchSummary = {
  matchId: string;
  teamAName: string;
  teamBName: string;
  boType: string;
  status: string;
};

type Stage = "login" | "matches" | "report" | "confirm" | "done";

type GameDraft = { map: string; teamAScore: number; teamBScore: number };
type ConfirmPayload = {
  matchId: string;
  games: Array<{ map?: string; teamAScore: number; teamBScore: number }>;
  declaredWinnerTeamName: string;
  declaredWinnerSide: "A" | "B";
};

export default function RefereeWorkbench({ initialEventId }: { initialEventId: string }) {
  const [stage, setStage] = useState<Stage>("login");
  const [credential, setCredential] = useState("");
  const [eventId, setEventId] = useState(initialEventId);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [activeMatch, setActiveMatch] = useState<MatchSummary | null>(null);
  const [games, setGames] = useState<GameDraft[]>([]);
  const [evidenceNames, setEvidenceNames] = useState<string[]>([]);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState<ConfirmPayload | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");
  const [lastScheduleVersion, setLastScheduleVersion] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const boType = activeMatch?.boType ?? "BO3";
  const winTarget = useMemo(() => ({ BO1: 1, BO3: 2, BO5: 3 }[boType] ?? 2), [boType]);
  const maxGames = winTarget * 2 - 1;

  function winsOf(games: GameDraft[], side: "A" | "B"): number {
    return games.filter((g) => (side === "A" ? g.teamAScore > g.teamBScore : g.teamBScore > g.teamAScore)).length;
  }

  async function doLogin(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError("");
    setBanner("");
    if (credential.trim().length < 3) { setError("请输入裁判凭证"); return; }
    if (!eventId.trim()) { setError("请输入赛事 ID，或使用管理员发给你的裁判链接"); return; }
    try {
      const res = await fetch("/api/referee/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: credential.trim(), eventId }),
      });
      if (!res.ok) { setError("凭证无效，请核对后重试"); return; }
      setStage("matches");
      await loadMatches(credential.trim());
    } catch {
      setError("网络连接失败，请检查后重试");
    }
  }

  async function loadMatches(cred: string) {
    setError("");
    try {
      const res = await fetch(`/api/referee/matches?eventId=${encodeURIComponent(eventId)}`, {
        headers: { "x-referee-credential": cred },
      });
      if (!res.ok) { setError("加载我的比赛失败"); return; }
      const data = (await res.json()) as { matches: MatchSummary[]; scheduleVersion?: number };
      setMatches(data.matches);
      if (typeof data.scheduleVersion === "number") setLastScheduleVersion(data.scheduleVersion);
    } catch {
      setError("网络连接失败");
    }
  }

  function openMatch(match: MatchSummary) {
    setActiveMatch(match);
    setGames([]);
    setEvidenceNames([]);
    setEvidenceIds([]);
    setStage("report");
    setError("");
  }

  function addGame() {
    if (games.length >= maxGames) return;
    setGames([...games, { map: "", teamAScore: 0, teamBScore: 0 }]);
  }

  function updateGame(index: number, patch: Partial<GameDraft>) {
    setGames((prev) => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function removeGame(index: number) {
    setGames((prev) => prev.filter((_, i) => i !== index));
  }

  function currentMapOptions(index: number): string[] {
    const used = new Set(games.filter((_, gameIndex) => gameIndex !== index).map((g) => g.map).filter(Boolean));
    return VALORANT_MAPS.filter((m) => !used.has(m.name)).map((m) => m.name);
  }

  function autoWinner(): { side: "A" | "B"; name: string } | null {
    if (!activeMatch) return null;
    if (games.length === 0) return null;
    const a = winsOf(games, "A");
    const b = winsOf(games, "B");
    if (a === 0 && b === 0) return null;
    // 未达胜负分时不给最终胜者，只显示进程
    if (a < winTarget && b < winTarget) return null;
    return a > b
      ? { side: "A", name: activeMatch.teamAName }
      : { side: "B", name: activeMatch.teamBName };
  }

  function validatedGames(): Array<{ map?: string; teamAScore: number; teamBScore: number }> | null {
    if (games.length === 0) { setError("请至少录入一局比分"); return null; }
    // 每局须无平局且分数非负
    for (const g of games) {
      if (!Number.isSafeInteger(g.teamAScore) || !Number.isSafeInteger(g.teamBScore)) { setError("比分必须是整数"); return null; }
      if (g.teamAScore === g.teamBScore) { setError("每局比分不能平局"); return null; }
      if (g.teamAScore < 0 || g.teamBScore < 0) { setError("比分不能为负"); return null; }
    }
    const winner = autoWinner();
    if (!winner) { setError(`该赛制需一方先达到 ${winTarget} 胜局`); return null; }
    return games.map((g) => ({ map: g.map || undefined, teamAScore: g.teamAScore, teamBScore: g.teamBScore }));
  }

  function toConfirm() {
    const final = validatedGames();
    if (!final || !activeMatch) return;
    const winner = autoWinner()!;
    setConfirmPayload({
      matchId: activeMatch.matchId,
      games: final,
      declaredWinnerTeamName: winner.name,
      declaredWinnerSide: winner.side,
    });
    setStage("confirm");
    setError("");
  }

  function onPickEvidence() {
    fileInputRef.current?.click();
  }

  function onEvidenceChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 5);
    if (files.length === 0) return;
    setUploading(true);
    setError("");
    setBanner("");
    uploadFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function uploadFiles(files: File[]) {
    const names: string[] = [];
    const ids: string[] = [];
    let failed = 0;
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      form.append("eventId", eventId);
      form.append("matchId", activeMatch?.matchId ?? "");
      form.append("credential", credential.trim());
      try {
        const res = await fetch("/api/referee/upload", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as { evidenceId?: string; message?: string };
        if (!res.ok || !data.evidenceId) {
          failed++;
          names.push(`${file.name}（失败：${data.message ?? "上传失败"}）`);
          continue;
        }
        names.push(file.name);
        ids.push(data.evidenceId);
      } catch {
        failed++;
        names.push(`${file.name}（网络失败）`);
      }
    }
    setEvidenceNames((prev) => [...prev, ...names].slice(0, 5));
    setEvidenceIds((prev) => [...prev, ...ids].slice(0, 5));
    setUploading(false);
    setBanner(failed > 0 ? `${failed} 张上传失败，已上传 ${ids.length} 张` : `已上传 ${ids.length} 张凭证`);
  }

  async function doSubmit() {
    if (!confirmPayload) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/referee/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: credential.trim(),
          eventId,
          matchId: confirmPayload.matchId,
          basedOnScheduleVersion: lastScheduleVersion,
          games: confirmPayload.games,
          evidenceIds,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; status?: string };
      if (!res.ok) {
        if (res.status === 409) setError("赛程版本已更新，请刷新后重试");
        else setError(data.message ?? "提交失败");
        setSubmitting(false);
        return;
      }
      setStage("done");
      setSubmitting(false);
    } catch {
      setError("网络连接失败，本地已保留草稿，可稍后重试");
      setSubmitting(false);
    }
  }

  // ===== 渲染 =====
  if (stage === "login") {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center px-5 py-10">
        <div className="mb-8">
          <p className="mono-label text-[#d83b48]">REFEREE GATE</p>
          <h1 className="display-type mt-2 text-[2.4rem] font-extrabold leading-none tracking-[-0.05em] text-[#0f1923]">
            裁判工作台
          </h1>
          <p className="mt-3 text-base text-[#667078]">输入管理员发给你的裁判凭证，进入被分配的比赛。</p>
        </div>
        <form onSubmit={doLogin} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="mono-label text-[#0f1923]">裁判凭证</span>
            <input
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder="粘贴凭证"
              autoComplete="off"
              className="h-12 border border-[#0f1923]/25 bg-white px-4 text-base text-[#0f1923] outline-none focus:border-[#ff4655]"
              style={{ borderRadius: 0 }}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="mono-label text-[#0f1923]">赛事 ID</span>
            <input
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              placeholder="例如 event-1"
              autoComplete="off"
              className="h-12 border border-[#0f1923]/25 bg-white px-4 text-base text-[#0f1923] outline-none focus:border-[#ff4655]"
              style={{ borderRadius: 0 }}
            />
          </label>
          {error && <p className="text-sm text-[#ff4655]">{error}</p>}
          <button
            type="submit"
            className="btn-cut mt-2 h-13 w-full bg-[#ff4655] text-base font-bold text-white hover:bg-[#d83b48]"
          >
            进入工作台
          </button>
        </form>
        <p className="mt-6 text-xs leading-relaxed text-[#667078]">凭证只保存在当前页面内存中，刷新或关闭页面后需要重新输入。</p>
      </div>
    );
  }

  if (stage === "matches") {
    return (
      <Shell title="我的比赛" onBack={() => setStage("login")}>
        {matches.length === 0 ? (
          <EmptyState text="暂无分配给你的比赛" />
        ) : (
          <ul className="flex flex-col">
            {matches.map((m, i) => (
              <li key={m.matchId}>
                <button
                  onClick={() => openMatch(m)}
                  className={`w-full border-l-4 px-5 py-5 text-left transition-colors ${
                    activeMatch?.matchId === m.matchId
                      ? "border-[#ff4655] bg-white"
                      : "border-transparent bg-transparent hover:bg-white/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="mono-label text-[#d83b48]">MATCH {String(i + 1).padStart(2, "0")}</span>
                    <span className="mono-label text-[#667078]">{m.boType}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-lg font-semibold text-[#0f1923]">{m.teamAName}</span>
                    <span className="mx-3 text-sm text-[#667078]">VS</span>
                    <span className="text-lg font-semibold text-[#0f1923]">{m.teamBName}</span>
                  </div>
                  <div className="mt-1 flex justify-between text-sm text-[#667078]">
                    <span>{m.status}</span>
                    <span className="text-[#ff4655]">进入报分 →</span>
                  </div>
                </button>
                {i < matches.length - 1 && <div className="ml-5 border-b border-[#0f1923]/15" />}
              </li>
            ))}
          </ul>
        )}
      </Shell>
    );
  }

  if (stage === "report" && activeMatch) {
    const winner = autoWinner();
    return (
      <Shell title="录入比分" onBack={() => setStage("matches")}>
        <div className="border border-[#0f1923]/25 bg-white p-5">
          <p className="mono-label text-[#d83b48]">{activeMatch.boType} · {activeMatch.matchId}</p>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xl font-bold text-[#0f1923]">{activeMatch.teamAName}</span>
            <span className="mx-3 text-sm text-[#667078]">VS</span>
            <span className="text-xl font-bold text-[#0f1923]">{activeMatch.teamBName}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 border-t border-[#0f1923]/15 pt-3 text-center">
            <div>
              <span className="mono-label text-[#667078]">A 胜局</span>
              <div className="display-type mt-1 text-3xl font-extrabold text-[#0f1923]">{winsOf(games, "A")}</div>
            </div>
            <div>
              <span className="mono-label text-[#667078]">B 胜局</span>
              <div className="display-type mt-1 text-3xl font-extrabold text-[#0f1923]">{winsOf(games, "B")}</div>
            </div>
          </div>
        </div>

        {games.map((g, i) => (
          <div key={i} className="mt-4 border border-[#0f1923]/25 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="mono-label text-[#d83b48]">局 {i + 1}</span>
              <button onClick={() => removeGame(i)} className="text-sm text-[#667078] hover:text-[#ff4655]">移除</button>
            </div>
            <select
              value={g.map}
              onChange={(e) => updateGame(i, { map: e.target.value })}
              className="mt-3 h-11 w-full border border-[#0f1923]/25 bg-white px-3 text-base text-[#0f1923] outline-none focus:border-[#ff4655]"
              style={{ borderRadius: 0 }}
            >
              <option value="">选择地图</option>
              {currentMapOptions(i).map((m) => <option key={m} value={m}>{m}</option>)}
              {g.map && !VALORANT_MAPS.some((m) => m.name === g.map) && <option value={g.map}>{g.map}</option>}
            </select>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="mono-label text-[#667078]">{activeMatch.teamAName}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={g.teamAScore}
                  onChange={(e) => updateGame(i, { teamAScore: Number(e.target.value) || 0 })}
                  className="h-12 border border-[#0f1923]/25 bg-white px-3 text-center text-xl font-bold text-[#0f1923] outline-none focus:border-[#ff4655]"
                  style={{ borderRadius: 0 }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="mono-label text-[#667078]">{activeMatch.teamBName}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={g.teamBScore}
                  onChange={(e) => updateGame(i, { teamBScore: Number(e.target.value) || 0 })}
                  className="h-12 border border-[#0f1923]/25 bg-white px-3 text-center text-xl font-bold text-[#0f1923] outline-none focus:border-[#ff4655]"
                  style={{ borderRadius: 0 }}
                />
              </label>
            </div>
          </div>
        ))}

        <button
          onClick={addGame}
          disabled={games.length >= maxGames}
          className="mt-4 w-full border border-dashed border-[#0f1923]/30 bg-transparent px-4 py-4 text-base text-[#0f1923] hover:border-[#ff4655] hover:text-[#ff4655] disabled:opacity-40"
          style={{ borderRadius: 0 }}
        >
          + 添加一局（最多 {maxGames} 局）
        </button>

        {winner && (
          <div className="mt-4 border-l-4 border-[#ff4655] bg-white p-4">
            <p className="mono-label text-[#d83b48]">系统判定胜者</p>
            <p className="mt-1 text-lg font-bold text-[#0f1923]">{winner.name}</p>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-[#ff4655]">{error}</p>}

        <div className="mt-6 flex flex-col gap-3 pb-8">
          <button
            onClick={toConfirm}
            disabled={games.length === 0}
            className="btn-cut h-13 w-full bg-[#ff4655] text-base font-bold text-white hover:bg-[#d83b48] disabled:opacity-40"
          >
            下一步：凭证与确认
          </button>
        </div>
      </Shell>
    );
  }

  if (stage === "confirm" && confirmPayload && activeMatch) {
    return (
      <Shell title="确认提交" onBack={() => setStage("report")}>
        <div className="border border-[#0f1923]/25 bg-white p-5">
          <p className="mono-label text-[#d83b48]">{activeMatch.boType} · {activeMatch.matchId}</p>
          <div className="mt-2 text-xl font-bold text-[#0f1923]">
            {activeMatch.teamAName} <span className="text-sm text-[#667078]">VS</span> {activeMatch.teamBName}
          </div>
          <div className="mt-4 space-y-2 border-t border-[#0f1923]/15 pt-4">
            {confirmPayload.games.map((g, i) => (
              <div key={i} className="flex items-center justify-between text-base text-[#0f1923]">
                <span className="mono-label text-[#667078]">{g.map || `局 ${i + 1}`}</span>
                <span className="font-semibold">{g.teamAScore} : {g.teamBScore}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 border-l-4 border-[#ff4655] bg-white p-5">
          <p className="mono-label text-[#d83b48]">系统判定胜者（请对照截图确认）</p>
          <p className="mt-1 text-2xl font-extrabold text-[#0f1923]">{confirmPayload.declaredWinnerTeamName}</p>
          <p className="mt-2 text-sm leading-relaxed text-[#667078]">
            提交后即生效，写入正式赛果并推进晋级。若胜者不符，请返回检查比分——胜负由比分自动判定，无单独填写项。
          </p>
        </div>

        <div className="mt-4 border border-[#0f1923]/25 bg-white p-5">
          <p className="mono-label text-[#0f1923]">比赛凭证（截图）</p>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={onEvidenceChange} className="hidden" />
          <button
            onClick={onPickEvidence}
            disabled={uploading}
            className="mt-3 w-full border border-[#0f1923]/25 bg-white px-4 py-4 text-base text-[#0f1923] hover:border-[#ff4655] hover:text-[#ff4655] disabled:opacity-50"
            style={{ borderRadius: 0 }}
          >
            {uploading ? "上传中…" : evidenceIds.length > 0 ? `已上传 ${evidenceIds.length} 张` : "选择截图"}
          </button>
          {evidenceNames.length > 0 && (
            <ul className="mt-2 text-sm text-[#667078]">
              {evidenceNames.map((n, i) => <li key={i}>· {n}</li>)}
            </ul>
          )}
          {banner && <p className="mt-2 text-sm text-[#0f1923]">{banner}</p>}
        </div>

        {error && <p className="mt-3 text-sm text-[#ff4655]">{error}</p>}

        <div className="mt-6 flex flex-col gap-3 pb-8">
          <button
            onClick={doSubmit}
            disabled={submitting}
            className="btn-cut h-13 w-full bg-[#ff4655] text-base font-bold text-white hover:bg-[#d83b48] disabled:opacity-50"
          >
            {submitting ? "提交中…" : "提交并生效"}
          </button>
          <button
            onClick={() => setStage("report")}
            className="h-12 w-full border border-[#0f1923]/25 text-base text-[#0f1923] hover:bg-[#0f1923]/5"
            style={{ borderRadius: 0 }}
          >
            返回修改比分
          </button>
        </div>
      </Shell>
    );
  }

  if (stage === "done") {
    return (
      <Shell title="提交完成" onBack={() => { setStage("matches"); loadMatches(credential.trim()); }}>
        <div className="border-l-4 border-[#ff4655] bg-white p-6">
          <p className="mono-label text-[#d83b48]">SUBMITTED</p>
          <h2 className="display-type mt-2 text-3xl font-extrabold text-[#0f1923]">比分已生效</h2>
          <p className="mt-2 text-base leading-relaxed text-[#667078]">
            提交已写入正式赛果。如需更正，请联系管理员走受控更正流程，不可在界面直接修改。
          </p>
        </div>
        <button
          onClick={() => { setStage("matches"); loadMatches(credential.trim()); }}
          className="btn-cut mt-6 h-13 w-full bg-[#0f1923] text-base font-bold text-white hover:bg-[#25313b]"
        >
          返回我的比赛
        </button>
      </Shell>
    );
  }

  return null;
}

function Shell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-6">
      <div className="mb-5 flex items-center justify-between border-b border-[#0f1923]/20 pb-4">
        <button onClick={onBack} className="text-base text-[#0f1923] hover:text-[#ff4655]">← 返回</button>
        <h1 className="display-type text-xl font-extrabold tracking-[-0.04em] text-[#0f1923]">{title}</h1>
        <span className="w-8" />
      </div>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="border border-dashed border-[#0f1923]/25 p-10 text-center">
      <p className="text-base text-[#667078]">{text}</p>
    </div>
  );
}
