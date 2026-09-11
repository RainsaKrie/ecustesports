import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifyBackup } from "./backup-format";

/**
 * 只读校验一份已导出的备份文件（SYS-02 §4/§5）。
 *
 * 用法：tsx tools/gate6/backup-verify.ts <备份文件路径>
 *
 * 这个工具只读本地文件：不连接网络、不读环境变量、不写任何数据。
 * 任何一次校验都不会改动生产库，因此可以在赛事期随时执行。
 */
async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("请提供备份文件路径：tsx tools/gate6/backup-verify.ts <备份文件>");
  }

  const resolved = path.resolve(inputPath);
  const insideRepository = resolved.startsWith(`${path.resolve(process.cwd())}${path.sep}`);

  let raw: string;
  try {
    raw = await readFile(resolved, "utf8");
  } catch {
    throw new Error(`读取备份文件失败：${resolved}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("备份文件不是合法 JSON");
  }

  const result = verifyBackup(parsed);
  const report = {
    verifiedAt: new Date().toISOString(),
    file: resolved,
    insideRepository,
    bytes: Buffer.byteLength(raw),
    ...result,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (insideRepository) {
    process.stdout.write("提醒：该备份文件位于项目仓库内，请移到仓库外，避免被提交。\n");
  }
  if (!result.ok) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "备份校验失败");
  process.exitCode = 1;
});
