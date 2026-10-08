import { ReactNode } from "react";
import { AdminOverflowMenu, type AdminMenuItem } from "@/components/admin/ui";

interface AdminPageHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  status?: string;
  /** 本区主要动作。一个按钮区最多一个主按钮，其余进 overflow。 */
  actions?: ReactNode;
  /** 低频动作。渲染成最右侧的「⋯」，与 actions 之间有一条竖分隔线。 */
  overflow?: AdminMenuItem[];
}

export default function AdminPageHeader({ eyebrow, title, description, status, actions, overflow }: AdminPageHeaderProps) {
  const hasOverflow = Boolean(overflow && overflow.length > 0);
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-5 border-b border-[var(--adm-line)] pb-6">
      <div className="max-w-3xl">
        <div className="mb-2 flex items-center gap-2 text-[length:var(--adm-fs-xs)] font-medium tracking-[0.16em] text-[var(--adm-red-text)]">
          <span className="h-px w-7 bg-[var(--adm-red)]" /> {eyebrow}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[length:var(--adm-fs-xl)] font-bold tracking-[-0.04em] text-[var(--adm-text)]">{title}</h1>
          {status && (
            <span className="adm-chip" data-dot="off">{status}</span>
          )}
        </div>
        {description && <p className="mt-3 text-[length:var(--adm-fs-md)] leading-[1.6] text-[var(--adm-text-soft)]">{description}</p>}
      </div>
      {(actions || hasOverflow) && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {hasOverflow && (
            <>
              {actions && <span aria-hidden className="mx-1 h-6 w-px bg-[var(--adm-line)]" />}
              <AdminOverflowMenu label="更多操作" items={overflow!} />
            </>
          )}
        </div>
      )}
    </header>
  );
}
