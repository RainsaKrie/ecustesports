// =====================
// 守卫变异检查（2026-10-18）
// 运行：npm run test:guard-mutation
//
// 存在的理由：今天有 6 次「判据写宽 → 守卫不再守卫」，光记教训没用。
// 这个脚本对**每一条守卫**注入一个违规，确认它真的会红，再还原。
// **不能红的守卫 = 装饰**，会在这一步暴露。
//
// 每条用例都 try/finally 还原，跑完再核对文件是否恢复原样。
// =====================

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const TSX = ["node_modules/tsx/dist/cli.mjs"];

type Case = {
  name: string;
  /** 守卫的 npm script 名 */
  script: string;
  /** 期望的输出片段（确认是"对的那一条"变红，而不是别的） */
  expect: string;
  apply: () => () => void; // 返回还原函数
};

function patchFile(path: string, from: string, to: string): () => void {
  const abs = `${ROOT}/${path}`;
  const original = readFileSync(abs, "utf8");
  if (!original.includes(from)) throw new Error(`[${path}] 找不到注入口：${from.slice(0, 40)}`);
  writeFileSync(abs, original.replace(from, to), "utf8");
  return () => writeFileSync(abs, original, "utf8");
}

const CASES: Case[] = [
  {
    name: "① 行数 >400（arch-guards）",
    script: "test:arch-guards",
    expect: "① 没有新增的「文件 >400 行",
    apply: () => {
      const p = `${ROOT}/src/lib/__mutation_probe.ts`;
      writeFileSync(p, Array.from({ length: 500 }, (_, i) => `// probe ${i}`).join("\n") + "\n", "utf8");
      return () => rmSync(p, { force: true });
    },
  },
  {
    // 2026-10-19 新增：基线内文件只许变短、不许变长
    name: "①b 基线内文件变长（arch-guards）",
    script: "test:arch-guards",
    expect: "①b 已在基线里的超限文件没有继续变长",
    apply: () => patchFile("src/components/admin/FormatDrawWorkspace.tsx", "\"use client\";", "\"use client\";\n// mutation probe"),
  },
  {
    // 2026-10-19 新增：领域层不许直连基础设施
    name: "④ 领域层直连基础设施（arch-guards）",
    script: "test:arch-guards",
    expect: "④ 领域层没有新增的「直连基础设施」",
    apply: () => patchFile("src/lib/domains/content/publication-check.ts", "import", "import { readEventData } from \"@/lib/data-store\";\nimport"),
  },
  {
    // 2026-10-19 新增：领域之间不许互相引用
    name: "⑤ 领域之间互相引用（arch-guards）",
    script: "test:arch-guards",
    expect: "⑤ 领域之间没有新增的互相引用",
    apply: () => patchFile("src/lib/domains/content/publication-check.ts", "import", "import type { ScheduleMatch } from \"@/lib/domains/schedule/schedule-data\";\nimport"),
  },
  {
    name: "② lib 下新增 hooks 导出（arch-guards）",
    script: "test:arch-guards",
    expect: "② src/lib 下没有新增的 hooks 导出",
    apply: () => {
      const p = `${ROOT}/src/lib/__mutation_hook.ts`;
      writeFileSync(p, 'import { useState } from "react";\nexport const useMutationProbe = () => useState(0);\n', "utf8");
      return () => rmSync(p, { force: true });
    },
  },
  {
    name: "③ 界面层直连数据访问（arch-guards）",
    script: "test:arch-guards",
    expect: "③ 界面层没有新增的跨层 import",
    apply: () => {
      const p = `${ROOT}/src/components/__mutation_ui.ts`;
      writeFileSync(p, 'import { readEventData } from "@/lib/data-store";\nexport const x = readEventData;\n', "utf8");
      return () => rmSync(p, { force: true });
    },
  },
  {
    name: "④ 对比度不足（ui-guards）",
    script: "test:ui-guards",
    expect: "所有正文级文字令牌在三种底色上都 ≥4.5:1",
    apply: () => patchFile("src/app/globals.css", "--adm-text: #f2f3f5;", "--adm-text: #3a3a3a;"),
  },
  {
    name: "⑤ Button 焦点轮廓缺失（ui-guards）",
    script: "test:ui-guards",
    expect: "Button 组件带完整的焦点轮廓",
    apply: () => patchFile("src/components/ui/Button.tsx", "focus-visible:outline-2 focus-visible:outline-offset-2", "outline-none"),
  },
  {
    name: "⑥ 过渡动画重排属性（ui-guards）",
    script: "test:ui-guards",
    expect: "没有对 height/width/top/left/margin/padding 做过渡",
    apply: () => {
      const p = `${ROOT}/src/components/__mutation_transition.tsx`;
      writeFileSync(p, 'export const X = () => <div className="transition-[height] duration-200" />;\n', "utf8");
      return () => rmSync(p, { force: true });
    },
  },
  {
    name: "⑦ 新增手写尺寸文件（ui-guards）",
    script: "test:ui-guards",
    expect: "没有新增手写尺寸的文件",
    apply: () => {
      const p = `${ROOT}/src/components/__mutation_size.tsx`;
      writeFileSync(p, 'export const X = () => <div className="p-[13px]" />;\n', "utf8");
      return () => rmSync(p, { force: true });
    },
  },
  {
    name: "⑧ 色板外十六进制（color-guard）",
    script: "test:color-guard",
    expect: "没有新增或加重的「色板外颜色」",
    apply: () => {
      const p = `${ROOT}/src/components/__mutation_hex.tsx`;
      writeFileSync(p, 'export const X = () => <div className="text-[#abcdef]" />;\n', "utf8");
      return () => rmSync(p, { force: true });
    },
  },
  {
    name: "⑨ Tailwind 命名色（color-guard）",
    script: "test:color-guard",
    expect: "命名色（Tailwind 色板）已清零",
    apply: () => {
      const p = `${ROOT}/src/components/__mutation_named.tsx`;
      writeFileSync(p, 'export const X = () => <div className="text-slate-500" />;\n', "utf8");
      return () => rmSync(p, { force: true });
    },
  },
];

