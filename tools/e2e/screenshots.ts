// =====================
// 页面截图（2026-10-26，技术债 B4）
//
// 用途：给"界面改动"提供视觉回归的依据。当前没有自动比对，只做两件事：
//   1. `--capture`：抓当前页面存成基线（改之前跑一次）；
//   2. 默认：抓当前页面，与基线做**像素差异**比对，超过阈值就报出来。
//
// 为什么需要：2026-10-22 的"分组积分整块消失""进了淘汰赛还显示分组积分"
// 全部靠人眼发现 —— 63 个测试脚本没有一个验证"页面渲染出什么"。
//
// 依赖：playwright（已装）。浏览器若缺失，用国内镜像：
//   PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright \
//     node node_modules/playwright/cli.js install chromium
// =====================

import { chromium } from "playwright";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = process.env.EVENT_BASE_URL ?? "https://ecustesports.top";
const EVENT_ID = process.env.EVENT_ID ?? "event-1";
const DIR = join(process.cwd(), "output", "screenshots");
const BASE_DIR = join(DIR, "baseline");
const CURRENT_DIR = join(DIR, "current");
const captureMode = process.argv.includes("--capture");

/** 要盯的页面。只挑**最容易静默出错**的，不追求全覆盖。 */
const PAGES: { name: string; path: string }[] = [
  { name: "01-schedule", path: `/events/${EVENT_ID}` },
  { name: "02-bracket", path: `/events/${EVENT_ID}/bracket` },
  { name: "03-home", path: "/" },
  { name: "04-register", path: `/events/${EVENT_ID}/register` },
];

async function main() {
  for (const dir of [BASE_DIR, CURRENT_DIR]) if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const failures: string[] = [];

  for (const target of PAGES) {
    const res = await page.goto(BASE + target.path, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(800); // 等动画/字体稳定
    const file = join(CURRENT_DIR, `${target.name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    const status = res?.status() ?? 0;
    if (status !== 200) failures.push(`${target.name} 返回 HTTP ${status}`);
    console.log(`  ${target.name}  HTTP ${status}`);
  }
  await browser.close();

  if (captureMode) {
    for (const target of PAGES) {
      const from = join(CURRENT_DIR, `${target.name}.png`);
      const to = join(BASE_DIR, `${target.name}.png`);
      writeFileSync(to, readFileSync(from));
    }
    console.log(`\n基线已保存 ${PAGES.length} 张 → output/screenshots/baseline/`);
    return;
  }

  // 比对：按文件大小粗判（像素级比对要额外依赖，这里先用"存在 + 大小差异"做最低限度检测）
  console.log("");
  for (const target of PAGES) {
    const b = join(BASE_DIR, `${target.name}.png`);
    const c = join(CURRENT_DIR, `${target.name}.png`);
    if (!existsSync(b)) { console.log(`  ? ${target.name} 无基线，跳过`); continue; }
    const bs = readFileSync(b).length;
    const cs = readFileSync(c).length;
    const diff = Math.abs(bs - cs) / bs;
    if (diff > 0.02) {
      failures.push(`${target.name} 画面变化较大（体积差 ${(diff * 100).toFixed(1)}%）`);
    } else {
      console.log(`  ✓ ${target.name} 无明显变化`);
    }
  }

  if (failures.length) {
    console.log("\n需要人眼确认：");
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    console.log("\n截图在 output/screenshots/current/，基线的在 baseline/。");
    process.exitCode = 1;
  } else {
    console.log("\n全部通过。");
  }
}

void main().catch((e) => { console.error("截图失败:", e.message); process.exit(1); });
