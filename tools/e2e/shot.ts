import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://localhost:3124/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("h1", { timeout: 20000 });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: "output/tags-check.png" });
  await browser.close();
  console.log("已截图 output/tags-check.png");
}

void main().catch((error) => {
  console.error("失败:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
