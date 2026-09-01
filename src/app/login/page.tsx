"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        let message = "密码错误，请重试";
        if (res.status === 403) {
          message = "请求来源不被允许。请用不带 www 的地址 ecustesports.top 登录。";
        } else if (res.status === 429) {
          message = "登录尝试过于频繁，请稍后再试。";
        } else if (res.status >= 500) {
          message = "服务端暂时不可用，请稍后再试。";
        } else {
          try {
            const data = await res.json() as { message?: string };
            if (data?.message) message = data.message;
          } catch { /* 忽略非 JSON 响应 */ }
        }
        setError(message);
        setLoading(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") || "/admin";
      window.location.href = next;
    } catch {
      setError("登录失败，请重试");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-[#0f1721] px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-12 w-14 place-items-center bg-[#ff4655] font-mono text-sm font-black text-white [clip-path:polygon(0_0,100%_0,100%_72%,72%_100%,0_100%)]">
            ECUST
          </div>
          <h1 className="text-2xl font-black text-white">工作台登录</h1>
          <p className="mt-2 text-sm text-white/50">华东理工大学电竞部 · 工作人员入口</p>
        </div>

        <form onSubmit={handleSubmit} className="border border-white/10 bg-white/[0.03] p-6">
          <label htmlFor="password" className="mb-2 block text-sm font-bold text-white/80">
            管理员密码
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            placeholder="请输入密码"
            className="w-full border border-white/15 bg-transparent px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#ff4655]"
          />
          {error && <p className="mt-3 text-sm text-[#ff6572]">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="mt-5 w-full bg-[#ff4655] py-3 text-sm font-black text-white transition hover:bg-[#d83b48] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "登录中…" : "进入工作台"}
          </button>
        </form>
      </div>
    </div>
  );
}
