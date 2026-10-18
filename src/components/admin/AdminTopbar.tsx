"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AdminTopbar() {
  const router = useRouter();

  // h-16 是 rem，桌面根字号 150% 下 = 96px（实测），移动端 64px —— 同一个顶栏差 32px。
  // 改 px 定值后两边一致。导航项改用 `h-full`：可点区从 20px（只有文字高）撑到整条
  // 顶栏 64px，手机上是 3 倍差距。
  return (
    <header className="sticky top-0 z-40 flex h-[64px] items-center justify-between border-b border-[var(--ink-soft)] bg-[var(--ink)] px-4 text-white sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <Link href="/admin" className="flex items-center gap-3 font-semibold">
          <span className="grid h-8 w-8 place-items-center bg-[var(--adm-red)] font-mono text-[length:var(--adm-fs-xs)]">SC</span>
          <span className="hidden sm:inline">赛事运营工作台</span>
        </Link>
      </div>
      <nav className="flex h-full items-center gap-3 text-[length:var(--adm-fs-sm)] font-bold sm:gap-4" aria-label="工作台全局导航">
        <Link href="/admin" className="inline-flex h-full items-center text-[#d8dde4] hover:text-white">全部赛事</Link>
        <Link href="/admin/site-content" className="inline-flex h-full items-center text-[#8b929c] hover:text-white">官网内容</Link>
        <Link href="/" className="inline-flex h-full items-center text-[#8b929c] hover:text-white">返回官网</Link>
        <button
          type="button"
          onClick={async () => {
            await fetch("/api/admin/logout", { method: "POST" });
            router.push("/login");
            router.refresh();
          }}
          className="inline-flex h-full items-center text-[#8b929c] hover:text-white"
        >
          退出
        </button>
      </nav>
    </header>
  );
}
