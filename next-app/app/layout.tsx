import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import AbRouteHtmlClasses from "../components/ab/AbRouteHtmlClasses";
import { AbSessionProvider } from "../components/ab/AbSessionContext";
import AbToastHost from "../components/ab/AbToastHost";
import IosInstallAppPrompt from "../components/ab/IosInstallAppPrompt";
import SiteOnlineBadge from "../components/ab/SiteOnlineBadge";

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
        url: "/logoandreybolotov.png",
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
    images: ["/logoandreybolotov.png"],
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
    apple: [{ url: "/logoandreybolotov.png", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
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
            logo: "https://andreybolotov.ru/logoandreybolotov.png",
          })}
        </Script>
        {/* Синхронно до React: классы страниц акции */}
        <Script id="ab-no-zoom" strategy="beforeInteractive">
          {`!function(){try{var p=function(e){e.preventDefault()};document.addEventListener("gesturestart",p,{passive:!1});document.addEventListener("gesturechange",p,{passive:!1});document.addEventListener("gestureend",p,{passive:!1});document.addEventListener("wheel",function(e){if(e.ctrlKey)e.preventDefault()},{passive:!1})}catch(_){}}();`}
        </Script>
        <Script id="ab-route-html-classes" strategy="beforeInteractive">
          {`!function(){try{var p=location.pathname||"";while(p.length>1&&p.charAt(p.length-1)==="/")p=p.slice(0,-1);if(p==="/home/raffle"||p.indexOf("/raffle/")===0){document.documentElement.classList.add("raffle-purchase-page","raffle-grid-page");}else if(p.indexOf("/home/raffle/confirm")===0){document.documentElement.classList.add("raffle-confirm-page");}}catch(_){}}();`}
        </Script>
        <AbRouteHtmlClasses />
        <Script id="ab-api-ws" strategy="beforeInteractive">
          {`try{var o=${JSON.stringify(process.env.NEXT_PUBLIC_AB_WS_ORIGIN || "")};if(o){window.__AB_WS_ORIGIN__=String(o).replace(/\\/$/,"");}}catch(_){}`}
        </Script>
        <Script id="ab-api-http" strategy="beforeInteractive">
          {`try{var h=${JSON.stringify(process.env.NEXT_PUBLIC_AB_HTTP_ORIGIN || "")};if(h){window.__AB_HTTP_ORIGIN__=String(h).replace(/\\/$/,"");}}catch(_){}`}
        </Script>
        <AbSessionProvider>
          <AbToastHost />
          <SiteOnlineBadge />
          <IosInstallAppPrompt />
          {children}
        </AbSessionProvider>
      </body>
    </html>
  );
}
