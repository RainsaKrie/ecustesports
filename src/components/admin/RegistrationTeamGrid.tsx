// =====================
// 队伍网格（2026-10-26 从 RegistrationOperationsWorkspace.tsx 拆出）
// 原文件 778 行被架构守卫锁行。这段是 teams tab 的主体，只依赖 4 个外部变量：
// visibleTeams / state.teams（判空）/ openModal / bracketTeamIds。其余全是渲染。
// =====================

import { AdminOverflowMenu, EmptyState } from "@/components/admin/ui";
import type { RegistrationPlayer, RegistrationTeam } from "@/lib/domains/registration/data";
import { CopyButton, DENSE_META, DENSE_MICRO, DENSE_TITLE, GAME, copyActionClass, isFlagged, teamTone, type Modal, type TeamRoster } from "@/components/admin/RegistrationWorkspaceParts";

export function TeamGrid({
  teams,
  visibleTeams,
  openModal,
  bracketTeamIds,
}: {
  teams: RegistrationTeam[];
  visibleTeams: { team: RegistrationTeam; roster: TeamRoster }[];
  openModal: (next: Modal) => void;
  bracketTeamIds: string[];
}) {
  if (teams.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          title="还没有队伍"
          description="队伍由队长在玩家页面创建后出现在这里。也可以从页头「⋯」里的「代建队伍」先建好，再把选手放进去。"
        />
      </div>
    );
  }

  return (
    <div className="grid gap-[6px] md:grid-cols-2 xl:grid-cols-3">
  state.teams.length === 0
    ? (
      <div className="p-5">
        <EmptyState
          title="还没有队伍"
          description="队伍由队长在玩家页面创建后出现在这里。也可以从页头「⋯」里的「代建队伍」先建好，再把选手放进去。"
        />
      </div>
    )
    : visibleTeams.length === 0
      ? (
        <div className="p-5">
          <EmptyState title="这个筛选下没有队伍" description="换一个筛选条件再看看。" />
        </div>
      )
      : (
        <div className="grid gap-[6px] md:grid-cols-2 xl:grid-cols-3">
      {visibleTeams.map(({ team, roster }) => {
        const members = roster.members;
        const captain = roster.captain;
        const flaggedCount = members.filter((player) => isFlagged(player.reviewStatus)).length;
        // 低频/破坏性操作收进「更多」，队头只留一个主操作。
        // 原先 4 个按钮横排 + shrink-0，把队名挤到换行、右列还会溢出被裁。
        const teamActions: Array<{ text: string; onSelect: () => void; tone?: string }> = [];
        if (team.status === "报名中") {
          teamActions.push({ text: "改名", onSelect: () => openModal({ kind: "rename-team", team }) });
        }
        if (team.status === "报名中" || (team.status === "已冻结" && !bracketTeamIds.includes(team.id))) {
          teamActions.push({ text: "解散队伍", onSelect: () => openModal({ kind: "dissolve-team", team }), tone: "text-[var(--adm-warn-text)]" });
        }
        if (team.status !== "已退赛") {
          teamActions.push({ text: "整队退赛", onSelect: () => openModal({ kind: "withdraw-team", team }), tone: "text-[var(--adm-red-text)]" });
        }
        return (
          <article key={team.id} className={`border border-[var(--adm-line)] bg-[var(--adm-surface)] px-[10px] py-[8px] leading-tight ${roster.withdrawn ? "bg-[var(--adm-surface-2)] text-[var(--adm-text-mute)]" : ""}`}>
            <div className="flex items-start justify-between gap-[8px]">
              <div className="flex min-w-0 flex-wrap items-center gap-[6px]">
                <h3 className={`truncate ${DENSE_TITLE} font-semibold text-[var(--adm-text)]`}>{team.name}</h3>
                <span className="adm-chip shrink-0" data-tone={teamTone(team.status)}>{team.status === "已冻结" ? "正式名单" : team.status}</span>
                <span className={`shrink-0 ${DENSE_MICRO} font-medium tabular-nums ${roster.complete ? "text-[var(--adm-text-mute)]" : "text-[var(--adm-red-text)]"}`}>首发 {roster.starterCount}/{GAME.roster.starters}</span>
                {/* 平均段位是资格赛选队的依据，必须看得见 —— 否则「按段位排序」也是黑箱。
                    一个人都没填段位时不显示 0.00，那会让人误以为是「最弱」。 */}
                <span className={`shrink-0 ${DENSE_MICRO} font-medium tabular-nums text-[var(--adm-text-soft)]`} title="首发 5 人段位均值（铁 1 → 无畏战魂 9）">均 {roster.avgRank > 0 ? roster.avgRank.toFixed(2) : "—"}</span>
                {roster.unrankedStarters > 0 && <span className="adm-chip shrink-0" data-tone="attention">{roster.unrankedStarters} 人未填段位</span>}
              </div>
              <div className="flex shrink-0 items-center gap-[4px]">
                {team.status === "已冻结" && <button type="button" onClick={() => openModal({ kind: "reopen-team", team })} className="adm-btn adm-btn--secondary adm-btn--sm">开放调整</button>}
                <AdminOverflowMenu size="compact" label={`${team.name} 的更多操作`} items={teamActions} />
              </div>
            </div>
            {flaggedCount > 0 && <p className={`mt-[4px] ${DENSE_META} font-bold text-[var(--adm-warn-text)]`}>{flaggedCount} 人资料待修改，需先标记通过才能确认名单</p>}
            {/* 队长联系方式直接摆在卡片上。负责人要把队长逐个拉进队长群，
                原来的路径是「点开队伍 → 记住队长 ID → 去选手列表搜这个 ID → 再找联系方式」，
                36 支队就是 36 遍。这里一次给全：ID、号码、是 QQ 还是手机、一键复制。
                号码缺失时显式标黄，避免「看着有空位、实际没填」被漏掉。 */}
            {/* 阵容摘要：七个点位 + 人数，点一下开弹窗看名单与操作。
                弹窗而不是就地展开 —— 四列（ID/姓名/学号）+ 每人操作塞不进卡片宽度，
                就地展开会把卡片撑高、把 ID 截断（负责人截图里已经截了）。 */}
            <button
              type="button"
              onClick={() => openModal({ kind: "team-detail", team })}
              className={`mt-[6px] flex w-full items-center gap-[6px] border-t border-[var(--adm-line-soft)] pt-[5px] text-left ${DENSE_META}`}
            >
              <span className={`${DENSE_MICRO} font-bold text-[var(--adm-text-mute)]`}>阵容</span>
              <span className="flex items-center gap-[2px]" aria-hidden="true">
                {Array.from({ length: GAME.roster.starters + 2 }, (_, i) => {
                  const filled = i < roster.starterCount || i >= GAME.roster.starters;
                  return <span key={i} className={`h-[6px] w-[12px] ${filled ? "bg-[var(--adm-text-soft)]" : "bg-[var(--adm-line-soft)]"}`} />;
                })}
              </span>
              <span className="font-bold tabular-nums text-[var(--adm-text-soft)]">{members.length} 人</span>
              <span className="text-[var(--adm-red-text)] group-hover:underline">查看队员与核验</span>
            </button>

            <div className={`mt-[5px] flex min-w-0 items-center gap-[6px] ${DENSE_META}`}>
              <span className={`${DENSE_MICRO} font-bold text-[var(--adm-text-mute)]`}>队长</span>
              {captain ? (
                <>
                  <span className="min-w-0 truncate font-bold text-[var(--adm-text)]">{captain.gameId}</span>
                  <span className={`shrink-0 ${DENSE_MICRO} font-bold text-[var(--adm-text-mute)]`}>{captain.qq ? "QQ" : captain.phone ? "手机" : "联系方式"}</span>
                  <span className={`truncate tabular-nums ${roster.contact === "未填写" ? "text-[var(--adm-red-text)]" : "text-[var(--adm-text-soft)]"}`}>{roster.contact}</span>
                  {roster.contact !== "未填写" && <CopyButton text={roster.contact} title={`复制队长 ${captain.gameId} 的联系方式`} className={copyActionClass} />}
                </>
              ) : (
                <span className="font-bold text-[var(--adm-warn-text)]">队长不在名单中</span>
              )}
            </div>
            
          </article>
        );
      })}
        </div>
      )
    </div>
  );
}
