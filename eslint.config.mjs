import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-build/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 本地工作目录与生成物：已被 .gitignore 忽略，不应参与 lint，
    // 否则本地脚本和验收产物会污染「本地 = CI」的同一条门禁。
    ".workbuddy/**",
    ".playwright-cli/**",
    "output/**",
    "tmp/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
