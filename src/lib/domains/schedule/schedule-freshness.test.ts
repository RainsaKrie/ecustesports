// =====================
// 赛程新鲜度判定的守卫测试（2026-10-12）
// 运行：npm run test:schedule-freshness
//
// 这些函数只有几行，但每一行都对应一个会咬人的分支：
//   · 只写 `remote !== local` → 刚保存完就被旧响应覆盖回界面，来回抖
//   · 把「更旧」也当成「要重取」→ 同一个后果，且更隐蔽（要看响应时序）
//   · 「多久之前」的每一档都要枚举 —— 分档写错不会报错，只会长期显示错的旧度
//
// 所以这里把三种版本关系、以及「多久之前」的每一档全部枚举。
// =====================

import {
  SCHEDULE_SYNC_POLL_MS,
  decideScheduleSync,
  formatSyncedAgo,
  formatSyncedClock,
} from "./schedule-freshness.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`); }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

console.log("== 组1 · 版本关系的三种取值都要枚举 ==");

check("远端更新 → 重取", decideScheduleSync(3, 4) === "reload");
check("远端相同 → 不动", decideScheduleSync(4, 4) === "in-sync");
check(
  "远端更旧 → 不重取（这一档就是防「刚保存完被旧响应覆盖」）",
  decideScheduleSync(4, 3) === "ignore-older",
  `实际 ${decideScheduleSync(4, 3)}`,
);
check("版本 0 起步也成立", decideScheduleSync(0, 1) === "reload" && decideScheduleSync(0, 0) === "in-sync");

// 护栏：重取之后本地就等于远端，此时不能再判「要重取」，否则会变成死循环轮询。
check(
  "重取完成后不再触发重取（不会形成轮询风暴）",
  decideScheduleSync(7, 7) === "in-sync",
);

console.log("\n== 组2 · 「数据时间」的钟点格式 ==");

check("没有取值时给占位而不是 00:00", formatSyncedClock(0) === "—", formatSyncedClock(0));
check("非法值也给占位", formatSyncedClock(Number.NaN) === "—");
{
  // 用同一个 Date 自比，避开时区差异（本机时区与 CI 可能不同）
  const probe = new Date(2026, 9, 12, 9, 4, 5).getTime();
  const expected = `${String(new Date(probe).getHours()).padStart(2, "0")}:${String(new Date(probe).getMinutes()).padStart(2, "0")}`;
  check("按本地时区输出 HH:MM（个位数补零）", formatSyncedClock(probe) === expected, `${formatSyncedClock(probe)} vs ${expected}`);
  check("格式一定是 5 个字符", formatSyncedClock(probe).length === 5, formatSyncedClock(probe));
}

console.log("\n== 组3 · 「多久之前」的每一档都要枚举 ==");

{
  const now = 1_800_000_000_000;

  check("没有取值时不出文案", formatSyncedAgo(0, now) === "");
  check("负数（时钟回拨）归到「刚刚」", formatSyncedAgo(now + 5 * MINUTE, now) === "刚刚");
  check("0 秒 → 刚刚", formatSyncedAgo(now, now) === "刚刚");
  check("59 秒 → 刚刚", formatSyncedAgo(now - 59_000, now) === "刚刚");
  check("60 秒 → 1 分钟前", formatSyncedAgo(now - MINUTE, now) === "1 分钟前");
  check("59 分钟 → 59 分钟前", formatSyncedAgo(now - 59 * MINUTE, now) === "59 分钟前");
  check("60 分钟 → 1 小时前（不该停在 60 分钟）", formatSyncedAgo(now - HOUR, now) === "1 小时前");
  check("23 小时 → 23 小时前", formatSyncedAgo(now - 23 * HOUR, now) === "23 小时前");
  check("24 小时 → 1 天前", formatSyncedAgo(now - 24 * HOUR, now) === "1 天前");
  check("50 小时 → 2 天前", formatSyncedAgo(now - 50 * HOUR, now) === "2 天前");

  // 单调性：时间越久，文案不能变得「更新」——分档写反可以用这一条兜住
  const series = [0, 30_000, MINUTE, 30 * MINUTE, HOUR, 5 * HOUR, 24 * HOUR, 72 * HOUR];
  const order = ["刚刚", "分钟前", "小时前", "天前"];
  const rankOf = (text: string) => order.findIndex((unit) => text.includes(unit));
  const ranks = series.map((age) => rankOf(formatSyncedAgo(now - age, now)));
  check(
    "旧度随时间单调不减（分档没写反）",
    ranks.every((r, i) => i === 0 || r >= ranks[i - 1]),
    `${series.join("/")} → ${ranks.join("/")}`,
  );
}

console.log("\n== 组4 · 轮询间隔的取值要合理 ==");

check("轮询间隔是正数", SCHEDULE_SYNC_POLL_MS > 0);
check(
  "轮询间隔在 10 秒～2 分钟之间（更密会把接口打热，更疏就失去意义）",
  SCHEDULE_SYNC_POLL_MS >= 10_000 && SCHEDULE_SYNC_POLL_MS <= 120_000,
  String(SCHEDULE_SYNC_POLL_MS),
);

console.log(`\n${pass} 通过 / ${fail} 未通过`);
if (fail > 0) process.exitCode = 1;
