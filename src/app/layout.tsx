import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import "./pub-theme.css";
import AppChrome from "@/components/layout/AppChrome";
import { getPublicSiteConfig } from "@/lib/public-data-cache";

/**
 * 字体改为自托管（2026-10-08）。
 *
 * 原来用 `next/font/google` 的 Geist / Geist_Mono，构建时要去 fonts.googleapis.com
 * 取字体 —— 本机网络到不了那里，`npm run build` 直接挂在
 * `Failed to fetch Geist from Google Fonts.`，等于本地跑不了构建。
 * 改成 `geist` 包（Vercel 官方，`next/font/local` 封装，字体文件随包走），
 * CSS 变量名仍是 `--font-geist-sans` / `--font-geist-mono`，globals.css 不用改。
 * 顺带好处：Vercel 构建也不再依赖 Google 的可用性。
 */
export const revalidate = 5;

export async function generateMetadata(): Promise<Metadata> {
  const config = await getPublicSiteConfig();
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    title: config.seo.title,
    description: config.seo.description,
    openGraph: {
      title: config.seo.title,
      description: config.seo.description,
      type: "website",
      locale: "zh_CN",
      images: [{ url: "/og.png", width: 1731, height: 909, alt: config.brand.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: config.seo.title,
      description: config.seo.description,
      images: ["/og.png"],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const config = await getPublicSiteConfig();
  return (
    <html
      lang="zh-CN"
      data-scroll-behavior="smooth"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppChrome config={config}>{children}</AppChrome>
      </body>
    </html>
  );
}
