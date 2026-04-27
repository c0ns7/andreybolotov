import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import AbRouteHtmlClasses from "../components/ab/AbRouteHtmlClasses";
import { AbSessionProvider } from "../components/ab/AbSessionContext";
import AbToastHost from "../components/ab/AbToastHost";

export const metadata: Metadata = {
  metadataBase: new URL("https://andreybolotov.ru"),
  title: {
    default: "andreybolotov.ru — Акции и личный кабинет",
    template: "%s | andreybolotov.ru",
  },
  description:
    "Участие в акциях на andreybolotov.ru: выбор номерков, оплата, история участия, уведомления и поддержка.",
  keywords: [
    "andreybolotov.ru",
    "акции",
    "номерки",
    "участие в акции",
    "личный кабинет",
    "онлайн акции",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "andreybolotov.ru",
    locale: "ru_RU",
    title: "andreybolotov.ru — Акции и личный кабинет",
    description:
      "Онлайн-платформа для участия в акциях: номерки, история участия, чат с поддержкой и личный кабинет.",
    images: [
      {
        url: "/og-cover.svg",
        width: 1200,
        height: 630,
        alt: "andreybolotov.ru",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "andreybolotov.ru — Акции и личный кабинет",
    description:
      "Удобный личный кабинет для участия в акциях: номерки, история, оплата и поддержка.",
    images: ["/og-cover.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/logo-ab.svg", type: "image/svg+xml" }],
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <Script id="ab-org-ld-json" type="application/ld+json" strategy="beforeInteractive">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "andreybolotov.ru",
            url: "https://andreybolotov.ru",
            logo: "https://andreybolotov.ru/logo-ab.svg",
          })}
        </Script>
        {/* Синхронно до React: классы страниц акции */}
        <Script id="ab-route-html-classes" strategy="beforeInteractive">
          {`!function(){try{var p=location.pathname||"";while(p.length>1&&p.charAt(p.length-1)==="/")p=p.slice(0,-1);if(p==="/home/raffle"||p.indexOf("/raffle/")===0){document.documentElement.classList.add("raffle-purchase-page","raffle-grid-page");}else if(p.indexOf("/home/raffle/confirm")===0){document.documentElement.classList.add("raffle-confirm-page");}}catch(_){}}();`}
        </Script>
        <AbRouteHtmlClasses />
        <Script id="ab-api-ws" strategy="beforeInteractive">
          {`try{var o=${JSON.stringify(process.env.NEXT_PUBLIC_AB_WS_ORIGIN || "")};if(o){window.__AB_WS_ORIGIN__=String(o).replace(/\\/$/,"");}}catch(_){}`}
        </Script>
        <AbSessionProvider>
          <AbToastHost />
          {children}
        </AbSessionProvider>
      </body>
    </html>
  );
}