/** script 名 → 直接的测试文件（不走 npm：会多一层 shell，也抓不到输出） */
const FILES: Record<string, string> = {
  "test:arch-guards": "tools/arch/arch-guards.test.ts",
  "test:ui-guards": "tools/ui/ui-guards.test.ts",
  "test:color-guard": "tools/ui/color-guard.test.ts",
};

function run(script: string): { code: number; out: string } {
  const file = FILES[script];
  if (!file) return { code: 1, out: `未知的守卫脚本：${script}` };
  try {
    const out = execFileSync(process.execPath, [...TSX, file], {
      cwd: ROOT, encoding: "utf8", stdio: "pipe", maxBuffer: 20 * 1024 * 1024,
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

let ok = 0;
let bad = 0;
console.log("守卫变异检查：逐条注入违规，确认对应守卫会红\n");
for (const c of CASES) {
  let restore: (() => void) | null = null;
  try {
    restore = c.apply();
    const r = run(c.script);
    const hit = r.out.includes(c.expect);
    const red = r.code !== 0;
    if (hit && red) { ok++; console.log(`  ✓ ${c.name}`); }
    else {
      bad++;
      console.log(`  ✗ ${c.name} —— ${!red ? "注入违规后**没有变红**" : `变红了但报的不是这一条（找不到「${c.expect}」）`}`);
    }
  } catch (e) {
    bad++;
    console.log(`  ✗ ${c.name} —— 注入失败：${(e as Error).message}`);
  } finally {
    if (restore) restore();
  }
}

// 还原后必须全绿；否则说明注入没清理干净
console.log("");
const after = ["test:arch-guards", "test:ui-guards", "test:color-guard"].map((s) => ({ s, r: run(s) }));
const allGreen = after.every((x) => x.r.code === 0);
console.log(allGreen ? "  ✓ 还原后三条守卫全部恢复正常" : `  ✗ 还原后仍有守卫为红：${after.filter((x) => x.r.code !== 0).map((x) => x.s).join("、")}`);
if (!allGreen) bad++;

console.log("");
console.log(`结果：${ok} 条会红 / ${bad} 条有问题（共 ${CASES.length} 条用例）`);
if (bad > 0) process.exit(1);
