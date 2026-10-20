"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SiteConfig } from "@/lib/site-config-schema";

export default function Navbar({ config }: { config: SiteConfig }) {
  const pathname = usePathname();
  const navItems = [
    { label: config.navigation.home, href: "/" },
    { label: config.navigation.events, href: "/events" },
    { label: config.navigation.community, href: "/contact" },
    { label: config.navigation.news, href: "/news" },
    { label: config.navigation.bp, href: "/bp" },
  ];

  // 首页只认精确匹配，其余按前缀算（/events/xxx 也算「赛事」）。
  // 红下划线样式的开关就是 aria-current —— 不另加 class。
  const isCurrent = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="site-brand" aria-label={`${config.brand.name}首页`}>
          {/* 2026-10-20 负责人要求：站头换成瓦友社 logo（社团标识；场地标识的 ECUST 约束不受影响） */}
          <img src="/brand-wa.png" alt="" aria-hidden="true" className="brand-logo mr-3" width={40} height={34} />
          <span className="site-brand__text">
            <strong>{config.brand.name}</strong>
            <small>{config.brand.englishName}</small>
          </span>
        </Link>

        <nav className="site-nav" aria-label="主导航">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link href="/admin" className="site-header__admin" aria-label={config.navigation.admin}>
          {config.navigation.admin}
        </Link>

        <details className="mobile-nav">
          <summary aria-label="打开导航菜单">
            <span className="mobile-nav__icon" aria-hidden><i /><i /><i /></span>
          </summary>
          <nav className="mobile-nav__menu" aria-label="移动端导航">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isCurrent(item.href) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </details>
      </div>
    </header>
  );
}
