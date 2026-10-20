// =====================
// 守卫公共骨架（2026-10-20，`26-守卫与巡检梳理` 的第一刀）
//
// 背景：arch / ui / color 三条源码守卫各自抄了一份 walk()、check()、基线的「读-比-写」，
// 358 行里约 70 行是重复脚手架 —— 同一份逻辑三处维护，改一处忘两处就会静默放行。
//
// 这里只抽**已经重复三遍的东西**，不抽判据：
//   · walkSources   遍历源码目录
//   · createReport  ✓/✗ 输出与「通过 N / M」收尾
//   · writeBaseline / readBaseline  基线的唯一读写入口
//   · diffByKey     基线与现状的 added/removed 对比
//   · readPalette   从 globals.css 的 `--token: #hex` 现算色板
//
// 纪律（写进本文件注释，防止下次又长回去）：
//   1. 守卫文件里**不允许**再出现 `writeFileSync(BASELINE…)` —— 基线只能经 writeBaseline 写；
//   2. **不允许**再自己实现 walk() / 结果计数 / diff —— 用这里导出的；
//   3. 判据（阈值、正则、目录白名单）留在各守卫自己文件里，那才是每条守卫的"知识"。
// =====================

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const ROOT = process.cwd();

/** 相对仓库根的 POSIX 风格路径（Windows 的反斜杠统一成正斜杠，输出才稳定） */
export const relPath = (file: string): string => relative(ROOT, file).replace(/\\/g, "/");

/** 测试文件不参与守卫扫描（它们本身就是断言） */
export const isTestFile = (file: string): boolean => /\.test\.(ts|tsx)$/.test(file);

/**
 * 遍历目录收集源码文件。
 * @param dir 绝对或相对于 ROOT 的目录
 * @param ext 扩展名正则，例如 /\.(ts|tsx)$/ 或 /\.(ts|tsx|css)$/
 * 自动跳过 node_modules 与所有以 . 开头的目录/文件（.next / .workbuddy / .git …）。
 */
export function walkSources(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  const full = dir.startsWith(ROOT) ? dir : join(ROOT, dir);
  if (!existsSync(full)) return out;
  for (const name of readdirSync(full)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const child = join(full, name);
    if (statSync(child).isDirectory()) out.push(...walkSources(child, ext));
    else if (ext.test(name)) out.push(child);
  }
  return out;
}

export interface Report {
  /** 一条检查：名字 + 是否通过 + 失败时的补充说明（缩进由调用方给） */
  check: (name: string, ok: boolean, detail?: string) => void;
  /** 当前失败数（个别守卫要在收尾提示里带上数字） */
  failCount: () => number;
  /** 收尾：打印「结果：通过 N / M」；有失败则打印提示并 exit 1 */
  finish: (failHint?: string) => void;
}

/** ✓/✗ 输出与计数。三条守卫的输出格式靠它统一。 */
export function createReport(): Report {
  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean, detail = ""): void => {
    if (ok) {
      pass += 1;
      console.log(`  ✓ ${name}`);
    } else {
      fail += 1;
      console.log(`  ✗ ${name}${detail ? `\n${detail}` : ""}`);
    }
  };
  const finish = (failHint = ""): void => {
    console.log("");
    console.log(`结果：通过 ${pass} / ${pass + fail}`);
    if (fail > 0) {
      if (failHint) console.error(failHint);
      process.exit(1);
    }
  };
  return { check, failCount: () => fail, finish };
}

/** 写基线：整个仓库**唯一**允许写基线文件的地方 */
export function writeBaseline(file: string, value: unknown): void {
  writeFileSync(file.startsWith(ROOT) ? file : join(ROOT, file), JSON.stringify(value, null, 2) + "\n", "utf8");
}

/** 读基线：缺失时给出「先跑 --write-baseline」的明确指令并退出 */
export function readBaseline<T>(file: string, writeHint: string): T {
  const full = file.startsWith(ROOT) ? file : join(ROOT, file);
  if (!existsSync(full)) {
    console.error(`缺少基线文件。先跑：${writeHint}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(full, "utf8")) as T;
}

export interface Diff<T> {
  added: T[];
  removed: T[];
}

/**
 * 基线与现状的差异。
 * key 默认取元素本身；arch 守卫的条目不纯（形如 `path (123 行)`），
 * 所以它传 pathOf 做 key —— **只比路径，不比行数**。
 */
export function diffByKey<T>(now: T[], base: T[], key: (item: T) => string = (item) => String(item)): Diff<T> {
  const baseKeys = new Set(base.map(key));
  const nowKeys = new Set(now.map(key));
  return {
    added: now.filter((item) => !baseKeys.has(key(item))),
    removed: base.filter((item) => !nowKeys.has(key(item))),
  };
}

/**
 * 色板：从 globals.css 里所有 `--token: #hex` 现算。
 * 另外把公开面深色世界用到的少量裸值作为显式补充（BP/裁判端此前直接写在组件里）。
 */
export function readPalette(cssPath: string, extra: string[] = []): Set<string> {
  const css = readFileSync(cssPath.startsWith(ROOT) ? cssPath : join(ROOT, cssPath), "utf8");
  const tokens = [...css.matchAll(/--[a-z0-9-]+\s*:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase());
  return new Set([...tokens, ...extra.map((value) => value.toLowerCase())]);
}
