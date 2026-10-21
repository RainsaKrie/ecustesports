// =====================
// API 路由的统一异常出口（2026-10-21，审计 P1）
//
// 问题：35 个 route.ts 里 12 个没有 try/catch，其中包含 referee/submit（提交赛果）、
// upload、claim 等核心写操作。领域函数遇到数据库不可达等非业务异常会抛出，
// 冒到 Next 运行时会返回 **HTML 格式的 500** —— 而前端拿到响应第一件事就是 .json()，
// 对 HTML 解析会再抛一次，界面上看到的是"未知错误"甚至白屏。
//
// 这个包装器做三件事：
//   ① 把任何未捕获异常转成 JSON（4xx/5xx）；
//   ② 统一错误形状为 { ok: false, message }，客户端可以统一处理；
//   ③ 服务端记一条日志（客户端只看到通用文案，不泄露内部信息）。
//
// 用法：
//   export const POST = withApiError(async (request) => { ... });
// 注意：路由自己 return 的 Response 原样透传，不覆盖它的状态码与正文。
// =====================

type RouteHandler = (...args: never[]) => Promise<Response>;

export function withApiError<H extends RouteHandler>(handler: H): H {
  const wrapped = async (...args: never[]) => {
    try {
      return await handler(...args);
    } catch (error) {
      // 服务端留痕：类型 + 消息，不打完整堆栈（避免日志里出现用户数据）
      const name = error instanceof Error ? error.name : typeof error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[api] 未捕获异常 ${name}: ${message}`);
      return Response.json(
        { ok: false, message: "服务暂时不可用，请稍后重试" },
        { status: 500 },
      );
    }
  };
  return wrapped as H;
}
