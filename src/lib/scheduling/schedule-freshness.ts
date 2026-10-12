// =====================
// 赛程「我看的这份新不新」的判定（纯函数，可测）
//
// 背景（代码审计 A6）：管理端赛程页只在打开时读一次。赛事进行期里，
// 「手里这份是不是最新的」这件事本身就该常驻可见 —— 否则负责人会对着过期赛程
// 反复提交，或者更糟：把裁判刚报的赛果覆盖回去。
//
// 这里只管**判定**，不管取数：给「页面上正在显示的版本」和「刚探测到的远端版本」，
// 回答该不该重取。取数与界面在 `useSchedule` 与赛程页里。
// =====================

/**
 * 后台轮询间隔。
 *
 * 30 秒的依据：要挡住的是「两次改期之间界面没跟上」这类分钟级偏差；
 * 更密只会把接口打热，更疏就失去意义。人为操作仍可立刻点「刷新数据」。
 */
export const SCHEDULE_SYNC_POLL_MS = 30_000;

export type ScheduleSyncDecision = "in-sync" | "reload" | "ignore-older";

/**
 * 决定要不要把远端版本重取进来。
 *
 * `localVersion` 是**页面上正在显示的那份**的版本（`state.version`，可能还含
 * 尚未保存的本地改动），不是「服务端最后确认过的版本」。用后者会把
 * 「本地刚改完、还没存完」误判成「远端有更新」，重取一次就把改动丢了。
 *
 * ★ 为什么必须分出「更旧」这一档，不能只写 `remote !== local`：
 *   轮询与保存会交错。刚保存完的一瞬间，探测可能拿到**保存前**的旧版本
 *   （响应还在路上、或读到了缓存），此时若按「不相等就重取」处理，就会把
 *   刚存好的新赛程用旧版本覆盖回界面 —— 接着下一次探测又发现不一致，
 *   界面开始来回抖。只有「远端**严格更新**」才值得重取。
 *
 *   `"in-sync"` 与 `"ignore-older"` 在界面上都不显示「有更新」，
 *   但分开返回是为了能把这个区别测出来（否则合并成一档，上面那个坑测不到）。
 */
export function decideScheduleSync(localVersion: number, remoteVersion: number): ScheduleSyncDecision {
  if (remoteVersion > localVersion) return "reload";
  if (remoteVersion < localVersion) return "ignore-older";
  return "in-sync";
}

/** 「读取于」行里显示的钟点（HH:MM，本地时区）。没有值时给一个不会误读成 00:00 的占位。 */
export function formatSyncedClock(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return "—";
  const date = new Date(at);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * 「刚刚 / N 分钟前 / N 小时前 / N 天前」——回答「这份数据有多旧」。
 *
 * 时钟回拨或服务器时间略快时会算出负数，一律归到「刚刚」：
 * 显示「-3 分钟前」比不显示更糟。
 */
export function formatSyncedAgo(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return "";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
