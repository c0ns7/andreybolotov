import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import AbRouteHtmlClasses from "../components/ab/AbRouteHtmlClasses";
import { AbSessionProvider } from "../components/ab/AbSessionContext";
import { SiteMusicProvider } from "../components/ab/SiteMusicProvider";
import AbToastHost from "../components/ab/AbToastHost";
import AbServiceWorkerRegister from "../components/ab/AbServiceWorkerRegister";
import InAppBrowserGate from "../components/ab/InAppBrowserGate";
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
          {`!function(){try{var p=function(e){e.preventDefault()};document.addEventListener("gesturestart",p,{passive:!1});document.addEventListener("gesturechange",p,{passive:!1});document.addEventListener("gestureend",p,{passive:!1});document.addEventListener("wheel",function(e){if(e.ctrlKey)e.preventDefault()},{passive:!1});document.addEventListener("contextmenu",function(e){e.preventDefault()},{passive:!1})}catch(_){}}();`}
        </Script>
        <Script id="ab-route-html-classes" strategy="beforeInteractive">
          {`!function(){try{var p=location.pathname||"";while(p.length>1&&p.charAt(p.length-1)==="/")p=p.slice(0,-1);if(p==="/home/raffle"||p.indexOf("/raffle/")===0){document.documentElement.classList.add("raffle-purchase-page","raffle-grid-page");}else if(p.indexOf("/home/raffle/confirm")===0){document.documentElement.classList.add("raffle-confirm-page");}if(p==="/"||p==="/home"||p==="/home/blog"||p.indexOf("/home/blog/")===0||p==="/home/raffle"||p.indexOf("/home/raffle/")===0||p.indexOf("/raffle/")===0){document.documentElement.classList.add("ab-ui-no-select");}}catch(_){}}();`}
        </Script>
        <AbRouteHtmlClasses />
        <Script id="ab-clear-auth-cookies" strategy="beforeInteractive">
          {`!function(){try{var d=location.hostname==="andreybolotov.ru"||/\\.andreybolotov\\.ru$/.test(location.hostname)?"; Domain=.andreybolotov.ru":"";["ab_auth_v2","ab_tok","ab_sess"].forEach(function(n){document.cookie=n+"=; path=/; max-age=0"+d;document.cookie=n+"=; path=/; max-age=0";});}catch(_){}}();`}
        </Script>
        {/*
          Beeline CDN (my.) отдаёт HTML/статику, но /api и /ws часто 403/404.
          На my. API+WS идут на apex; env при необходимости переопределяет.
        */}
        <Script id="ab-api-origins" strategy="beforeInteractive">
          {`!function(){try{
var envWs=${JSON.stringify(process.env.NEXT_PUBLIC_AB_WS_ORIGIN || "")};
var envHttp=${JSON.stringify(process.env.NEXT_PUBLIC_AB_HTTP_ORIGIN || "")};
var envUp=${JSON.stringify(process.env.NEXT_PUBLIC_AB_UPLOAD_ORIGIN || "")};
var h=location.hostname||"";
var onCdn=h==="my.andreybolotov.ru"||/\\.a\\.trbcdn\\.net$/.test(h);
var apex="https://andreybolotov.ru";
var http=String(envHttp||"").replace(/\\/$/,"");
var ws=String(envWs||"").replace(/\\/$/,"");
var up=String(envUp||"").replace(/\\/$/,"");
if(!http&&onCdn)http=apex;
if(!ws&&onCdn)ws=apex;
if(http)window.__AB_HTTP_ORIGIN__=http;
if(ws)window.__AB_WS_ORIGIN__=ws;
if(up)window.__AB_UPLOAD_ORIGIN__=up;
if(!http)return;
function rewrite(u){
  if(typeof u!=="string")return u;
  if(u.charAt(0)==="/"){
    if(u.indexOf("/api/")===0||u==="/api"||u.indexOf("/ws")===0)return http+u;
    return u;
  }
  try{
    var x=new URL(u,location.href);
    if(x.origin===location.origin&&(x.pathname.indexOf("/api/")===0||x.pathname==="/api"||x.pathname.indexOf("/ws")===0)){
      return http+x.pathname+x.search+x.hash;
    }
  }catch(_){}
  return u;
}
var of=window.fetch;
if(typeof of==="function"){
  window.fetch=function(input,init){
    try{
      if(typeof input==="string"){input=rewrite(input);}
      else if(input&&typeof Request!=="undefined"&&input instanceof Request){
        var nu=rewrite(input.url);
        if(nu!==input.url)input=new Request(nu,input);
      }
    }catch(_){}
    return of.call(this,input,init);
  };
}
var XO=XMLHttpRequest&&XMLHttpRequest.prototype;
if(XO&&XO.open){
  var oo=XO.open;
  XO.open=function(){
    var args=Array.prototype.slice.call(arguments);
    try{if(typeof args[1]==="string")args[1]=rewrite(args[1]);}catch(_){}
    return oo.apply(this,args);
  };
}
}catch(_){}}();`}
        </Script>
        <AbSessionProvider>
          <SiteMusicProvider>
            <InAppBrowserGate />
            <AbToastHost />
            <SiteOnlineBadge />
            <IosInstallAppPrompt />
            <AbServiceWorkerRegister />
            {children}
          </SiteMusicProvider>
        </AbSessionProvider>
      </body>
    </html>
  );
}
