"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AdminTopbar() {
  const router = useRouter();

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-800 bg-[#101820] px-4 text-white sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <Link href="/admin" className="flex items-center gap-3 font-black">
          <span className="grid h-8 w-8 place-items-center bg-[#ff4655] font-mono text-[0.625rem]">SC</span>
          <span className="hidden sm:inline">赛事运营工作台</span>
        </Link>
      </div>
      <nav className="flex items-center gap-3 text-xs font-bold sm:gap-4" aria-label="工作台全局导航">
        <Link href="/admin" className="text-slate-200 hover:text-white">全部赛事</Link>
        <Link href="/admin/site-content" className="text-slate-400 hover:text-white">官网内容</Link>
        <Link href="/" className="text-slate-400 hover:text-white">返回官网</Link>
        <button
          type="button"
          onClick={async () => {
            await fetch("/api/admin/logout", { method: "POST" });
            router.push("/login");
            router.refresh();
          }}
          className="text-slate-400 hover:text-white"
        >
          退出
        </button>
      </nav>
    </header>
  );
}
