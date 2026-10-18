// =====================
// 队员管理弹窗（2026-10-18）
//
// 为什么要弹窗：队卡是**列表项**，职责是"扫一眼要不要处理"；阵容 + 每人操作是**查看与操作**，
// 塞进卡片只会两头都难受 —— 卡片变高，四列挤在窄宽度里被截断（负责人截图里 ID 已被截）。
// 公开页早就是"卡 → 弹窗"，这里跟它保持一致。
//
// 只做展示与派发：所有写操作仍由调用方（工作台页面）走 openModal，不在这里直接发请求。
// =====================

import type { RegistrationPlayer, RegistrationTeam } from "@/lib/scheduling/registration-data";
import AdminModal from "@/components/admin/ui/AdminModal";
import AdminOverflowMenu from "@/components/admin/ui/AdminOverflowMenu";
import { GAME, DENSE_META, DENSE_MICRO, isFlagged } from "@/components/admin/RegistrationWorkspaceParts";

export type MemberAction = "change-role" | "replace" | "remove";

const ROLES = [
  { role: "首发" as const, limit: GAME.roster.starters, label: "首发" },
  { role: "替补" as const, limit: GAME.roster.maxSubstitutes, label: "替补" },
  { role: "教练" as const, limit: GAME.roster.maxCoaches, label: "教练" },
];

export default function TeamRosterModal({
  team,
  members,
  canAssign,
  onClose,
  onMemberAction,
  onAssign,
}: {
  team: RegistrationTeam;
  members: RegistrationPlayer[];
  /** 是否允许「指派空位」（报名中 + 申报未截止 + 有未组队选手） */
  canAssign: boolean;
  onClose: () => void;
  onMemberAction: (player: RegistrationPlayer, action: MemberAction) => void;
  onAssign: (role: "首发" | "替补" | "教练") => void;
}) {
  return (
    <AdminModal
      title={`队员管理 · ${team.name}`}
      subtitle={`${members.length} 人 · 首发 ${members.filter((p) => p.role === "首发").length}/${GAME.roster.starters}`}
      width="lg"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className="adm-btn adm-btn--secondary adm-btn--md">
          关闭
        </button>
      }
    >
      <div className="grid grid-cols-[2.6rem_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_2.2rem] gap-x-3 border-b border-[var(--adm-line)] pb-2">
        {["角色", "游戏 ID", "姓名", "学号", ""].map((label, i) => (
          <span key={i} className={`${DENSE_MICRO} font-bold text-[var(--adm-text-mute)]`}>
            {label}
          </span>
        ))}
      </div>

      {ROLES.flatMap(({ role, limit }) => {
        const roleMembers = members.filter((player) => player.role === role);
        // 数据异常（超出上限）时也要渲染，否则"看不见也就删不掉"
        const slots = Math.max(limit, roleMembers.length);
        return Array.from({ length: slots }, (_, index) => {
          const player = roleMembers[index];
          if (!player) {
            return (
              <div
                key={`${role}-${index}`}
                className={`grid grid-cols-[2.6rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-[var(--adm-line-soft)] py-2 ${DENSE_META}`}
              >
                <span className="font-bold text-[var(--adm-text-mute)]">{role}</span>
                <span className="text-[var(--adm-text-mute)]">{role === "首发" ? `首发 ${index + 1} 空缺` : `${role}空缺`}</span>
                <button
                  type="button"
                  onClick={() => onAssign(role)}
                  disabled={!canAssign}
                  className={`${DENSE_MICRO} font-bold text-[var(--adm-red-text)] enabled:hover:underline disabled:cursor-default disabled:text-[var(--adm-text-mute)]`}
                >
                  指派
                </button>
              </div>
            );
          }
          const isCaptain = team.captainId === player.id;
          const items: Array<{ text: string; onSelect: () => void; tone?: string }> = [];
          if (team.status === "报名中") items.push({ text: "改角色", onSelect: () => onMemberAction(player, "change-role") });
          if (team.status !== "已退赛") items.push({ text: "换人", onSelect: () => onMemberAction(player, "replace") });
          if (team.status === "报名中") items.push({ text: "移出", onSelect: () => onMemberAction(player, "remove"), tone: "text-[var(--adm-red-text)]" });
          return (
            <div
              key={player.id}
              className={`grid grid-cols-[2.6rem_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_2.2rem] items-center gap-x-3 border-b border-[var(--adm-line-soft)] py-2 ${DENSE_META} ${
                isFlagged(player.reviewStatus) ? "text-[var(--adm-warn-text)]" : ""
              }`}
            >
              <span className="font-bold text-[var(--adm-text-mute)]">{role}</span>
              <span className="truncate font-bold text-[var(--adm-text)]">
                {player.gameId}
                {isCaptain && <span className="ml-1 font-normal text-[var(--adm-text-mute)]">队长</span>}
              </span>
              <span className="truncate">{player.name ?? "—"}</span>
              <span className="truncate tabular-nums">{player.studentId ?? "—"}</span>
              <AdminOverflowMenu size="compact" label={`${player.gameId} 的成员操作`} items={items} />
            </div>
          );
        });
      })}
    </AdminModal>
  );
}
