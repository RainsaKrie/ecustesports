"use client";

import { useState } from "react";

/**
 * 赛事群公告。玩家侧多处复用：报名表单 / 报名成功 / 找回参赛信息 / 赛事详情。
 *
 * 为什么要多放几处：玩家可能从不同路径走到「该加群了」这一刻。
 * 漏掉群公告的代价不是少看一条通知，而是**错过自己的比赛时间**
 * ——赛程、分组、改期与开赛提醒都在群里发布。
 *
 * 群号为空时**由调用方决定不渲染**（`event.eventQqGroup && <GroupNotice .../>`），
 * 这样不会出现一个空公告块。本组件自身不处理空值。
 */
export default function GroupNotice({ group, compact = false }: { group: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  function copy() {
    // 手机上从网页里选中一串数字再复制很别扭，给个一键复制。
    // 剪贴板 API 在非安全上下文会被拒，此时提示「请手动记下」而不是静默无反应
    // ——否则玩家以为复制成功了。
    navigator.clipboard.writeText(group)
      .then(() => setCopied(true))
      .catch(() => setFailed(true));
  }

  return (
    <div className={`border border-[#ff4655]/35 bg-[#fff1f2] ${compact ? "p-4" : "p-4 sm:p-5"}`}>
      <p className="text-sm font-black text-[#171a1f]">请加入赛事 QQ 群</p>
      <p className="mt-1 text-xs font-medium leading-5 text-slate-600">
        赛程、分组、改期与开赛提醒都在群内发布。
        <span className="font-bold text-[#c83242]">未进群可能错过自己的比赛时间。</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="font-mono text-xl font-black tracking-wider text-[#c83242]">{group}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-11 items-center border border-[#ff4655] bg-white px-4 text-xs font-black text-[#c83242] transition hover:bg-[#ff4655] hover:text-white"
        >
          {copied ? "已复制" : failed ? "请手动记下" : "复制群号"}
        </button>
      </div>
    </div>
  );
}
