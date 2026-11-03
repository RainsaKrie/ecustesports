// =====================
// 当前该做什么（2026-11-03）
//
// 一句话，常显在赛事工作台主区顶部。目的不是催办，而是让接手的人一眼知道
// 「现在处在哪、下一步点哪里」——负责人自己清楚流程，这份提示是给交接用的。
//
// 刻意做得很轻：一行小字、无卡片无底色、不用强调色，不跟页面内容抢注意力。
// 判定链在 layout 里算（那边已经拿到阶段、待批改期与赛程），这里只负责呈现。
// =====================

import Link from "next/link";

export function NextActionLine({
  label,
  href,
}: {
  label: string;
  /** 有去处就渲染成链接，没有就只是陈述（例如「赛事已结束」） */
  href?: string;
}) {
  return (
    <p className="mb-4 text-[length:var(--adm-fs-sm)] text-[var(--adm-text-mute)]">
      {href ? (
        <Link href={href} className="underline decoration-[var(--adm-line)] underline-offset-2 hover:text-[var(--adm-text)]">
          {label}
        </Link>
      ) : (
        label
      )}
    </p>
  );
}
