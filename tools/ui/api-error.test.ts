// API 统一异常出口的行为测试（2026-10-21）
import { withApiError } from "../../src/lib/api-error";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? "：" + detail : ""}`); }
}

async function run() {
  console.log("API 统一异常出口");

  // ① 正常返回应原样透传（状态码与正文都不被改写）
  const okHandler = withApiError(async () => Response.json({ hello: "world" }, { status: 201 })) as () => Promise<Response>;
  const okRes = await okHandler();
  check("正常响应状态码透传", okRes.status === 201, String(okRes.status));
  check("正常响应正文透传", (await okRes.json()).hello === "world");

  // ② 抛异常应转成 JSON 500，且不泄露内部信息
  const boom = withApiError(async () => { throw new Error("数据库连接失败: 10.0.0.5:5432"); }) as () => Promise<Response>;
  const errRes = await boom();
  check("异常转成 500", errRes.status === 500, String(errRes.status));
  check("异常响应是 JSON 而不是 HTML",
    (errRes.headers.get("content-type") ?? "").includes("application/json"));
  const body = await errRes.json() as { ok?: boolean; message?: string };
  check("错误形状统一为 { ok:false }", body.ok === false);
  check("不把内部错误信息返回给客户端",
    !String(body.message).includes("10.0.0.5") && !String(body.message).includes("数据库"));

  // ③ 非 Error 类型的抛出（字符串）也要接住
  const strBoom = withApiError(async () => { throw "意外字符串"; }) as () => Promise<Response>;
  const strRes = await strBoom();
  check("非 Error 抛出也被接住", strRes.status === 500, String(strRes.status));

  console.log(`\n结果：通过 ${passed} / ${failed + passed}`);
  if (failed > 0) process.exit(1);
}

void run();
