"use client";

import { usePathname } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import type { SiteConfig } from "@/lib/site-config-schema";

/**
 * 外壳三件套（站头 / 正文 / 站尾）统一装进 .pub-poster 里：
 * 海报底（径向光晕 + 细网格）由 pub-theme.css 的 ::before/::after 画在这个容器上，
 * 不再是每个页面各自铺一层。容器同时用 flex 撑满 body，站尾照旧贴底。
 */
export default function AppChrome({ children, config }: { children: React.ReactNode; config: SiteConfig }) {
  const pathname = usePathname();
  // 工作台 /admin 与登录页 /login 都脱壳：登录页不需要公开导航
  const isWorkbench = pathname.startsWith("/admin") || pathname.startsWith("/login");

  if (isWorkbench) return children;

  return (
    <div className="pub-poster relative flex flex-1 flex-col">
      <Navbar config={config} />
      <main className="flex-1">{children}</main>
      <Footer config={config} />
    </div>
  );
}
