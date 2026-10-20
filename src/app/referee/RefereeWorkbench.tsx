"use client";

// =====================
// RPT-05 手机端裁判工作台
//
// 流程：登录 → 我的比赛 → 按 BP 逐局传图（AI 预填，可改）→ 汇总确认 → 提交结果
// 数据：走真实 /api/referee/*（本地 file 后端即可跑，接 Supabase 只改 DATA_BACKEND）。
//
// 2026-09-15 调整：把「传图」从最后一步挪到最前面。
//   原流程是先手工填完比分、最后才上传截图，等于截图只是存档；识图拿不到支配地位的输入。
//   新流程按 BP 已确定的地图序列**预生成上传位**（第几局由格子决定，不靠模型猜），
//   传图即识别、识别结果直接预填，裁判核对即可。
//   手工填分全程保留可用——识别失败或不准时不影响报分。
// =====================

import { useMemo, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { getGameConfig } from "@/lib/games";

/** 当前游戏的地图目录（数据在 `@/lib/games`）。用于手工录入时的地图下拉。 */
const MAP_CATALOG = getGameConfig().maps;

type MatchSummary = {
  matchId: string;
  teamAName: string;
  teamBName: string;
  boType: string;
  status: string;
  /** BP 已确定的地图序列（按局序）。空数组表示 BP 未完成，此时不预生成上传位 */
  mapSequence?: string[];
  /** 双方登场队员昵称；前端不直接展示，仅用于确认「识别有依据可用」 */
  squads?: { a: string[]; b: string[] } | null;
  /** 开始时间（空表示待排期） */
  startTime?: string;
  /** 是否为我本人认领（而非负责人指派）——两者的退出方式不同 */
  selfClaimed?: boolean;
  /** 与我手上另一场时间重叠（改期不会通知裁判，这是唯一的发现途径） */
  overlapsMyMatch?: boolean;
};

/** 尚未被人认领、且已具备执裁条件的比赛 */
type OpenMatch = {
  matchId: string;
  teamAName: string;
  teamBName: string;
  boType: string;
  startTime: string;
  endTime: string;
  mapSequence?: string[];
  /**
   * 与「我手上已有（认领或指派）的比赛」时间重叠——提示用，不阻断认领。
   * 措辞上不能只说「认领」：重叠的那场可能是负责人指派的。
   */
  overlapsMyMatch?: boolean;
};

type Stage = "login" | "matches" | "report" | "confirm" | "done";

type ConfirmPayload = {
  matchId: string;
  games: Array<{ map?: string; teamAScore: number; teamBScore: number }>;
  declaredWinnerTeamName: string;
  declaredWinnerSide: "A" | "B";
  /**
   * 我看到的对阵两队名，随提交回传。
   *
   * 用途：服务端用它做**逐场前置条件**校验 —— 万一抽签重排把 `M01` 换了对手，
   * 我这一屏还是旧对阵，回传的队名就对不上，服务端会拒掉并让我刷新重看，
   * 而不是把这份比分记到另一场上去。
   */
  teamAName: string;
  teamBName: string;
};

/** 一局的填报状态。图片与识别建议都挂在局上，而不是整场共用。 */
type GameDraft = {
  map: string;
  teamAScore: number;
  teamBScore: number;
  /** 本地预览用的 objectURL；仅用于显示，服务端不回传图片地址（凭证存在私有空间） */
  previewUrl?: string;
  /** 该局已上传的凭证 id，提交时一并带上 */
  evidenceId?: string;
  /** 该局上传/识别中的状态 */
  busy?: boolean;
  /** 识别给出的提示（地图不符、左右已校正、人数异常等） */
  notices?: string[];
  /** 识别是否成功过 */
  recognized?: boolean;
};

/** /api/referee/recognize 的返回结构 */
type RecognizeResponse = {
  evidenceId?: string;
  expiresAt?: string;
  recognized?: boolean;
  message?: string;
  suggestion?: {
    game: { map: string | null; teamAScore: number; teamBScore: number } | null;
    suggestedMap: string | null;
    mapMatchesBp: boolean | null;
    identity: { status: string; swapped: boolean; reasons: string[] } | null;
    issues: string[];
  } | null;
};

export default function RefereeWorkbench({ initialEventId }: { initialEventId: string }) {
  const [stage, setStage] = useState<Stage>("login");
  const [credential, setCredential] = useState("");
  const [eventId, setEventId] = useState(initialEventId);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [openMatches, setOpenMatches] = useState<OpenMatch[]>([]);
  const [claimingId, setClaimingId] = useState("");
  const [activeMatch, setActiveMatch] = useState<MatchSummary | null>(null);
  const [games, setGames] = useState<GameDraft[]>([]);
  const [confirmPayload, setConfirmPayload] = useState<ConfirmPayload | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");
  const [lastScheduleVersion, setLastScheduleVersion] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 当前正在给哪一局传图（用于让 input 知道传回来的文件属于谁） */
  const uploadTargetRef = useRef<number>(0);

  const boType = activeMatch?.boType ?? "BO3";
  const winTarget = useMemo(() => ({ BO1: 1, BO3: 2, BO5: 3 }[boType] ?? 2), [boType]);
  const maxGames = winTarget * 2 - 1;

  function winsOf(list: GameDraft[], side: "A" | "B"): number {
    return list.filter((g) => (side === "A" ? g.teamAScore > g.teamBScore : g.teamBScore > g.teamAScore)).length;
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
      await Promise.all([loadMatches(credential.trim()), loadOpenMatches(credential.trim())]);
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

  /**
   * 加载可认领的比赛。
   *
   * 对应实际流程：队伍先约好时间得到比赛列表，裁判自己挑能执裁的认领。
   * 已排期、未完成、还没人认领的场次才会出现在这里。
   */
  async function loadOpenMatches(cred: string) {
    try {
      const res = await fetch(`/api/referee/claim?eventId=${encodeURIComponent(eventId)}`, {
        headers: { "x-referee-credential": cred },
      });
      if (!res.ok) return; // 读不到只是没有可认领列表，不阻塞「我的比赛」
      const data = (await res.json()) as { matches: OpenMatch[] };
      setOpenMatches(data.matches ?? []);
    } catch {
      // 忽略：可认领列表是辅助信息，失败不应打断主流程
    }
  }

  /** 认领或释放一场比赛，然后刷新两个列表 */
  async function claimAction(matchId: string, action: "claim" | "release") {
    setClaimingId(matchId);
    setError("");
    setBanner("");
    try {
      const res = await fetch("/api/referee/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-referee-credential": credential.trim() },
        body: JSON.stringify({ eventId, matchId, action, credential: credential.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        // 409 = 刚被别人抢走。这不是出错，是抢单的正常结果，要如实告诉裁判。
        setError(res.status === 409 ? (data.message ?? "这场刚被别人认领了") : (data.message ?? "操作失败"));
        await Promise.all([loadMatches(credential.trim()), loadOpenMatches(credential.trim())]);
        setClaimingId("");
        return;
      }
      setBanner(data.message ?? (action === "claim" ? "已认领该场" : "已释放该场"));
      await Promise.all([loadMatches(credential.trim()), loadOpenMatches(credential.trim())]);
    } catch {
      setError("网络连接失败，请重试");
    }
    setClaimingId("");
  }

  function openMatch(match: MatchSummary) {
    setActiveMatch(match);
    // 按 BP 已确定的地图序列**预生成上传位**：第几局由格子决定，不靠模型从图上猜。
    // BP 未完成时只给一格，裁判自行加局。
    const seq = match.mapSequence ?? [];
    setGames(
      seq.length > 0
        ? seq.map((map) => ({ map, teamAScore: 0, teamBScore: 0 }))
        : [{ map: "", teamAScore: 0, teamBScore: 0 }],
    );
    setStage("report");
    setError("");
    setBanner("");
  }

  function patchGame(index: number, patch: Partial<GameDraft>) {
    setGames((prev) => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function addGame() {
    if (games.length >= maxGames) return;
    setGames([...games, { map: "", teamAScore: 0, teamBScore: 0 }]);
  }

  function updateGame(index: number, patch: Partial<GameDraft>) {
    patchGame(index, patch);
  }

  /**
   * 比分输入。
   *
   * 刻意用 `type="text"` 而不是 `type="number"`：原生数字输入框会画出 spinner
   * （右侧那个上下箭头方块），它既占宽度又把 `text-center` 顶掉，
   * 结果就是比分贴着左边、两个框看起来还不对称 —— 实测在裁判报分弹窗里就是这样。
   * 改成文本 + 这里过滤非数字，视觉可控，且提交前的整数校验仍然兜底。
   */
  function toScore(raw: string): number {
    const digits = raw.replace(/\D/g, "").slice(0, 3);
    return digits ? Number(digits) : 0;
  }

  function removeGame(index: number) {
    setGames((prev) => prev.filter((_, i) => i !== index));
  }

  /**
   * 已填写的局。
   *
   * 0:0 视为「这一局还没打」——BO3 预生成 3 格，若 2:0 就结束，第 3 格会留空。
   * 若不这样处理，空格子会被当成「平局」而拒绝提交。
   */
  function playedGames(): GameDraft[] {
    return games.filter((g) => !(g.teamAScore === 0 && g.teamBScore === 0));
  }

  function currentMapOptions(index: number): string[] {
    const used = new Set(games.filter((_, gameIndex) => gameIndex !== index).map((g) => g.map).filter(Boolean));
    return MAP_CATALOG.filter((m) => !used.has(m.name)).map((m) => m.name);
  }

  function autoWinner(): { side: "A" | "B"; name: string } | null {
    if (!activeMatch) return null;
    const played = playedGames();
    if (played.length === 0) return null;
    const a = played.filter((g) => g.teamAScore > g.teamBScore).length;
    const b = played.filter((g) => g.teamBScore > g.teamAScore).length;
    // 未达胜负分时不给最终胜者，只显示进程
    if (a < winTarget && b < winTarget) return null;
    return a > b
      ? { side: "A", name: activeMatch.teamAName }
      : { side: "B", name: activeMatch.teamBName };
  }

  function validatedGames(): Array<{ map?: string; teamAScore: number; teamBScore: number }> | null {
    const played = playedGames();
    if (played.length === 0) { setError("请至少录入一局比分"); return null; }
    // 每局须无平局且分数非负
    for (const g of played) {
      if (!Number.isSafeInteger(g.teamAScore) || !Number.isSafeInteger(g.teamBScore)) { setError("比分必须是整数"); return null; }
      if (g.teamAScore === g.teamBScore) { setError("每局比分不能平局"); return null; }
      if (g.teamAScore < 0 || g.teamBScore < 0) { setError("比分不能为负"); return null; }
    }
    const winner = autoWinner();
    if (!winner) { setError(`该赛制需一方先达到 ${winTarget} 胜局`); return null; }
    return played.map((g) => ({ map: g.map || undefined, teamAScore: g.teamAScore, teamBScore: g.teamBScore }));
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
      teamAName: activeMatch.teamAName,
      teamBName: activeMatch.teamBName,
    });
    setStage("confirm");
    setError("");
  }

  function onPickEvidence(index: number) {
    uploadTargetRef.current = index;
    fileInputRef.current?.click();
  }

  function onEvidenceChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const index = uploadTargetRef.current;
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    void recognizeForGame(index, file);
  }

  /**
   * 传一张图并识别，结果预填到对应那一局。
   *
   * 图会一并存成凭证——所以即使识别失败，凭证也已留档，裁判手工填分即可。
   * 识别只是「省打字」，不是报分的前置条件。
   */
  async function recognizeForGame(index: number, file: File) {
    // 用本地预览：凭证存在私有空间，服务端不回传图片地址
    const previous = games[index]?.previewUrl;
    if (previous) URL.revokeObjectURL(previous);
    const previewUrl = URL.createObjectURL(file);

    patchGame(index, { busy: true, previewUrl, notices: [], recognized: false });
    setError("");
    setBanner("");

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("eventId", eventId);
      form.append("matchId", activeMatch?.matchId ?? "");
      form.append("gameIndex", String(index + 1));
      form.append("credential", credential.trim());

      const res = await fetch("/api/referee/recognize", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as RecognizeResponse;

      if (!res.ok) {
        patchGame(index, { busy: false, notices: [data.message ?? "上传失败，请重试"] });
        return;
      }

      const suggestion = data.suggestion;
      const notices = [...(suggestion?.issues ?? [])];
      if (!data.recognized || !suggestion) {
        notices.push(data.message ?? "没有识别出可用比分，请手工填写");
        patchGame(index, { busy: false, evidenceId: data.evidenceId, notices, recognized: false });
        return;
      }

      // 只在识别出数字时覆盖：避免把裁判已经填好的分数清成 0
      patchGame(index, {
        busy: false,
        evidenceId: data.evidenceId,
        recognized: true,
        notices,
        ...(suggestion.game
          ? { teamAScore: suggestion.game.teamAScore, teamBScore: suggestion.game.teamBScore }
          : {}),
        ...(suggestion.suggestedMap ? { map: suggestion.suggestedMap } : {}),
      });
      setBanner(notices.length > 0 ? "识别完成，请核对提示项" : "识别完成，请核对后提交");
    } catch {
      patchGame(index, { busy: false, notices: ["网络失败，可重试或直接手工填写"] });
    }
  }

  async function doSubmit() {
    if (!confirmPayload) return;
    setSubmitting(true);
    setError("");
    try {
      // 凭证按局收集：传过图的局才有 id
      const evidenceIds = games.map((g) => g.evidenceId).filter((id): id is string => Boolean(id));
      const res = await fetch("/api/referee/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: credential.trim(),
          eventId,
          matchId: confirmPayload.matchId,
          // 仅供参考与记录：放行与否由服务端按「这场比赛还是不是你看到的那一场」判断，
          // 不再比对版本号（版本号是全局的，别人报别的场次也会让它变）。
          basedOnScheduleVersion: lastScheduleVersion,
          expectedTeamAName: confirmPayload.teamAName,
          expectedTeamBName: confirmPayload.teamBName,
          games: confirmPayload.games,
          evidenceIds,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; status?: string };
      if (!res.ok) {
        // 409 = 对阵已变更（我这一屏仍是旧对阵）。服务端给的说明更具体，优先用它。
        if (res.status === 409) setError(data.message ?? "这场比赛的对阵已变更，请刷新页面后重试");
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
          <p className="mono-label text-[var(--pub-red)]">REFEREE GATE</p>
          <h1 className="display-type mt-2 text-[2.4rem] font-extrabold leading-none tracking-[-0.05em] text-[var(--pub-txt)]">
            裁判工作台
          </h1>
          <p className="mt-3 text-base text-[var(--pub-txt-soft)]">输入管理员发给你的裁判凭证，进入被分配的比赛。</p>
        </div>
        <form onSubmit={doLogin} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="mono-label text-[var(--pub-txt)]">裁判凭证</span>
            <input
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder="粘贴凭证"
              autoComplete="off"
              className="h-[48px] border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-4 text-base text-[var(--pub-txt)] outline-none focus:border-[#ff4655]"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="mono-label text-[var(--pub-txt)]">赛事 ID</span>
            <input
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              placeholder="例如 event-1"
              autoComplete="off"
              className="h-[48px] border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-4 text-base text-[var(--pub-txt)] outline-none focus:border-[#ff4655]"
            />
          </label>
          {error && <p className="text-sm text-[#ff4655]">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="mt-2 w-full">
            进入工作台
          </Button>
        </form>
        <p className="mt-6 text-xs leading-relaxed text-[var(--pub-txt-soft)]">凭证只保存在当前页面内存中，刷新或关闭页面后需要重新输入。</p>
      </div>
    );
  }

  if (stage === "matches") {
    return (
      <Shell title="我的比赛" onBack={() => setStage("login")}>
        {error && <p className="mb-4 border-l-4 border-[#ff4655] bg-[var(--pub-card)] px-4 py-3 text-sm text-[var(--pub-red)]">{error}</p>}
        {banner && <p className="mb-4 border-l-4 border-[var(--pub-line)] bg-[var(--pub-card)] px-4 py-3 text-sm text-[var(--pub-txt)]">{banner}</p>}

        {/* ---- 我的比赛：已认领或被指派的场次 ---- */}
        <section className="mb-6">
          <div className="flex items-center justify-between border-b-2 border-[var(--pub-red)]/40 px-1 pb-2">
            <h2 className="mono-label text-[var(--pub-txt)]">我的比赛 · {matches.length}</h2>
            <Button
              variant="ghost"
              size="md"
              onClick={() => void Promise.all([loadMatches(credential.trim()), loadOpenMatches(credential.trim())])}
            >
              刷新
            </Button>
          </div>
          {matches.length === 0 ? (
            <EmptyState text="还没有你要裁的比赛，从下面挑一场认领" />
          ) : (
            <ul className="flex flex-col">
              {matches.map((m, i) => (
                <li key={m.matchId}>
                  <div className="w-full border-l-4 border-transparent bg-[var(--pub-card)] px-5 py-5">
                    <div className="flex items-center justify-between">
                      <span className="mono-label text-[var(--pub-red)]">MATCH {String(i + 1).padStart(2, "0")}</span>
                      <span className="mono-label text-[var(--pub-txt-soft)]">
                        {m.boType}
                        {m.selfClaimed ? " · 我认领的" : " · 负责人指派"}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-lg font-semibold text-[var(--pub-txt)]">{m.teamAName}</span>
                      <span className="mx-3 text-sm text-[var(--pub-txt-soft)]">VS</span>
                      <span className="text-lg font-semibold text-[var(--pub-txt)]">{m.teamBName}</span>
                    </div>
                    {m.startTime && <p className="mt-1 text-sm text-[var(--pub-txt-soft)]">{fmtTime(m.startTime)}</p>}
                    {m.overlapsMyMatch && (
                      <p className="mt-2 border-l-2 border-[var(--pub-red)] pl-3 text-xs leading-5 text-[var(--pub-red)]">
                        这场和你手上的另一场时间重叠了。若是改期造成的，请找负责人确认该怎么排。
                      </p>
                    )}
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-sm text-[var(--pub-txt-soft)]">{m.status}</span>
                      <div className="flex items-center gap-2">
                        {m.selfClaimed && m.status !== "已完成" && (
                          <Button
                            variant="secondary"
                            size="md"
                            onClick={() => void claimAction(m.matchId, "release")}
                            disabled={claimingId === m.matchId}
                          >
                            {claimingId === m.matchId ? "处理中…" : "释放这场"}
                          </Button>
                        )}
                        <Button variant="primary" size="md" onClick={() => openMatch(m)}>
                          进入报分 →
                        </Button>
                      </div>
                    </div>
                    {!m.selfClaimed && (
                      <p className="mt-2 text-xs leading-5 text-[var(--pub-txt-soft)]">
                        这场是负责人指派的，如需退出请联系负责人撤销。
                      </p>
                    )}
                  </div>
                  {i < matches.length - 1 && <div className="ml-5 border-b border-[var(--pub-line-soft)]" />}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- 可认领的比赛：已约好时间、还没人认领的场次 ---- */}
        <section className="pb-8">
          <h2 className="mono-label block border-b-2 border-[var(--pub-red)]/40 px-1 pb-2 text-[var(--pub-txt)]">可认领的比赛 · {openMatches.length}</h2>
          {openMatches.length === 0 ? (
            <EmptyState text="暂时没有可认领的比赛。等队伍约好时间后会出现在这里。" />
          ) : (
            <ul className="flex flex-col">
              {openMatches.map((m) => (
                <li key={m.matchId} className="border-l-4 border-transparent bg-[var(--pub-card)] px-5 py-5">
                  <div className="flex items-center justify-between">
                    <span className="mono-label text-[var(--pub-txt)]">{fmtTime(m.startTime)}</span>
                    <span className="mono-label text-[var(--pub-txt-soft)]">{m.boType}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-base font-semibold text-[var(--pub-txt)]">{m.teamAName}</span>
                    <span className="mx-3 text-sm text-[var(--pub-txt-soft)]">VS</span>
                    <span className="text-base font-semibold text-[var(--pub-txt)]">{m.teamBName}</span>
                  </div>
                  {(m.mapSequence?.length ?? 0) > 0 && (
                    <p className="mt-1 text-xs text-[var(--pub-txt-soft)]">地图：{m.mapSequence!.join("、")}</p>
                  )}
                  {m.overlapsMyMatch && (
                    <p className="mt-2 border-l-2 border-[var(--pub-red)] pl-3 text-xs leading-5 text-[var(--pub-red)]">
                      这个时段和你手上的另一场（认领或指派的）重叠，一个人没法同时裁两场——请先确认。
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void claimAction(m.matchId, "claim")}
                    disabled={claimingId === m.matchId}
                    className="mt-3 min-h-[44px] w-full border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-4 text-sm font-bold text-[var(--pub-txt)] hover:border-[#ff4655] hover:text-[#ff4655] disabled:opacity-50"
                  >
                    {claimingId === m.matchId ? "认领中…" : "我来裁这场"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Shell>
    );
  }

  if (stage === "report" && activeMatch) {
    const winner = autoWinner();
    const played = playedGames();
    const bpReady = (activeMatch.mapSequence?.length ?? 0) > 0;
    return (
      <Shell title="逐局传图与报分" onBack={() => setStage("matches")}>
        <div className="border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-5">
          <p className="mono-label text-[var(--pub-red)]">{activeMatch.boType} · {activeMatch.matchId}</p>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xl font-bold text-[var(--pub-txt)]">{activeMatch.teamAName}</span>
            <span className="mx-3 text-sm text-[var(--pub-txt-soft)]">VS</span>
            <span className="text-xl font-bold text-[var(--pub-txt)]">{activeMatch.teamBName}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 border-t border-[var(--pub-line-soft)] pt-3 text-center">
            <div>
              <span className="mono-label text-[var(--pub-txt-soft)]">A 胜局</span>
              <div className="display-type mt-1 text-3xl font-extrabold text-[var(--pub-txt)]">{winsOf(played, "A")}</div>
            </div>
            <div>
              <span className="mono-label text-[var(--pub-txt-soft)]">B 胜局</span>
              <div className="display-type mt-1 text-3xl font-extrabold text-[var(--pub-txt)]">{winsOf(played, "B")}</div>
            </div>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[var(--pub-txt-soft)]">
            {bpReady
              ? "按下方格子逐局上传结果截图。上传后会自动读出比分，核对无误再提交。"
              : "这场还没有 BP 地图记录，格子里的地图需要你手动选择。"}
          </p>
        </div>

        {/* 隐藏的文件输入：每次只服务一个格子，由 uploadTargetRef 记住是哪一局 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onEvidenceChange}
          className="hidden"
        />

        {games.map((g, i) => (
          <div key={i} className="mt-4 border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="mono-label text-[var(--pub-red)]">局 {i + 1}</span>
                {g.recognized && <span className="mono-label text-[var(--pub-txt-soft)]">已识别</span>}
              </div>
              <button
                onClick={() => removeGame(i)}
                className="inline-flex min-h-[44px] items-center px-2 text-sm text-[var(--pub-txt-soft)] hover:text-[#ff4655]"
              >
                移除
              </button>
            </div>

            {/* 地图：BP 已确定时展示为文字（不让改，避免与 BP 记录不一致），未确定时才给下拉 */}
            {bpReady && activeMatch.mapSequence?.[i] ? (
              <p className="mt-2 text-base font-bold text-[var(--pub-txt)]">
                {activeMatch.mapSequence[i]}
                {g.map && g.map !== activeMatch.mapSequence[i] && (
                  <span className="ml-2 text-sm font-normal text-[#ff4655]">图上读到：{g.map}</span>
                )}
              </p>
            ) : (
              <select
                value={g.map}
                onChange={(e) => updateGame(i, { map: e.target.value })}
                className="mt-2 h-[44px] w-full border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-3 text-base text-[var(--pub-txt)] outline-none focus:border-[#ff4655]"
              >
                <option value="">选择地图</option>
                {currentMapOptions(i).map((m) => <option key={m} value={m}>{m}</option>)}
                {g.map && !MAP_CATALOG.some((m) => m.name === g.map) && <option value={g.map}>{g.map}</option>}
              </select>
            )}

            <div className="mt-3 flex items-start gap-3">
              {g.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={g.previewUrl}
                  alt={"第 " + (i + 1) + " 局截图"}
                  className="h-24 w-40 shrink-0 border border-[var(--pub-line-soft)] object-cover"
                />
              ) : (
                <div className="flex h-24 w-40 shrink-0 items-center justify-center border border-dashed border-[var(--pub-line-soft)] text-xs text-[var(--pub-txt-soft)]">
                  未上传
                </div>
              )}
              <button
                onClick={() => onPickEvidence(i)}
                disabled={g.busy}
                className="min-h-[44px] flex-1 border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-4 text-sm text-[var(--pub-txt)] hover:border-[#ff4655] hover:text-[#ff4655] disabled:opacity-50"
              >
                {g.busy ? "识别中…" : g.previewUrl ? "重新上传" : "上传这一局截图"}
              </button>
            </div>

            {g.notices && g.notices.length > 0 && (
              <ul className="mt-2 space-y-1 border-l-2 border-[#ff4655] pl-3 text-xs leading-relaxed text-[var(--pub-txt-soft)]">
                {g.notices.map((n, k) => <li key={k}>· {n}</li>)}
              </ul>
            )}

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="mono-label text-[var(--pub-txt-soft)]">{activeMatch.teamAName}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={g.teamAScore}
                  onChange={(e) => updateGame(i, { teamAScore: toScore(e.target.value) })}
                  className="score-input h-[48px] border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-3 text-center text-xl font-bold text-[var(--pub-txt)] outline-none focus:border-[#ff4655]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="mono-label text-[var(--pub-txt-soft)]">{activeMatch.teamBName}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={g.teamBScore}
                  onChange={(e) => updateGame(i, { teamBScore: toScore(e.target.value) })}
                  className="score-input h-[48px] border border-[var(--pub-line-soft)] bg-[var(--pub-card)] px-3 text-center text-xl font-bold text-[var(--pub-txt)] outline-none focus:border-[#ff4655]"
                />
              </label>
            </div>
          </div>
        ))}

        {games.length < maxGames && maxGames > 1 && (
          <button
            onClick={addGame}
            className="mt-4 w-full border border-dashed border-[var(--pub-line-soft)] bg-transparent px-4 py-4 text-base text-[var(--pub-txt)] hover:border-[#ff4655] hover:text-[#ff4655]"
          >
            + 添加一局（最多 {maxGames} 局）
          </button>
        )}

        {winner && (
          <div className="mt-4 border-l-4 border-[#ff4655] bg-[var(--pub-card)] p-4">
            <p className="mono-label text-[var(--pub-red)]">系统判定胜者</p>
            <p className="mt-1 text-lg font-bold text-[var(--pub-txt)]">{winner.name}</p>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-[#ff4655]">{error}</p>}

        <div className="mt-6 flex flex-col gap-3 pb-8">
          <button
            onClick={toConfirm}
            disabled={played.length === 0}
            className="btn-cut h-13 w-full bg-[#ff4655] text-base font-bold text-white hover:bg-[#d83b48] disabled:opacity-40"
          >
            下一步：确认提交
          </button>
        </div>
      </Shell>
    );
  }

  if (stage === "confirm" && confirmPayload && activeMatch) {
    const uploadedCount = games.filter((g) => g.evidenceId).length;
    return (
      <Shell title="确认提交" onBack={() => setStage("report")}>
        <div className="border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-5">
          <p className="mono-label text-[var(--pub-red)]">{activeMatch.boType} · {activeMatch.matchId}</p>
          <div className="mt-2 text-xl font-bold text-[var(--pub-txt)]">
            {activeMatch.teamAName} <span className="text-sm text-[var(--pub-txt-soft)]">VS</span> {activeMatch.teamBName}
          </div>
          <div className="mt-4 space-y-2 border-t border-[var(--pub-line-soft)] pt-4">
            {confirmPayload.games.map((g, i) => (
              <div key={i} className="flex items-center justify-between text-base text-[var(--pub-txt)]">
                <span className="mono-label text-[var(--pub-txt-soft)]">{g.map || `局 ${i + 1}`}</span>
                <span className="font-semibold">{g.teamAScore} : {g.teamBScore}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 border-l-4 border-[#ff4655] bg-[var(--pub-card)] p-5">
          <p className="mono-label text-[var(--pub-red)]">系统判定胜者（请对照截图确认）</p>
          <p className="mt-1 text-2xl font-extrabold text-[var(--pub-txt)]">{confirmPayload.declaredWinnerTeamName}</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--pub-txt-soft)]">
            提交后即生效，写入正式赛果并推进晋级。若胜者不符，请返回检查比分——胜负由比分自动判定，无单独填写项。
          </p>
        </div>

        {/* 凭证在上一屏已随图上传，这里只做核对展示，不再重复上传 */}
        <div className="mt-4 border border-[var(--pub-line-soft)] bg-[var(--pub-card)] p-5">
          <p className="mono-label text-[var(--pub-txt)]">比赛凭证（截图）</p>
          {uploadedCount > 0 ? (
            <>
              <p className="mt-2 text-sm text-[var(--pub-txt-soft)]">
                已随各局上传 {uploadedCount} 张，提交时会一并归档。
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {games.map((g, i) =>
                  g.previewUrl ? (
                    <li key={i} className="border border-[var(--pub-line-soft)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={g.previewUrl} alt={"第 " + (i + 1) + " 局截图"} className="h-20 w-32 object-cover" />
                      <p className="mono-label px-2 py-1 text-[var(--pub-txt-soft)]">局 {i + 1}</p>
                    </li>
                  ) : null,
                )}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-[var(--pub-txt-soft)]">
              这一场还没有上传截图。可以返回上一屏补传，也可以直接提交——凭证不是提交的必要条件。
            </p>
          )}
          {banner && <p className="mt-2 text-sm text-[var(--pub-txt)]">{banner}</p>}
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
            className="h-[48px] w-full border border-[var(--pub-line-soft)] text-base text-[var(--pub-txt)] hover:bg-white/[0.04]"
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
        <div className="border-l-4 border-[#ff4655] bg-[var(--pub-card)] p-6">
          <p className="mono-label text-[var(--pub-red)]">SUBMITTED</p>
          <h2 className="display-type mt-2 text-3xl font-extrabold text-[var(--pub-txt)]">比分已生效</h2>
          <p className="mt-2 text-base leading-relaxed text-[var(--pub-txt-soft)]">
            提交已写入正式赛果。如需更正，请联系管理员走受控更正流程，不可在界面直接修改。
          </p>
        </div>
        <button
          onClick={() => { setStage("matches"); loadMatches(credential.trim()); }}
          className="btn-cut mt-6 h-13 w-full bg-[var(--pub-card)] text-base font-bold text-white hover:bg-white/[0.08]"
        >
          返回我的比赛
        </button>
      </Shell>
    );
  }

  return null;
}

/** 把 ISO 时间显示成「10-06 12:00」——裁判看比赛时间不需要年份和秒 */
function fmtTime(iso: string): string {
  if (!iso) return "时间待定";
  return iso.slice(5, 16).replace("T", " ");
}

function Shell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-6">
      <div className="mb-5 flex items-center justify-between border-b-2 border-[var(--pub-red)] pb-4">
        {/* min-h-[44px] = 44px：手机上可点。此前只有 text-base（约 24px 高），
            是裁判端手机适配里最后一处未达标的触控目标。宽度 53px 本来就够，故不加横向 padding，
            以免按钮变宽把标题挤歪（右侧只有 w-8 的占位）。 */}
        <button
          onClick={onBack}
          className="inline-flex min-h-[44px] items-center text-base text-[var(--pub-txt)] hover:text-[#ff4655]"
        >
          ← 返回
        </button>
        <h1 className="display-type text-xl font-extrabold tracking-[-0.04em] text-[var(--pub-txt)]">{title}</h1>
        <span className="w-8" />
      </div>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="border border-dashed border-[var(--pub-line-soft)] bg-white/[0.03] p-10 text-center">
      <p className="text-base text-[var(--pub-txt-soft)]">{text}</p>
    </div>
  );
}
