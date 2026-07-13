import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { encodeCdnSafeToken, looksLikeCdnBlockedToken } from "./lib/ab-cdn-safe-token";

const STATIC_EXT_RE = /\.(?:png|jpe?g|webp|gif|svg|ico|css|js|map|woff2?|ttf|eot|mp3|mp4|webm|json)$/i;

function upstreamOrigin(): string {
  return (process.env.AB_UPSTREAM_ORIGIN || "http://127.0.0.1:8787").replace(/\/$/, "");
}

function isNextLocalApi(pathname: string): boolean {
  return pathname.startsWith("/api/auth/forgot") || pathname.startsWith("/api/auth/reset-password");
}

/** Мелкие загрузки — Route Handler Next (`/api/raffles/receipt-upload`, `/api/chat/upload`); остальной /api — rewrite на Fastify. */
function isApiUploadPath(pathname: string): boolean {
  return pathname === "/api/chat/upload" || pathname === "/api/raffles/receipt-upload";
}

/**
 * Beeline CDN 403 on bare UUID / 32-hex in URL → redirect to ab.* form.
 * Cold UUID hits on my. still 403 at edge until secure links are disabled in Beeline.
 */
function redirectCdnUnsafeTokens(request: NextRequest): NextResponse | null {
  const url = request.nextUrl.clone();
  const path = url.pathname;
  let changed = false;

  const raffleMatch = path.match(/^\/raffle\/([^/]+)\/?$/);
  if (raffleMatch) {
    let seg = raffleMatch[1];
    try {
      seg = decodeURIComponent(seg);
    } catch {
      /* keep */
    }
    if (looksLikeCdnBlockedToken(seg)) {
      url.pathname = "/raffle/" + encodeURIComponent(encodeCdnSafeToken(seg));
      changed = true;
    }
  }

  const t = url.searchParams.get("t");
  if (t && looksLikeCdnBlockedToken(t)) {
    url.searchParams.set("t", encodeCdnSafeToken(t));
    changed = true;
  }

  const hash = url.searchParams.get("hash");
  if (hash && looksLikeCdnBlockedToken(hash)) {
    url.searchParams.set("hash", encodeCdnSafeToken(hash));
    changed = true;
  }

  if (!changed) return null;
  return NextResponse.redirect(url, 308);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || pathname.startsWith("/static-proxy")) {
    return NextResponse.next();
  }

  const cdnRedirect = redirectCdnUnsafeTokens(request);
  if (cdnRedirect) return cdnRedirect;

  if (pathname.startsWith("/api/")) {
    if (isNextLocalApi(pathname) || isApiUploadPath(pathname)) return NextResponse.next();
    const base = upstreamOrigin();
    const target = new URL(pathname + request.nextUrl.search, base);
    return NextResponse.rewrite(target);
  }

  if (pathname.startsWith("/uploads/")) {
    const base = upstreamOrigin();
    const target = new URL(pathname + request.nextUrl.search, base);
    return NextResponse.rewrite(target);
  }

  if (STATIC_EXT_RE.test(pathname)) {
    // Serve static assets directly from Next/public.
    // Rewriting to /static-proxy can trigger self-proxy over wrong scheme in some prod setups.
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
