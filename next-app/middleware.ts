import { NextRequest, NextResponse } from "next/server";
import { encodeCdnSafeToken, looksLikeCdnBlockedToken } from "./lib/ab-cdn-safe-token";

/**
 * Beeline CDN blocks bare UUID / 32-hex in URL. Redirect to ab.* form when possible.
 * (Cold hits of UUID URLs on my. still 403 at the edge until Beeline turns off secure links.)
 */
export function middleware(request: NextRequest) {
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

  if (!changed) return NextResponse.next();
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ["/raffle/:path*", "/home/order-status", "/home/raffle"],
};
