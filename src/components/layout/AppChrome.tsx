"use client";

import { usePathname } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import type { SiteConfig } from "@/lib/site-config-schema";

export default function AppChrome({ children, config }: { children: React.ReactNode; config: SiteConfig }) {
  const pathname = usePathname();
  const isWorkbench = pathname.startsWith("/admin");

  if (isWorkbench) return children;

  return (
    <>
      <Navbar config={config} />
      <main className="flex-1">{children}</main>
      <Footer config={config} />
    </>
  );
}
