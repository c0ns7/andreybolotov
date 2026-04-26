import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import AbRouteHtmlClasses from "../components/ab/AbRouteHtmlClasses";
import { AbSessionProvider } from "../components/ab/AbSessionContext";
import AbToastHost from "../components/ab/AbToastHost";

export const metadata: Metadata = {
  title: "andreybolotov.ru",
  description: "andreybolotov.ru",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        {/* Синхронно до React: классы страниц акции */}
        <Script id="ab-route-html-classes" strategy="beforeInteractive">
          {`!function(){try{var p=location.pathname||"";while(p.length>1&&p.charAt(p.length-1)==="/")p=p.slice(0,-1);if(p==="/home/raffle"||p.indexOf("/raffle/")===0){document.documentElement.classList.add("raffle-purchase-page","raffle-grid-page");}else if(p.indexOf("/home/raffle/confirm")===0){document.documentElement.classList.add("raffle-confirm-page");}}catch(_){}}();`}
        </Script>
        <AbRouteHtmlClasses />
        <Script id="ab-api-ws" strategy="beforeInteractive">
          {`try{window.__AB_WS_ORIGIN__=${JSON.stringify(process.env.NEXT_PUBLIC_AB_WS_ORIGIN || "ws://127.0.0.1:8787")};}catch(_){}`}
        </Script>
        <AbSessionProvider>
          <AbToastHost />
          {children}
        </AbSessionProvider>
      </body>
    </html>
  );
}
