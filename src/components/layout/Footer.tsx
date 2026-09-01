import Link from "next/link";
import Container from "./Container";
import type { SiteConfig } from "@/lib/site-config-schema";

export default function Footer({ config }: { config: SiteConfig }) {
  return (
    <footer className="site-footer">
      <Container className="site-footer__inner">
        <div className="site-footer__brand">
          <span className="brand-mark" aria-hidden="true">{config.brand.mark}</span>
          <div>
            <strong>{config.brand.name}</strong>
          </div>
        </div>
        <div>
          <p className="site-footer__label">NAVIGATION / 导航</p>
          <div className="site-footer__links">
            <Link href="/events">{config.navigation.events}</Link>
            <Link href="/news">公告</Link>
            <Link href="/contact">社群</Link>
            <Link href="/bp">{config.navigation.bp}</Link>
            <Link href="/admin">{config.navigation.admin}</Link>
          </div>
        </div>
        <div className="site-footer__meta">
          <p className="site-footer__label">SYSTEM / 状态</p>
          <p>{config.brand.footerStatus}<br />{config.brand.copyright}</p>
        </div>
      </Container>
    </footer>
  );
}
