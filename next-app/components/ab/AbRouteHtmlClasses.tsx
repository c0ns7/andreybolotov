"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect } from "react";

const RAFFLE_PURCHASE = ["raffle-purchase-page", "raffle-grid-page"] as const;
const RAFFLE_CONFIRM = ["raffle-confirm-page"] as const;
const UI_NO_SELECT = "ab-ui-no-select";

function clearRouteClasses(root: HTMLElement) {
  for (const c of RAFFLE_PURCHASE) root.classList.remove(c);
  for (const c of RAFFLE_CONFIRM) root.classList.remove(c);
  root.classList.remove(UI_NO_SELECT);
}

function shouldDisableTextSelect(pathNorm: string): boolean {
  if (pathNorm === "/" || pathNorm === "/home") return true;
  if (pathNorm === "/home/raffle" || pathNorm.startsWith("/home/raffle/")) return true;
  if (pathNorm.startsWith("/raffle/")) return true;
  return false;
}

/**
 * Синхронизирует классы на documentElement с маршрутом (без React className на <html> — не затирает theme-dark и др.).
 */
export default function AbRouteHtmlClasses() {
  const pathname = usePathname() || "";
  const pathNorm = pathname.replace(/\/+$/, "") || "";

  useLayoutEffect(() => {
    const root = document.documentElement;
    clearRouteClasses(root);
    if (pathNorm !== "/home/raffle" && !pathNorm.startsWith("/raffle/")) {
      root.classList.remove("has-cart-action-strip", "bottom-nav-hidden-by-fast-input");
    }
    if (pathNorm === "/home/raffle" || pathNorm.startsWith("/raffle/")) {
      root.classList.add(...RAFFLE_PURCHASE);
    } else if (pathNorm.startsWith("/home/raffle/confirm")) {
      root.classList.add(...RAFFLE_CONFIRM);
    }
    if (shouldDisableTextSelect(pathNorm)) {
      root.classList.add(UI_NO_SELECT);
    }
    return () => {
      clearRouteClasses(root);
    };
  }, [pathNorm]);

  return null;
}
