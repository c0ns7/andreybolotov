import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const STATIC_EXT_RE = /\.(?:png|jpe?g|webp|gif|svg|ico|css|js|map|woff2?|ttf|eot|mp3|mp4|webm|json)$/i;

function upstreamOrigin(): string {
  return (process.env.AB_UPSTREAM_ORIGIN || "http://127.0.0.1:8787").replace(/\/$/, "");
}

function isNextLocalApi(pathname: string): boolean {
  return pathname.startsWith("/api/auth/forgot") || pathname.startsWith("/api/auth/reset-password");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || pathname.startsWith("/static-proxy")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    if (isNextLocalApi(pathname)) return NextResponse.next();
    const base = upstreamOrigin();
    const target = new URL(pathname + request.nextUrl.search, base);
    return NextResponse.rewrite(target);
  }

  if (STATIC_EXT_RE.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = `/static-proxy${pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
