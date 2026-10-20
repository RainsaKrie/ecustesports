"use client";

import { useState } from "react";

/**
 * 工作台登录（2026-10-20 按 v8 基准改版）
 * 登录页是脱壳的（AppChrome 不对 /login 渲染公开导航），所以这里自己给完整的首屏。
 */
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
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-[380px]">
        <header>
          <span className="brand-mark" aria-hidden="true">ECUST</span>
          <p className="ui-eyebrow mt-6">STAFF ACCESS</p>
          <h1 className="mt-2 text-[clamp(28px,4vw,40px)] font-black leading-[1.05] tracking-[-0.03em] text-[var(--pub-txt)]">
            工作台登录<em className="not-italic text-[var(--pub-red)]">.</em>
          </h1>
          <p className="mt-2 text-[13px] text-[var(--pub-txt-soft)]">华东理工大学电竞部 · 工作人员入口</p>
        </header>

        <form onSubmit={handleSubmit} className="ui-frame ui-pad mt-7">
          <label htmlFor="password" className="mb-2 block text-[12px] font-bold text-[var(--pub-txt-soft)]">
            管理员密码
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            placeholder="请输入密码"
            className="h-[44px] w-full border border-[var(--pub-line-soft)] bg-white/[0.04] px-3 text-[14px] text-[var(--pub-txt)] outline-none placeholder:text-[var(--pub-txt-mute)] focus:border-[var(--pub-red)] focus:ring-2 focus:ring-[var(--pub-red)]"
          />
          {error && (
            <p className="mt-3 border-l-2 border-l-[var(--pub-red)] pl-2 text-[13px] font-bold text-[var(--pub-red)]">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="mt-5 h-[48px] w-full bg-[#ff4655] text-[14px] font-black text-white transition-colors hover:bg-[#d83b48] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "登录中…" : "进入工作台"}
          </button>
        </form>
      </div>
    </div>
  );
}
