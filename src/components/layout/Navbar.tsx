import Link from "next/link";
import type { SiteConfig } from "@/lib/site-config-schema";

export default function Navbar({ config }: { config: SiteConfig }) {
  const navItems = [
    { label: config.navigation.home, href: "/" },
    { label: config.navigation.events, href: "/events" },
    { label: config.navigation.community, href: "/community" },
    { label: config.navigation.news, href: "/news" },
    { label: config.navigation.bp, href: "/bp" },
  ];
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="site-brand" aria-label={`${config.brand.name}首页`}>
          <span className="site-brand__text">
            <strong>{config.brand.name}</strong>
            <small>{config.brand.englishName}</small>
          </span>
        </Link>

        <nav className="site-nav" aria-label="主导航">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>{item.label}</Link>
          ))}
        </nav>

        <Link href="/admin" className="site-header__admin" aria-label={config.navigation.admin}>
          {config.navigation.admin}
        </Link>

        <details className="mobile-nav">
          <summary aria-label="打开导航菜单">MENU</summary>
          <nav className="mobile-nav__menu" aria-label="移动端导航">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>{item.label}</Link>
            ))}
          </nav>
        </details>
      </div>
    </header>
  );
}
