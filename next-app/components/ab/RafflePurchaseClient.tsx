"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { abApiJson, abAuthHeaders, AbApiError } from "../../lib/ab-api";
import { loadAbSession } from "../../lib/ab-session";
import {
  isNetworkFetchError,
  postReceiptWithRetries,
  RECEIPT_NETWORK_MODAL_TEXT,
  RECEIPT_NETWORK_MODAL_TITLE,
  uploadReceiptFile,
} from "../../lib/receipt-client";
import { AB_USER_WS_EVENT } from "../../lib/ab-user-ws-events";
import AbRafflePurchaseShellMarkup from "./AbRafflePurchaseShellMarkup";
import AppBottomNav from "./AppBottomNav";
import { useAbSession } from "./AbSessionContext";

const RAFFLE_MAX_SELECT = 25;
const DRAFT_PREFIX = "ab_raffle_draft_";
const LOW_STOCK_FREE_THRESHOLD = 500;
/** Карточка «мало свободных» — только если у пользователя в акции меньше 3 своих номерков. */
const LOW_STOCK_USER_TICKETS_MAX = 3;

type RaffleDto = Record<string, unknown> & {
  id?: number;
  title?: string;
  status?: string;
  ticket_count?: number;
  price_rub?: number;
  cover_image_url?: string;
  viewers_count?: number;
  rules_url?: string;
  collection_url?: string;
  tbank_collection_url?: string;
  qr_image_url?: string;
  sber_enabled?: boolean | number;
  tbank_enabled?: boolean | number;
  qr_enabled?: boolean | number;
  sber_collection_recipient?: string;
  tbank_collection_recipient?: string;
  collection_recipient?: string;
  qr_recipient?: string;
  qr_payment_purpose?: string;
  card_payment_scope?: string;
  card_payment_min_tickets?: number;
  wholesale_every_n_tickets?: number;
  has_bank_cards?: boolean;
};

type OrderDto = Record<string, unknown> & {
  id?: number;
  status?: string;
  raffle_id?: number;
  amount_rub?: number;
  reserved_until?: number;
  bank?: string | null;
  bank_card_id?: number | null;
};

type Cell = { n: number; kind: string };

function esc(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatRub(n: number) {
  return String(Math.max(0, Math.round(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Показ номера карты группами по 4 цифры (как на самой карте). */
function formatBankCardForDisplay(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "—";
  const parts: string[] = [];
  for (let i = 0; i < d.length; i += 4) parts.push(d.slice(i, i + 4));
  return parts.join(" ");
}

function formatMmSs(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function getRafflePayChannelFlags(r: RaffleDto) {
  const hasCol =
    (r.sber_enabled != null ? Boolean(Number(r.sber_enabled) === 1 || r.sber_enabled === true) : Boolean(String(r.collection_url || "").trim())) &&
    Boolean(String(r.collection_url || "").trim());
  const hasTbank =
    (r.tbank_enabled != null ? Boolean(Number(r.tbank_enabled) === 1 || r.tbank_enabled === true) : Boolean(String(r.tbank_collection_url || "").trim())) &&
    Boolean(String(r.tbank_collection_url || "").trim());
  const hasQr =
    (r.qr_enabled != null ? Boolean(Number(r.qr_enabled) === 1 || r.qr_enabled === true) : Boolean(String(r.qr_image_url || "").trim())) &&
    Boolean(String(r.qr_image_url || "").trim());
  return { hasCol, hasTbank, hasQr };
}

/** Сколько номерков не хватает до порога оплаты на карту; null если карт нет, режим без порога или порог уже выполнен. */
function getBankCardTicketShortfall(r: RaffleDto, ticketCount: number): number | null {
  if (!r.has_bank_cards) return null;
  const scope = String(r.card_payment_scope || "unlimited").toLowerCase();
  const everyN = Math.max(1, Math.floor(Number(r.wholesale_every_n_tickets) || 10));
  const minCardM = Math.max(1, Math.floor(Number(r.card_payment_min_tickets) || 2));
  if (scope === "wholesale_only") {
    if (ticketCount >= everyN) return null;
    return everyN - ticketCount;
  }
  if (scope === "min_order_tickets") {
    if (ticketCount >= minCardM) return null;
    return minCardM - ticketCount;
  }
  return null;
}

function buildRangeParts(ticketCount: number) {
  const maxN = Math.max(1, Math.floor(Number(ticketCount) || 1));
  const chunk = 500;
  const parts: { from: number; to: number }[] = [];
  let start = 1;
  while (start <= maxN) {
    const end = Math.min(start + chunk - 1, maxN);
    parts.push({ from: start, to: end });
    start = end + 1;
  }
  return parts;
}

function getRangeTabForTicketN(ticketCount: number, n: number) {
  const parts = buildRangeParts(ticketCount);
  for (const p of parts) {
    if (n >= p.from && n <= p.to) return p;
  }
  return null;
}

function sliceCacheKey(raffleId: number, from: number, to: number) {
  return String(raffleId) + ":" + String(from) + "-" + String(to);
}

function rebuildCellByNumberMap(sliceCache: Map<string, { ts: number; cells: Cell[] }>): Map<number, Cell> {
  const map = new Map<number, Cell>();
  for (const { cells } of sliceCache.values()) {
    for (const c of cells) {
      const n = Math.floor(Number(c.n));
      if (Number.isFinite(n) && n > 0) map.set(n, c);
    }
  }
  return map;
}

function collectGlobalFreeNumbers(sliceCache: Map<string, { ts: number; cells: Cell[] }>, selected: Set<number>): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const { cells } of sliceCache.values()) {
    for (const c of cells) {
      if (String(c.kind) !== "free") continue;
      const n = Math.floor(Number(c.n));
      if (!Number.isFinite(n) || n < 1 || selected.has(n) || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function countFreeInRange(
  sliceCache: Map<string, { ts: number; cells: Cell[] }>,
  raffleId: number,
  from: number,
  to: number,
): number {
  const cached = sliceCache.get(sliceCacheKey(raffleId, from, to));
  if (!cached) return 0;
  let n = 0;
  for (const c of cached.cells) {
    if (String(c.kind) === "free") n += 1;
  }
  return n;
}

function countUserOwnedTickets(sliceCache: Map<string, { ts: number; cells: Cell[] }>): number {
  const seen = new Set<number>();
  for (const { cells } of sliceCache.values()) {
    for (const c of cells) {
      const kind = String(c.kind || "");
      if (kind !== "self_reserved" && kind !== "self_pending" && kind !== "self_confirmed") continue;
      const n = Math.floor(Number(c.n));
      if (Number.isFinite(n) && n > 0) seen.add(n);
    }
  }
  return seen.size;
}

function pickRangeWithMostFree(
  parts: { from: number; to: number }[],
  sliceCache: Map<string, { ts: number; cells: Cell[] }>,
  raffleId: number,
): { from: number; to: number } {
  if (!parts.length) return { from: 1, to: 500 };
  let best = parts[0]!;
  let bestFree = -1;
  for (const p of parts) {
    const freeN = countFreeInRange(sliceCache, raffleId, p.from, p.to);
    if (freeN > bestFree) {
      bestFree = freeN;
      best = p;
    }
  }
  return best;
}

function syncCartFlowRail(totalNums: number) {
  const nav = document.getElementById("modal-cart-flow-steps");
  const picked = document.getElementById("modal-cart-picked-label");
  if (!nav) return;
  if (totalNums < 1) {
    nav.hidden = true;
    if (picked) picked.hidden = true;
    return;
  }
  nav.hidden = false;
  if (picked) picked.hidden = false;
  nav.querySelectorAll("[data-cart-flow-step]").forEach((node) => {
    const key = node.getAttribute("data-cart-flow-step");
    node.classList.remove("is-done", "is-current", "is-upcoming");
    if (key === "pick") node.classList.add("is-done");
    else if (key === "cart") node.classList.add("is-current");
    else node.classList.add("is-upcoming");
  });
  nav.querySelectorAll("[data-cart-connector]").forEach((node, i) => {
    node.classList.toggle("is-filled", i === 0);
  });
}

function paintFlowSteps(navId: string, phase: "success" | "requisites" | "confirm" | "wait") {
  const nav = document.getElementById(navId);
  if (!nav) return;
  const steps = nav.querySelectorAll(".payment-flow-steps__step");
  let current = 2;
  if (phase === "success") current = 1;
  else if (phase === "requisites") current = 2;
  else if (phase === "confirm" || phase === "wait") current = 3;
  steps.forEach((li, i) => {
    const n = i + 1;
    li.classList.remove("is-done", "is-current", "is-upcoming");
    if (n < current) li.classList.add("is-done");
    else if (n === current) li.classList.add("is-current");
    else li.classList.add("is-upcoming");
  });
}

function openOverlay(el: HTMLElement | null) {
  if (!el) return;
  el.classList.add("is-open");
  el.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeOverlay(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove("is-open");
  el.setAttribute("aria-hidden", "true");
  if (!document.querySelector(".modal-overlay.is-open")) document.body.style.overflow = "";
}

function renderRaffleGridHtml(cells: Cell[], selected: Set<number>, onlyFree: boolean) {
  const draw = onlyFree ? cells.filter((c) => String(c.kind) === "free") : cells;
  let html = "";
  for (let i = 0; i < draw.length; i++) {
    const cell = draw[i];
    const n = cell.n;
    const kind = String(cell.kind || "free");
    if (kind === "taken") {
      const labelTaken = String(n);
      html +=
        '<div class="raffle-cell raffle-cell--taken" title="Занято" aria-label="Занято, номер ' +
        esc(labelTaken) +
        '">' +
        esc(labelTaken) +
        "</div>";
      continue;
    }
    const label = String(n);
    let cls = "raffle-cell";
    if (kind === "self_reserved" || kind === "self_pending" || kind === "self_confirmed") {
      cls += " raffle-cell--free raffle-cell--mine";
      if (kind === "self_confirmed") cls += " raffle-cell--mine-confirmed";
      if (kind === "self_pending") cls += " raffle-cell--mine-pending";
      if (kind === "self_reserved" && selected.has(n)) {
        cls += " raffle-cell--selected";
        html +=
          '<button type="button" class="' +
          cls +
          '" data-ticket="' +
          esc(label) +
          '" data-kind="self_reserved" aria-pressed="true">' +
          esc(label) +
          "</button>";
        continue;
      }
      html +=
        '<div class="' +
        cls +
        '" data-kind="' +
        esc(kind) +
        '" aria-label="Ваш номер ' +
        esc(label) +
        '"><span>' +
        esc(label) +
        "</span></div>";
      continue;
    }
    if (kind === "free") {
      cls += " raffle-cell--free";
      if (selected.has(n)) cls += " raffle-cell--selected";
      html +=
        '<button type="button" class="' +
        cls +
        '" data-ticket="' +
        esc(label) +
        '" data-kind="free" aria-pressed="' +
        (selected.has(n) ? "true" : "false") +
        '">' +
        esc(label) +
        "</button>";
    } else {
      cls += " raffle-cell--free raffle-cell--mine";
      html +=
        '<div class="' +
        cls +
        '" data-kind="' +
        esc(kind) +
        '" aria-label="Номер ' +
        esc(label) +
        '"><span>' +
        esc(label) +
        "</span></div>";
    }
  }
  return html;
}

function renderRaffleGridLoaderHtml() {
  return (
    '<div class="raffle-ticket-grid__loader" role="status" aria-live="polite">' +
    '<span class="raffle-ticket-grid__loader-ring" aria-hidden="true"></span>' +
    '<span class="raffle-ticket-grid__loader-text">Загрузка</span>' +
    "</div>"
  );
}

type RafflePurchaseClientProps = {
  raffleHash?: string;
};

export default function RafflePurchaseClient({ raffleHash = "" }: RafflePurchaseClientProps) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const params = useSearchParams();
  const routeParams = useParams<{ hash?: string | string[] }>();
  const { session, authVerified, authCheckInFlight, toast } = useAbSession();
  const toastRef = useRef(toast);
  const payCopyBtnOriginalHtmlRef = useRef(new WeakMap<HTMLButtonElement, string>());
  const payCopyBtnTimerRef = useRef(new WeakMap<HTMLButtonElement, number>());
  toastRef.current = toast;

  const raffleId = useMemo(() => {
    const raw = params.get("id");
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [params]);
  const shouldAutoOpenPayment = useMemo(() => {
    return String(params.get("openPayment") || "").trim() === "1";
  }, [params]);
  const hash = useMemo(() => {
    const fromProp = String(raffleHash || "").trim();
    if (fromProp) return fromProp;
    const rawRouteHash = routeParams?.hash;
    if (Array.isArray(rawRouteHash)) return String(rawRouteHash[0] || "").trim();
    return String(rawRouteHash || "").trim();
  }, [raffleHash, routeParams]);
  const onHashRoute = pathname.startsWith("/raffle/");

  const [raffle, setRaffle] = useState<RaffleDto | null>(null);
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(500);
  const [rangeParts, setRangeParts] = useState<{ from: number; to: number }[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [gridLoading, setGridLoading] = useState(false);
  const [onlyFreeView, setOnlyFreeView] = useState(false);
  const onlyFreeViewRef = useRef(false);
  onlyFreeViewRef.current = onlyFreeView;
  const [selected, setSelected] = useState<number[]>([]);
  const [order, setOrder] = useState<OrderDto | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const [orderNumbers, setOrderNumbers] = useState<number[]>([]);
  const rangeHasFreeRef = useRef(new Map<string, boolean>());
  const [serverSkewMs, setServerSkewMs] = useState(0);
  const reserveMono = useRef<{ budgetMs: number | null; anchorPerf: number | null }>({ budgetMs: null, anchorPerf: null });
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [mainStep, setMainStep] = useState<"grid" | "wait">("grid");
  const [lowStockModal, setLowStockModal] = useState<{ freeCount: number } | null>(null);
  const [navHiddenByInput, setNavHiddenByInput] = useState(false);

  const reserveDraftRef = useRef<{
    orderId: number;
    amountRub: number;
    reservedUntil: number;
    numbers: number[];
    paymentMethod: "collection" | "tbank_collection" | "qr" | "bank_card";
    activeBankCard: { id: number; card_number: string; recipient: string } | null;
  } | null>(null);

  const altPayCycleRef = useRef<{ modes: string[]; idx: number }>({ modes: [], idx: -1 });

  const paymentStepRef = useRef<"requisites" | "confirm">("requisites");
  const payTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoOpenPaymentTriggeredRef = useRef(false);
  const receiptUploadDataRef = useRef<Record<string, unknown> | null>(null);
  const receiptUploadInFlightRef = useRef(false);
  const receiptUploadSeqRef = useRef(0);
  const fastLookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fastLookupRef = useRef<{ n: number; kind: string | null }>({ n: NaN, kind: null });
  const cellByNumberRef = useRef(new Map<number, Cell>());
  const allSlicesLoadedRef = useRef(false);
  const fastCellsLookupDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selRef = useRef(selectedSet);
  selRef.current = selectedSet;

  const letter = useMemo(() => {
    const n = session?.name?.trim()?.[0] || session?.phone?.replace(/\D/g, "")?.slice(-1) || "К";
    return n.toUpperCase();
  }, [session]);

  const persistDraft = useCallback(
    (rid: number, nums: number[]) => {
      try {
        const key = DRAFT_PREFIX + String(rid);
        if (!nums.length) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(nums));
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const applySkewFromPayload = useCallback((data: Record<string, unknown>) => {
    const st = Number(data.server_time_ms);
    if (Number.isFinite(st)) setServerSkewMs(st - Date.now());
    const ord = data.order as OrderDto | null | undefined;
    if (data.order === null) {
      reserveMono.current = { budgetMs: null, anchorPerf: null };
    }
    if (Number.isFinite(st) && ord && ord.reserved_until != null && String(ord.status || "") === "reserved") {
      const u = Number(ord.reserved_until);
      if (typeof performance !== "undefined" && performance.now) {
        reserveMono.current.budgetMs = Math.max(0, u - st);
        reserveMono.current.anchorPerf = performance.now();
      }
    }
  }, []);

  const nowSynced = useCallback(() => Date.now() + serverSkewMs, [serverSkewMs]);

  const reservationLeftMs = useCallback(
    (untilTs: number) => {
      const m = reserveMono.current;
      if (m.budgetMs != null && m.anchorPerf != null && typeof performance !== "undefined") {
        return Math.max(0, m.budgetMs - (performance.now() - m.anchorPerf));
      }
      return Math.max(0, Number(untilTs || 0) - nowSynced());
    },
    [nowSynced],
  );

  const raffleRef = useRef<RaffleDto | null>(null);
  raffleRef.current = raffle;
  const reservationLeftMsRef = useRef(reservationLeftMs);
  reservationLeftMsRef.current = reservationLeftMs;
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const rangeFromRef = useRef(rangeFrom);
  rangeFromRef.current = rangeFrom;
  const rangeToRef = useRef(rangeTo);
  rangeToRef.current = rangeTo;

  const updateRangeTabMarkersFromCache = useCallback(() => {
    const tabs = document.getElementById("raffle-page-tabs");
    if (!tabs) return;
    for (const p of rangePartsRef.current) {
      const key = String(p.from) + "-" + String(p.to);
      const known = rangeHasFreeRef.current.get(key);
      if (known == null) continue;
      const btn = tabs.querySelector(
        `.raffle-range-tab[data-from="${p.from}"][data-to="${p.to}"]`,
      ) as HTMLElement | null;
      if (btn) btn.classList.toggle("raffle-range-tab--no-free", !known);
    }
  }, []);

  const applyCachedRange = useCallback((from: number, to: number, opts?: { showLoader?: boolean }) => {
    const r = raffleRef.current;
    if (!r?.id) return false;
    const cached = sliceCacheRef.current.get(sliceCacheKey(Number(r.id), from, to));
    if (!cached) {
      if (opts?.showLoader !== false) {
        setGridLoading(true);
        setCells([]);
      }
      return false;
    }
    setCells(cached.cells);
    setGridLoading(false);
    return true;
  }, []);

  const switchRangeTab = useCallback(
    (from: number, to: number) => {
      const same = from === rangeFromRef.current && to === rangeToRef.current;
      document.querySelectorAll(".raffle-range-tab").forEach((b) => {
        const el = b as HTMLElement;
        const bf = Number(el.getAttribute("data-from"));
        const bt = Number(el.getAttribute("data-to"));
        el.classList.toggle("raffle-range-tab--active", bf === from && bt === to);
      });
      if (!same) {
        setRangeFrom(from);
        setRangeTo(to);
      }
      if (!applyCachedRange(from, to, { showLoader: !allSlicesLoadedRef.current })) {
        void loadSliceRef.current({ showLoader: !allSlicesLoadedRef.current });
      }
    },
    [applyCachedRange],
  );

  const switchRangeTabRef = useRef(switchRangeTab);
  switchRangeTabRef.current = switchRangeTab;

  const syncRangeTabsVisibility = useCallback(() => {
    const tabs = document.getElementById("raffle-page-tabs");
    if (!tabs) return;
    const onlyFree = onlyFreeViewRef.current;
    const btns = Array.from(tabs.querySelectorAll(".raffle-range-tab")) as HTMLElement[];
    btns.forEach((btn) => {
      const noFree = btn.classList.contains("raffle-range-tab--no-free");
      btn.hidden = onlyFree && noFree;
    });
    const toolbar = tabs.closest(".raffle-range-toolbar-scroll") as HTMLElement | null;
    if (toolbar) {
      const anyVisible = btns.some((b) => !b.hidden);
      toolbar.hidden = onlyFree && !anyVisible;
    }
    if (!onlyFree) return;
    const active = btns.find((b) => b.classList.contains("raffle-range-tab--active"));
    if (active && !active.hidden) return;
    const first = btns.find((b) => !b.hidden);
    if (!first) return;
    const from = Number(first.getAttribute("data-from"));
    const to = Number(first.getAttribute("data-to"));
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    switchRangeTab(from, to);
  }, [switchRangeTab]);

  const syncRangeTabsVisibilityRef = useRef(syncRangeTabsVisibility);
  syncRangeTabsVisibilityRef.current = syncRangeTabsVisibility;

  const setOnlyFreeViewEnabled = useCallback((enabled: boolean) => {
    setOnlyFreeView(enabled);
    const eye = document.getElementById("raffle-page-only-free");
    if (eye) {
      eye.setAttribute("aria-pressed", enabled ? "true" : "false");
      eye.classList.toggle("raffle-range-eye--active", enabled);
    }
    syncRangeTabsVisibilityRef.current();
  }, []);

  const finishRaffleGridBootstrap = useCallback(
    (parts: { from: number; to: number }[], raffleId: number) => {
      const best = pickRangeWithMostFree(parts, sliceCacheRef.current, raffleId);
      switchRangeTabRef.current(best.from, best.to);
      const totalFree = collectGlobalFreeNumbers(sliceCacheRef.current, new Set()).length;
      const userTickets = countUserOwnedTickets(sliceCacheRef.current);
      if (
        totalFree > 0 &&
        totalFree < LOW_STOCK_FREE_THRESHOLD &&
        userTickets < LOW_STOCK_USER_TICKETS_MAX
      ) {
        setLowStockModal({ freeCount: totalFree });
      }
    },
    [],
  );
  const rangePartsRef = useRef<{ from: number; to: number }[]>([]);
  rangePartsRef.current = rangeParts;
  const mainStepRef = useRef(mainStep);
  mainStepRef.current = mainStep;
  const gridLoadingRef = useRef(gridLoading);
  gridLoadingRef.current = gridLoading;
  const syncRaffleSwipeHintsRef = useRef<() => void>(() => {});
  const sliceCacheRef = useRef(new Map<string, { ts: number; cells: Cell[] }>());

  const fetchRangeSlice = useCallback(async (id: number, from: number, to: number): Promise<Cell[]> => {
    const res = await fetch(
      "/api/raffles/" + String(id) + "/tickets?from=" + String(from) + "&to=" + String(to),
      { cache: "no-store", headers: abAuthHeaders() },
    );
    const data = (await res.json()) as { cells?: Cell[]; error?: string };
    if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
    return Array.isArray(data.cells) ? data.cells : [];
  }, []);

  const loadAllSlices = useCallback(
    async (opts?: { force?: boolean; showLoader?: boolean; parts?: { from: number; to: number }[] }) => {
      const r = raffleRef.current;
      if (!r?.id) return;
      const id = Number(r.id);
      const parts = opts?.parts?.length ? opts.parts : rangePartsRef.current;
      if (!parts.length) return;
      const force = Boolean(opts?.force);
      const showLoader = opts?.showLoader !== false;
      if (showLoader) {
        setCells([]);
        setGridLoading(true);
      }
      try {
        await Promise.all(
          parts.map(async (p) => {
            const cacheKey = sliceCacheKey(id, p.from, p.to);
            if (!force) {
              const cached = sliceCacheRef.current.get(cacheKey);
              if (cached && Date.now() - cached.ts < 20_000) {
                rangeHasFreeRef.current.set(
                  String(p.from) + "-" + String(p.to),
                  cached.cells.some((c) => String(c.kind) === "free"),
                );
                return;
              }
            }
            const nextCells = await fetchRangeSlice(id, p.from, p.to);
            sliceCacheRef.current.set(cacheKey, { ts: Date.now(), cells: nextCells });
            rangeHasFreeRef.current.set(
              String(p.from) + "-" + String(p.to),
              nextCells.some((c) => String(c.kind) === "free"),
            );
          }),
        );
        cellByNumberRef.current = rebuildCellByNumberMap(sliceCacheRef.current);
        allSlicesLoadedRef.current = true;
        updateRangeTabMarkersFromCache();
        syncRangeTabsVisibilityRef.current();
        applyCachedRange(rangeFromRef.current, rangeToRef.current, { showLoader: false });
      } catch (e) {
        setGridLoading(false);
        throw e;
      }
    },
    [applyCachedRange, fetchRangeSlice, updateRangeTabMarkersFromCache],
  );

  const loadSlice = useCallback(
    async (opts?: { force?: boolean; showLoader?: boolean }) => {
      const r = raffleRef.current;
      if (!r?.id) return;
      if (opts?.force && sliceCacheRef.current.size === 0) {
        return loadAllSlices(opts);
      }
      const id = Number(r.id);
      const from = rangeFromRef.current;
      const to = rangeToRef.current;
      const force = Boolean(opts?.force);
      const showLoader = opts?.showLoader !== false;
      const cacheKey = sliceCacheKey(id, from, to);
      if (!force) {
        if (applyCachedRange(from, to, { showLoader })) {
          syncRangeTabsVisibilityRef.current();
          return;
        }
      }
      if (showLoader) {
        setCells([]);
        setGridLoading(true);
      }
      try {
        const nextCells = await fetchRangeSlice(id, from, to);
        sliceCacheRef.current.set(cacheKey, { ts: Date.now(), cells: nextCells });
        const key = String(from) + "-" + String(to);
        rangeHasFreeRef.current.set(key, nextCells.some((c) => String(c.kind) === "free"));
        cellByNumberRef.current = rebuildCellByNumberMap(sliceCacheRef.current);
        updateRangeTabMarkersFromCache();
        setCells(nextCells);
        setGridLoading(false);
        syncRangeTabsVisibilityRef.current();
      } catch (e) {
        setGridLoading(false);
        throw e;
      }
    },
    [applyCachedRange, fetchRangeSlice, loadAllSlices, updateRangeTabMarkersFromCache],
  );

  const syncOrder = useCallback(async () => {
    const r = raffleRef.current;
    if (!r?.id) return;
    const id = Number(r.id);
    const res = await fetch("/api/raffles/" + String(id) + "/order", { cache: "no-store", headers: abAuthHeaders() });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(data.error || "Ошибка"));
    applySkewFromPayload(data);
    const o = (data.order as OrderDto | null) || null;
    const nums = (Array.isArray(data.numbers) ? data.numbers : []) as number[];
    setOrder(o);
    setOrderNumbers(nums);
    const st = String(o?.status || "");
    if (st === "pending_review") {
      setMainStep("wait");
    } else setMainStep("grid");
    if (st === "reserved" && o && Number(o.id) > 0) {
      reserveDraftRef.current = {
        orderId: Number(o.id) || 0,
        amountRub: Number(o.amount_rub ?? 0),
        reservedUntil: Number(o.reserved_until ?? 0),
        numbers: nums.slice(),
        paymentMethod: "collection",
        activeBankCard: null,
      };
    } else if (st !== "reserved") {
      reserveDraftRef.current = null;
    }
    if (st === "reserved" && nums.length) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const x of nums) {
          if (next.size >= RAFFLE_MAX_SELECT) break;
          next.add(x);
        }
        return Array.from(next).sort((a, b) => a - b);
      });
    } else if (st !== "reserved") {
      setSelected((prev) => (prev.length ? [] : prev));
    }
  }, [applySkewFromPayload]);

  const loadSliceRef = useRef(loadSlice);
  loadSliceRef.current = loadSlice;
  const loadAllSlicesRef = useRef(loadAllSlices);
  loadAllSlicesRef.current = loadAllSlices;
  const syncOrderRef = useRef(syncOrder);
  syncOrderRef.current = syncOrder;

  const ensureRaffleActive = useCallback(async () => {
    const r = raffleRef.current;
    if (!r?.id) return;
    try {
      const res = await fetch("/api/raffles/" + String(r.id), { cache: "no-store", headers: abAuthHeaders() });
      const data = (await res.json().catch(() => ({}))) as { raffle?: RaffleDto; error?: string };
      if (!res.ok || !data.raffle || String(data.raffle.status || "") !== "active") {
        toastRef.current("Продажи по этой акции недоступны.", "info");
        if (!onHashRoute) router.replace("/home");
      }
    } catch {
      /* ignore transient ws checks */
    }
  }, [onHashRoute, router]);

  const ensureRaffleActiveRef = useRef(ensureRaffleActive);
  ensureRaffleActiveRef.current = ensureRaffleActive;

  function getFastInputN(): number {
    const inp = document.getElementById("raffle-fast-number") as HTMLInputElement | null;
    if (!inp) return NaN;
    const digits = String(inp.value || "").replace(/\D/g, "");
    const parsed = parseInt(digits, 10);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  const renderFastInputState = useCallback(() => {
    const stateEl = document.getElementById("raffle-fast-state");
    if (!stateEl) return;
    const n = getFastInputN();
    const r = raffleRef.current;
    if (!Number.isFinite(n) || n < 1 || !r?.id) {
      stateEl.innerHTML = "";
      return;
    }
    const maxN = Math.max(1, Math.floor(Number(r.ticket_count) || 1));
    if (n > maxN) {
      stateEl.innerHTML = '<span class="raffle-fast-input__badge raffle-fast-input__badge--invalid">Нет такого</span>';
      return;
    }
    const lk = fastLookupRef.current;
    if (!lk || lk.n !== n) {
      stateEl.innerHTML = '<span class="raffle-fast-input__badge raffle-fast-input__badge--loading">Проверяем…</span>';
      return;
    }
    const kind = String(lk.kind || "");
    if (kind === "free") {
      stateEl.innerHTML =
        '<div class="raffle-fast-input__ok"><span class="raffle-fast-input__free">Свободен</span><button type="button" class="raffle-fast-input__add" id="raffle-fast-add">В корзину</button></div>';
      return;
    }
    if (kind === "self_reserved" || kind === "self_pending" || kind === "self_confirmed") {
      stateEl.innerHTML = '<span class="raffle-fast-input__badge raffle-fast-input__badge--self">Ваш</span>';
      return;
    }
    if (kind === "taken") {
      stateEl.innerHTML = '<span class="raffle-fast-input__badge raffle-fast-input__badge--taken">Занят</span>';
      return;
    }
    if (kind === "error") {
      stateEl.innerHTML = '<span class="raffle-fast-input__badge raffle-fast-input__badge--invalid">Ошибка</span>';
      return;
    }
    stateEl.innerHTML = '<span class="raffle-fast-input__badge raffle-fast-input__badge--invalid">Нет такого</span>';
  }, []);

  const scheduleFastInputLookup = useCallback(() => {
    if (fastLookupTimerRef.current) {
      clearTimeout(fastLookupTimerRef.current);
      fastLookupTimerRef.current = null;
    }
    const r = raffleRef.current;
    const n = getFastInputN();
    if (!r?.id || !Number.isFinite(n) || n < 1) {
      fastLookupRef.current = { n: NaN, kind: null };
      renderFastInputState();
      return;
    }
    const maxN = Math.max(1, Math.floor(Number(r.ticket_count) || 1));
    if (n > maxN) {
      fastLookupRef.current = { n, kind: "invalid" };
      renderFastInputState();
      return;
    }
    const indexed = cellByNumberRef.current.get(n);
    if (indexed) {
      fastLookupRef.current = { n, kind: String(indexed.kind || "invalid") };
      renderFastInputState();
      return;
    }
    if (allSlicesLoadedRef.current) {
      fastLookupRef.current = { n, kind: "invalid" };
      renderFastInputState();
      return;
    }
    fastLookupRef.current = { n, kind: null };
    renderFastInputState();
    fastLookupTimerRef.current = setTimeout(() => {
      fastLookupTimerRef.current = null;
      const cur = getFastInputN();
      if (!Number.isFinite(cur) || cur !== n) return;
      const cell = cellByNumberRef.current.get(n);
      fastLookupRef.current = { n, kind: cell ? String(cell.kind || "invalid") : "invalid" };
      renderFastInputState();
    }, 120);
  }, [renderFastInputState]);

  useEffect(() => {
    if (authCheckInFlight) return;
    if (!session?.token) {
      router.replace("/");
      return;
    }
    if (!raffleId && !hash && !onHashRoute) {
      router.replace("/home");
    }
  }, [session, authCheckInFlight, raffleId, hash, pathname, router]);

  useEffect(() => {
    if (authCheckInFlight) return;
    if (session?.token && !authVerified) {
      router.replace("/");
    }
  }, [session?.token, authVerified, authCheckInFlight, router]);

  useEffect(() => {
    if (!authVerified || !session?.token || (!raffleId && !hash)) return;
    let cancelled = false;
    (async () => {
      try {
        const target = hash ? "/api/raffles/by-hash/" + encodeURIComponent(hash) : "/api/raffles/" + String(raffleId);
        const res = await fetch(target, { cache: "no-store", headers: abAuthHeaders() });
        const data = (await res.json()) as { raffle?: RaffleDto; error?: string };
        if (!res.ok) {
          if (res.status === 401) {
            router.replace("/");
            return;
          }
          if (res.status === 404 && !onHashRoute) {
            router.replace("/home");
            return;
          }
          throw new Error(String(data.error || "Ошибка"));
        }
        const r = data.raffle;
        if (!r || String(r.status) !== "active") {
          if (!onHashRoute) router.replace("/home");
          return;
        }
        if (cancelled) return;
        setLowStockModal(null);
        raffleRef.current = r;
        setRaffle(r);
        const parts = buildRangeParts(Number(r.ticket_count) || 1);
        setRangeParts(parts);
        if (parts[0]) {
          rangeFromRef.current = parts[0].from;
          rangeToRef.current = parts[0].to;
          setRangeFrom(parts[0].from);
          setRangeTo(parts[0].to);
        }
        const h = document.getElementById("raffle-page-heading");
        if (h) h.textContent = String(r.title || "Акция");
        if (typeof document !== "undefined") {
          document.title = r.title ? `Акция — ${String(r.title)}` : "Акция";
        }
        const coverUrl = String(r.cover_image_url || "").trim();
        const heroEl = document.getElementById("raffle-page-hero");
        const coverImg = document.getElementById("raffle-page-cover-img") as HTMLImageElement | null;
        if (heroEl) heroEl.classList.toggle("raffle-purchase-hero--no-cover", !coverUrl);
        if (coverImg) {
          if (coverUrl) {
            coverImg.src = coverUrl;
            coverImg.hidden = false;
          } else {
            coverImg.removeAttribute("src");
            coverImg.hidden = true;
          }
        }
        const badge = document.getElementById("raffle-page-price-badge");
        if (badge) {
          const pr = Number(r.price_rub ?? 0);
          badge.textContent = "БИЛЕТ: " + formatRub(pr) + " ₽";
          badge.hidden = false;
        }
        const tabs = document.getElementById("raffle-page-tabs");
        if (tabs) {
          tabs.innerHTML = parts
            .map((p) => {
              const label = String(p.from) + "–" + String(p.to);
              return (
                '<button type="button" role="tab" class="raffle-range-tab" data-from="' +
                String(p.from) +
                '" data-to="' +
                String(p.to) +
                '">' +
                esc(label) +
                "</button>"
              );
            })
            .join("");
          for (const p of parts) {
            const key = String(p.from) + "-" + String(p.to);
            const known = rangeHasFreeRef.current.get(key);
            if (known == null) continue;
            const btn = tabs.querySelector(`.raffle-range-tab[data-from="${p.from}"][data-to="${p.to}"]`) as HTMLElement | null;
            if (btn) btn.classList.toggle("raffle-range-tab--no-free", !known);
          }
          syncRangeTabsVisibilityRef.current();
        }
        const draftKeyId = Number(r.id || raffleId);
        try {
          const raw = localStorage.getItem(DRAFT_PREFIX + String(draftKeyId));
          if (raw) {
            const arr = JSON.parse(raw) as unknown;
            if (Array.isArray(arr)) {
              const nums = arr.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
              setSelected(nums.slice(0, RAFFLE_MAX_SELECT));
            }
          }
        } catch {
          /* ignore */
        }
        await syncOrderRef.current();
        allSlicesLoadedRef.current = false;
        cellByNumberRef.current = new Map();
        sliceCacheRef.current.clear();
        rangeHasFreeRef.current.clear();
        await loadAllSlicesRef.current({ parts });
        finishRaffleGridBootstrap(parts, Number(r.id));
        if (
          shouldAutoOpenPayment &&
          !autoOpenPaymentTriggeredRef.current &&
          reserveDraftRef.current?.orderId &&
          Number(reserveDraftRef.current.orderId) > 0
        ) {
          autoOpenPaymentTriggeredRef.current = true;
          window.setTimeout(() => {
            void armPaymentRef.current?.();
          }, 30);
        }
      } catch (e) {
        toast(String((e as Error).message || "Ошибка"), "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authVerified, session?.token, raffleId, hash, router, toast, shouldAutoOpenPayment, onHashRoute, finishRaffleGridBootstrap]);

  useEffect(() => {
    const grid = document.getElementById("raffle-page-grid");
    if (!grid) return;
    grid.classList.toggle("raffle-ticket-grid--loading", gridLoading);
    if (gridLoading) {
      grid.innerHTML = renderRaffleGridLoaderHtml();
      return;
    }
    grid.innerHTML = renderRaffleGridHtml(cells, selectedSet, onlyFreeView);
  }, [cells, selectedSet, onlyFreeView, gridLoading]);

  useEffect(() => {
    const rid = Number(raffle?.id || raffleId);
    if (!rid) return;
    persistDraft(rid, selected);
  }, [selected, raffle?.id, raffleId, persistDraft]);

  const renderCartBody = useCallback(() => {
    const root = document.getElementById("modal-cart-numbers-root");
    const btn = document.getElementById("modal-cart-checkout") as HTMLButtonElement | null;
    const lab = document.getElementById("modal-cart-checkout-label");
    const sum = document.getElementById("modal-cart-summary");
    const hint = document.getElementById("modal-cart-multi-hint");
    const clearAll = document.getElementById("modal-cart-clear-all") as HTMLButtonElement | null;
    if (!root || !raffle?.id) return;
    const draft = selected.slice().sort((a, b) => a - b);
    const rid = Number(raffle.id);
    if (!draft.length) {
      syncCartFlowRail(0);
      root.innerHTML =
        '<div class="cart-modal__chips-row">' +
        '<button type="button" class="cart-modal__add-slot" data-cart-add-more="1" aria-label="Добавить номерки">+</button></div>';
      if (btn) {
        btn.disabled = true;
        btn.removeAttribute("data-checkout-raffle-id");
      }
      if (lab) lab.textContent = "Выберите номерки";
      if (sum) {
        sum.hidden = true;
        sum.textContent = "";
      }
      if (hint) {
        hint.hidden = true;
        hint.textContent = "";
      }
      if (clearAll) clearAll.hidden = true;
      return;
    }
    const chipSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    let html = '<div class="cart-modal__chips-row">';
    for (const n of draft) {
      html +=
        '<div class="cart-modal__chip">' +
        '<button type="button" class="cart-modal__chip-remove" data-cart-draft-remove="1" data-ticket="' +
        String(n) +
        '" aria-label="Убрать">' +
        chipSvg +
        "</button>" +
        '<button type="button" class="cart-modal__chip-num" data-cart-draft-remove="1" data-ticket="' +
        String(n) +
        '">' +
        esc(String(n)) +
        "</button></div>";
    }
    html +=
      '<button type="button" class="cart-modal__add-slot" data-cart-add-more="1" aria-label="Добавить номерки">+</button></div>';
    root.innerHTML = html;
    syncCartFlowRail(draft.length);
    if (btn) {
      btn.disabled = false;
      btn.setAttribute("data-checkout-raffle-id", String(rid));
    }
    if (lab) lab.textContent = "Далее — к оплате";
    const price = Number(raffle.price_rub ?? 0);
    const total = draft.length * price;
    if (sum) {
      sum.hidden = false;
      sum.textContent = "К оплате: " + formatRub(total) + " ₽, номерков: " + String(draft.length);
    }
    if (hint) {
      hint.hidden = true;
      hint.textContent = "";
    }
    if (clearAll) clearAll.hidden = draft.length < 3;
  }, [raffle, selected]);

  useEffect(() => {
    if (!cartOpen) return;
    renderCartBody();
  }, [cartOpen, selected, raffle, renderCartBody]);

  const openCart = useCallback(() => {
    const sheet = document.getElementById("modal-cart-sheet");
    const ttl = document.getElementById("modal-cart-title");
    if (sheet) {
      sheet.classList.add("cart-sheet--context-raffle");
      sheet.classList.remove("cart-sheet--context-home");
    }
    if (ttl) ttl.textContent = "Ваши номерки";
    renderCartBody();
    openOverlay(document.getElementById("modal-cart"));
    setCartOpen(true);
  }, [renderCartBody]);

  const closeCart = useCallback(() => {
    closeOverlay(document.getElementById("modal-cart"));
    setCartOpen(false);
    setCheckoutLoading(false);
  }, []);

  const openSearchSheet = useCallback(() => {
    const modal = document.getElementById("modal-ticket-search");
    const inp = document.getElementById("ticket-search-input") as HTMLInputElement | null;
    const finp = document.getElementById("raffle-fast-number") as HTMLInputElement | null;
    if (inp && finp) inp.value = String(finp.value || "").replace(/\D/g, "");
    openOverlay(modal);
    setTimeout(() => inp?.focus(), 20);
  }, []);

  const stripVisible =
    authVerified &&
    !!session?.token &&
    !cartOpen &&
    !navHiddenByInput &&
    ((!!order && String(order.status || "") === "reserved") || (!order && selected.length > 0));

  useEffect(() => {
    const strip = document.getElementById("cart-action-strip");
    const title = document.getElementById("cart-action-strip-title");
    const sub = document.getElementById("cart-action-strip-sub");
    if (!strip) return;
    if (stripVisible) {
      strip.classList.add("cart-action-strip--visible");
      strip.setAttribute("aria-hidden", "false");
      document.documentElement.classList.add("has-cart-action-strip");
      const isReserved = !!(order && String(order.status || "") === "reserved");
      if (isReserved) {
        const n = Array.isArray(orderNumbers) ? orderNumbers.length : 0;
        if (title) title.textContent = "Завершить оплату";
        if (sub) sub.textContent = n > 0 ? "Ваши номерки: " + String(n) : "Продолжить по заказу";
        strip.classList.add("cart-action-strip--home-pending-pay");
      } else {
        if (title) title.textContent = "Забронировать (" + String(selected.length) + ")";
        if (sub) sub.textContent = "Выбрано: " + String(selected.length) + " / " + String(RAFFLE_MAX_SELECT);
        strip.classList.remove("cart-action-strip--home-pending-pay");
      }
    } else {
      strip.classList.remove("cart-action-strip--visible", "cart-action-strip--pulse", "cart-action-strip--home-pending-pay");
      strip.setAttribute("aria-hidden", "true");
      document.documentElement.classList.remove("has-cart-action-strip");
    }
  }, [stripVisible, selected.length, order, orderNumbers]);

  useEffect(() => {
    const onTabs = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest?.(".raffle-range-tab") as HTMLElement | null;
      if (!t) return;
      const from = Number(t.getAttribute("data-from"));
      const to = Number(t.getAttribute("data-to"));
      if (!Number.isFinite(from) || !Number.isFinite(to)) return;
      if (from === rangeFromRef.current && to === rangeToRef.current) {
        return;
      }
      switchRangeTab(from, to);
    };
    const tabs = document.getElementById("raffle-page-tabs");
    tabs?.addEventListener("click", onTabs);
    return () => tabs?.removeEventListener("click", onTabs);
  }, [switchRangeTab]);

  useEffect(() => {
    allSlicesLoadedRef.current = false;
    cellByNumberRef.current = new Map();
    sliceCacheRef.current.clear();
    rangeHasFreeRef.current.clear();
  }, [raffle?.id]);

  const selectionSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushSelection = useCallback(async () => {
    if (!raffle?.id) return;
    const rid = Number(raffle.id);
    const desired = selected.slice().sort((a, b) => a - b);
    const o = order;
    const isReserved = !!(o && String(o.status || "") === "reserved" && Number(o.id) > 0);
    if (!isReserved) return;
    const oid = Number(o!.id);
    let cur = orderNumbers.slice();
    try {
      let reload = false;
      const curSet = new Set(cur);
      const desiredSet = new Set(desired);
      const toAdd = desired.filter((n) => !curSet.has(n));
      const toRemove = cur.filter((n) => !desiredSet.has(n));
      if (toAdd.length) {
        reload = true;
        const added = await abApiJson<{ order?: OrderDto; numbers?: number[]; server_time_ms?: number }>(
          "/api/raffles/orders/" + String(oid) + "/add-tickets",
          { method: "POST", headers: { ...abAuthHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ numbers: toAdd }) },
        );
        applySkewFromPayload(added as Record<string, unknown>);
        if (added.order) setOrder(added.order as OrderDto);
        if (Array.isArray(added.numbers)) {
          cur = added.numbers;
          setOrderNumbers(cur);
        }
      }
      for (const n of toRemove) {
        reload = true;
        const removed = await abApiJson<{ order?: OrderDto | null; numbers?: number[]; server_time_ms?: number }>(
          "/api/raffles/orders/" + String(oid) + "/tickets/" + String(n),
          { method: "DELETE", headers: abAuthHeaders() },
        );
        applySkewFromPayload(removed as Record<string, unknown>);
        setOrder((removed.order as OrderDto) || null);
        setOrderNumbers(Array.isArray(removed.numbers) ? removed.numbers : []);
        cur = Array.isArray(removed.numbers) ? removed.numbers.slice() : [];
      }
      if (reload) void loadAllSlicesRef.current({ force: true, showLoader: false });
    } catch {
      /* silent */
    }
  }, [raffle?.id, order, orderNumbers, selected, applySkewFromPayload]);

  const scheduleSelectionSync = useCallback(() => {
    if (selectionSyncTimer.current) clearTimeout(selectionSyncTimer.current);
    selectionSyncTimer.current = setTimeout(() => {
      void flushSelection();
    }, 220);
  }, [flushSelection]);

  useEffect(() => {
    const inp = document.getElementById("raffle-fast-number") as HTMLInputElement | null;
    if (!inp) return;
    const onFocus = () => {
      setNavHiddenByInput(true);
      document.documentElement.classList.add("bottom-nav-hidden-by-fast-input");
    };
    const onBlur = () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active && active.id === "raffle-fast-number") return;
        setNavHiddenByInput(false);
        document.documentElement.classList.remove("bottom-nav-hidden-by-fast-input");
      }, 40);
    };
    const onInput = () => scheduleFastInputLookup();
    inp.addEventListener("focus", onFocus);
    inp.addEventListener("blur", onBlur);
    inp.addEventListener("input", onInput);
    return () => {
      inp.removeEventListener("focus", onFocus);
      inp.removeEventListener("blur", onBlur);
      inp.removeEventListener("input", onInput);
      setNavHiddenByInput(false);
      document.documentElement.classList.remove("bottom-nav-hidden-by-fast-input");
      if (fastLookupTimerRef.current) {
        clearTimeout(fastLookupTimerRef.current);
        fastLookupTimerRef.current = null;
      }
    };
  }, [scheduleFastInputLookup]);

  useEffect(() => {
    const wrap = document.getElementById("raffle-fast-input");
    if (!wrap) return;
    const onWrapClick = (e: MouseEvent) => {
      const addBtn = (e.target as HTMLElement).closest?.("#raffle-fast-add");
      if (!addBtn) return;
      const n = getFastInputN();
      if (!Number.isFinite(n) || n < 1) return;
      if (orderRef.current && String(orderRef.current.status) === "reserved") {
        toastRef.current("Сначала завершите оплату по брони.", "info");
        return;
      }
      if (fastLookupRef.current.n !== n || fastLookupRef.current.kind !== "free") return;
      if (selRef.current.has(n)) {
        toastRef.current("Номер уже в корзине", "warning");
        return;
      }
      if (selRef.current.size >= RAFFLE_MAX_SELECT) {
        toastRef.current("Можно выбрать не более " + String(RAFFLE_MAX_SELECT) + " номерков", "warning");
        return;
      }
      setSelected((prev) => {
        const set = new Set(prev);
        if (set.has(n)) return prev;
        if (set.size >= RAFFLE_MAX_SELECT) return prev;
        set.add(n);
        return Array.from(set).sort((a, b) => a - b);
      });
      scheduleSelectionSync();
      const finp = document.getElementById("raffle-fast-number") as HTMLInputElement | null;
      if (finp) finp.value = "";
      fastLookupRef.current = { n: NaN, kind: null };
      renderFastInputState();
      toastRef.current("Номер " + String(n) + " добавлен в корзину", "success");
    };
    wrap.addEventListener("click", onWrapClick);
    return () => wrap.removeEventListener("click", onWrapClick);
  }, [renderFastInputState, scheduleSelectionSync]);

  useEffect(() => {
    const btn = document.getElementById("raffle-fast-random");
    if (!btn) return;
    const onR = () => {
      if (orderRef.current && String(orderRef.current.status) === "reserved") {
        toastRef.current("Сначала завершите оплату по брони.", "info");
        return;
      }
      const free = collectGlobalFreeNumbers(sliceCacheRef.current, selRef.current);
      if (!free.length) {
        toastRef.current("Свободных номерков в акции нет", "warning");
        return;
      }
      const rnd = free[Math.floor(Math.random() * free.length)];
      if (rnd === undefined) return;
      const maxN = Math.max(1, Math.floor(Number(raffleRef.current?.ticket_count) || 1));
      const part = getRangeTabForTicketN(maxN, rnd);
      if (part) switchRangeTabRef.current(part.from, part.to);
      const finp = document.getElementById("raffle-fast-number") as HTMLInputElement | null;
      if (finp) finp.value = String(rnd);
      fastLookupRef.current = { n: rnd, kind: "free" };
      renderFastInputState();
    };
    btn.addEventListener("click", onR);
    return () => btn.removeEventListener("click", onR);
  }, [renderFastInputState]);

  useEffect(() => {
    if (fastCellsLookupDebounceRef.current) clearTimeout(fastCellsLookupDebounceRef.current);
    fastCellsLookupDebounceRef.current = setTimeout(() => {
      fastCellsLookupDebounceRef.current = null;
      const inp = document.getElementById("raffle-fast-number") as HTMLInputElement | null;
      if (inp && String(inp.value || "").trim()) scheduleFastInputLookup();
    }, 220);
    return () => {
      if (fastCellsLookupDebounceRef.current) clearTimeout(fastCellsLookupDebounceRef.current);
    };
  }, [cells, rangeFrom, rangeTo, scheduleFastInputLookup]);

  useEffect(() => {
    const grid = document.getElementById("raffle-page-grid");
    if (!grid) return;
    const onClick = (e: MouseEvent) => {
      const o = orderRef.current;
      if (o && String(o.status) === "reserved") {
        toast("Сначала завершите оплату по брони.", "info");
        return;
      }
      const btn = (e.target as HTMLElement).closest?.("[data-ticket]") as HTMLElement | null;
      if (!btn) return;
      const kind = btn.getAttribute("data-kind");
      if (kind !== "free" && kind !== "self_reserved") return;
      const n = Number(btn.getAttribute("data-ticket"));
      if (!Number.isFinite(n) || n < 1) return;
      setSelected((prev) => {
        const set = new Set(prev);
        if (set.has(n)) set.delete(n);
        else {
          if (set.size >= RAFFLE_MAX_SELECT) {
            toast("Можно выбрать не более " + String(RAFFLE_MAX_SELECT) + " номерков", "warning");
            return prev;
          }
          set.add(n);
        }
        return Array.from(set).sort((a, b) => a - b);
      });
      scheduleSelectionSync();
    };
    grid.addEventListener("click", onClick);
    return () => grid.removeEventListener("click", onClick);
  }, [toast, scheduleSelectionSync]);

  useEffect(() => {
    const back = document.getElementById("raffle-page-back");
    const onBack = () => {
      router.push("/home");
    };
    back?.addEventListener("click", onBack);
    return () => back?.removeEventListener("click", onBack);
  }, [router]);

  useEffect(() => {
    syncRangeTabsVisibility();
  }, [onlyFreeView, syncRangeTabsVisibility]);

  useEffect(() => {
    const eye = document.getElementById("raffle-page-only-free");
    if (!eye) return;
    const onEye = () => setOnlyFreeViewEnabled(!onlyFreeViewRef.current);
    eye.addEventListener("click", onEye);
    return () => eye.removeEventListener("click", onEye);
  }, [setOnlyFreeViewEnabled]);

  useEffect(() => {
    const g = document.getElementById("raffle-page-step-grid");
    const w = document.getElementById("raffle-page-step-wait");
    if (g) g.hidden = mainStep !== "grid";
    if (w) w.hidden = mainStep !== "wait";
  }, [mainStep]);

  useEffect(() => {
    const EDGE = 14;
    const TOP_HINT_LATCH_IN = 18;
    const TOP_HINT_LATCH_OUT = 44;
    const BOTTOM_HINT_LATCH_IN = 18;
    const BOTTOM_HINT_LATCH_OUT = 44;
    const PULL_TRIGGER = 56;
    const COOLDOWN_MS = 550;
    const WHEEL_ACC_TRIGGER = 96;

    let cooldownUntil = 0;
    let touchStartY = 0;
    let maxPullDown = 0;
    let maxPullUp = 0;
    let rafHints = false;
    let wheelAccTop = 0;
    let wheelAccBottom = 0;
    let topHintLatched = false;
    let bottomHintLatched = false;
    let lastHintTopText = "";
    let lastHintBottomText = "";
    let lastHintShowTop = false;
    let lastHintShowBottom = false;
    let rangeSwipeAlreadyFired = false;

    function wheelDeltaPixels(e: WheelEvent): number {
      const y = e.deltaY;
      if (e.deltaMode === 1) return Math.abs(y) * 16;
      if (e.deltaMode === 2) return Math.abs(y) * (window.innerHeight || 600);
      return Math.abs(y);
    }

    function scrollTopNow() {
      return window.scrollY || document.documentElement.scrollTop;
    }

    function docMetrics() {
      const doc = document.documentElement;
      const st = scrollTopNow();
      const vh = window.innerHeight;
      const sh = doc.scrollHeight;
      const maxScroll = Math.max(0, sh - vh);
      const fitsOneScreen = maxScroll <= EDGE;
      const atTop = st <= EDGE;
      const atBottom = fitsOneScreen ? false : st >= maxScroll - EDGE;
      const distBottom = maxScroll - st;
      return { st, vh, sh, maxScroll, fitsOneScreen, atTop, atBottom, distBottom };
    }

    function getAdjacentParts() {
      const parts = rangePartsRef.current;
      const from = rangeFromRef.current;
      const to = rangeToRef.current;
      const idx = parts.findIndex((p) => p.from === from && p.to === to);
      const prevPart = idx > 0 ? parts[idx - 1] : null;
      const nextPart = idx >= 0 && idx < parts.length - 1 ? parts[idx + 1] : null;
      return { prevPart, nextPart };
    }

    function updateHints() {
      const topEl = document.getElementById("raffle-range-hint-top");
      const bottomEl = document.getElementById("raffle-range-hint-bottom");
      const textTop = document.getElementById("raffle-range-hint-top-text");
      const textBottom = document.getElementById("raffle-range-hint-bottom-text");
      if (!topEl || !bottomEl) return;

      if (mainStepRef.current !== "grid" || gridLoadingRef.current) {
        topHintLatched = false;
        bottomHintLatched = false;
        lastHintShowTop = false;
        lastHintShowBottom = false;
        lastHintTopText = "";
        lastHintBottomText = "";
        topEl.classList.remove("raffle-range-swipe-hint--visible");
        bottomEl.classList.remove("raffle-range-swipe-hint--visible");
        topEl.setAttribute("aria-hidden", "true");
        bottomEl.setAttribute("aria-hidden", "true");
        return;
      }

      const { prevPart, nextPart } = getAdjacentParts();
      const { st, maxScroll, fitsOneScreen, distBottom } = docMetrics();

      if (!prevPart) topHintLatched = false;
      else {
        if (st <= TOP_HINT_LATCH_IN) topHintLatched = true;
        else if (st > TOP_HINT_LATCH_OUT) topHintLatched = false;
      }

      if (!nextPart || fitsOneScreen) bottomHintLatched = false;
      else {
        if (distBottom <= BOTTOM_HINT_LATCH_IN) bottomHintLatched = true;
        else if (distBottom > BOTTOM_HINT_LATCH_OUT) bottomHintLatched = false;
      }

      const nextTopText = prevPart
        ? "👆 Потяните вниз (свайп), чтобы открыть " + String(prevPart.from) + "–" + String(prevPart.to)
        : "";
      const nextBottomText = nextPart
        ? "Потяните вверх (свайп), чтобы открыть " + String(nextPart.from) + "–" + String(nextPart.to) + " 👇"
        : "";

      const showTop = !!prevPart && topHintLatched;
      const showBottom = !!nextPart && bottomHintLatched;

      if (textTop && nextTopText && nextTopText !== lastHintTopText) {
        textTop.textContent = nextTopText;
        lastHintTopText = nextTopText;
      }
      if (textBottom && nextBottomText && nextBottomText !== lastHintBottomText) {
        textBottom.textContent = nextBottomText;
        lastHintBottomText = nextBottomText;
      }

      if (showTop !== lastHintShowTop) {
        topEl.classList.toggle("raffle-range-swipe-hint--visible", showTop);
        topEl.setAttribute("aria-hidden", showTop ? "false" : "true");
        lastHintShowTop = showTop;
      }
      if (showBottom !== lastHintShowBottom) {
        bottomEl.classList.toggle("raffle-range-swipe-hint--visible", showBottom);
        bottomEl.setAttribute("aria-hidden", showBottom ? "false" : "true");
        lastHintShowBottom = showBottom;
      }
    }

    function scheduleHints() {
      if (rafHints) return;
      rafHints = true;
      requestAnimationFrame(() => {
        rafHints = false;
        updateHints();
      });
    }

    syncRaffleSwipeHintsRef.current = updateHints;

    function goAdjacent(dir: "prev" | "next"): boolean {
      if (Date.now() < cooldownUntil || gridLoadingRef.current || mainStepRef.current !== "grid") return false;
      const { prevPart, nextPart } = getAdjacentParts();
      const target = dir === "prev" ? prevPart : nextPart;
      if (!target) return false;
      const btn = document.querySelector(
        `.raffle-range-tab[data-from="${target.from}"][data-to="${target.to}"]`,
      ) as HTMLElement | null;
      if (!btn) return false;
      cooldownUntil = Date.now() + COOLDOWN_MS;
      btn.click();
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      return true;
    }

    function resetPullUi() {
      const topHint = document.getElementById("raffle-range-hint-top");
      const bottomHint = document.getElementById("raffle-range-hint-bottom");
      const fillTop = document.getElementById("raffle-range-pull-fill-top");
      const fillBottom = document.getElementById("raffle-range-pull-fill-bottom");
      if (fillTop) fillTop.style.transform = "scaleX(0)";
      if (fillBottom) fillBottom.style.transform = "scaleX(0)";
      topHint?.classList.remove("raffle-range-swipe-hint--pull-active");
      bottomHint?.classList.remove("raffle-range-swipe-hint--pull-active");
    }

    function setPullUi(which: "top" | "bottom" | "none", ratio: number) {
      const topHint = document.getElementById("raffle-range-hint-top");
      const bottomHint = document.getElementById("raffle-range-hint-bottom");
      const fillTop = document.getElementById("raffle-range-pull-fill-top");
      const fillBottom = document.getElementById("raffle-range-pull-fill-bottom");
      const r = Math.min(1.08, Math.max(0, ratio));
      if (which !== "top" && fillTop) fillTop.style.transform = "scaleX(0)";
      if (which !== "bottom" && fillBottom) fillBottom.style.transform = "scaleX(0)";
      if (which !== "top") topHint?.classList.remove("raffle-range-swipe-hint--pull-active");
      if (which !== "bottom") bottomHint?.classList.remove("raffle-range-swipe-hint--pull-active");
      if (which === "top" && fillTop && topHint) {
        fillTop.style.transform = `scaleX(${r})`;
        if (r > 0.02) topHint.classList.add("raffle-range-swipe-hint--pull-active");
      }
      if (which === "bottom" && fillBottom && bottomHint) {
        fillBottom.style.transform = `scaleX(${r})`;
        if (r > 0.02) bottomHint.classList.add("raffle-range-swipe-hint--pull-active");
      }
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      touchStartY = e.touches[0].clientY;
      maxPullDown = 0;
      maxPullUp = 0;
      rangeSwipeAlreadyFired = false;
      resetPullUi();
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      if (rangeSwipeAlreadyFired) return;
      if (Date.now() < cooldownUntil || gridLoadingRef.current || mainStepRef.current !== "grid") {
        setPullUi("none", 0);
        return;
      }
      const y = e.touches[0].clientY;
      const { atTop, atBottom } = docMetrics();
      const { prevPart, nextPart } = getAdjacentParts();

      if (atTop && prevPart && y > touchStartY) {
        const d = y - touchStartY;
        maxPullDown = Math.max(maxPullDown, d);
        const ratio = d / PULL_TRIGGER;
        setPullUi("top", ratio);
        if (ratio >= 1) {
          if (goAdjacent("prev")) {
            rangeSwipeAlreadyFired = true;
            resetPullUi();
          }
        }
        return;
      }

      if (atBottom && nextPart && y < touchStartY) {
        const d = touchStartY - y;
        maxPullUp = Math.max(maxPullUp, d);
        const ratio = d / PULL_TRIGGER;
        setPullUi("bottom", ratio);
        if (ratio >= 1) {
          if (goAdjacent("next")) {
            rangeSwipeAlreadyFired = true;
            resetPullUi();
          }
        }
        return;
      }

      maxPullDown = 0;
      maxPullUp = 0;
      setPullUi("none", 0);
    }

    function onTouchEnd() {
      const savedPullDown = maxPullDown;
      const savedPullUp = maxPullUp;
      resetPullUi();
      maxPullDown = 0;
      maxPullUp = 0;

      if (Date.now() < cooldownUntil || gridLoadingRef.current) {
        rangeSwipeAlreadyFired = false;
        scheduleHints();
        return;
      }

      if (rangeSwipeAlreadyFired) {
        rangeSwipeAlreadyFired = false;
        scheduleHints();
        return;
      }

      const { atTop, atBottom } = docMetrics();
      const { prevPart, nextPart } = getAdjacentParts();
      if (atTop && savedPullDown >= PULL_TRIGGER && prevPart) {
        goAdjacent("prev");
      } else if (atBottom && savedPullUp >= PULL_TRIGGER && nextPart) {
        goAdjacent("next");
      }
      scheduleHints();
    }

    function onTouchCancel() {
      resetPullUi();
      maxPullDown = 0;
      maxPullUp = 0;
      rangeSwipeAlreadyFired = false;
      scheduleHints();
    }

    function onWheel(e: WheelEvent) {
      if (Date.now() < cooldownUntil || gridLoadingRef.current || mainStepRef.current !== "grid") return;

      const { atTop, atBottom } = docMetrics();
      const { prevPart, nextPart } = getAdjacentParts();
      const dy = wheelDeltaPixels(e);
      const sign = e.deltaY === 0 ? 0 : e.deltaY > 0 ? 1 : -1;

      if (!atTop) wheelAccTop = 0;
      if (!atBottom) wheelAccBottom = 0;

      if (atTop && prevPart) {
        if (sign < 0) {
          wheelAccTop += dy;
          wheelAccBottom = 0;
          if (wheelAccTop >= WHEEL_ACC_TRIGGER) {
            wheelAccTop = 0;
            void goAdjacent("prev");
          }
        } else {
          wheelAccTop = 0;
        }
      } else {
        wheelAccTop = 0;
      }

      if (atBottom && nextPart) {
        if (sign > 0) {
          wheelAccBottom += dy;
          if (wheelAccBottom >= WHEEL_ACC_TRIGGER) {
            wheelAccBottom = 0;
            void goAdjacent("next");
          }
        } else {
          wheelAccBottom = 0;
        }
      } else {
        wheelAccBottom = 0;
      }

      scheduleHints();
    }

    window.addEventListener("scroll", scheduleHints, { passive: true });
    window.addEventListener("resize", scheduleHints, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });

    scheduleHints();

    return () => {
      window.removeEventListener("scroll", scheduleHints);
      window.removeEventListener("resize", scheduleHints);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
      window.removeEventListener("wheel", onWheel);
      syncRaffleSwipeHintsRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    syncRaffleSwipeHintsRef.current();
  }, [rangeFrom, rangeTo, rangeParts, mainStep, gridLoading]);

  useEffect(() => {
    const btn = document.getElementById("cart-action-strip-btn");
    if (!btn) return;
    const onStrip = () => {
      if (!loadAbSession()?.token) {
        toast("Войдите, чтобы бронировать.", "warning");
        return;
      }
      if (orderRef.current && String(orderRef.current.status || "") === "reserved") {
        const ord = orderRef.current;
        const nums = orderNumbers.slice().sort((a, b) => a - b);
        reserveDraftRef.current = {
          orderId: Number(ord?.id) || 0,
          amountRub: Number(ord?.amount_rub ?? 0),
          reservedUntil: Number(ord?.reserved_until ?? 0),
          numbers: nums,
          paymentMethod: "collection",
          activeBankCard: null,
        };
        void armPaymentRef.current?.();
        return;
      }
      openCart();
    };
    btn.addEventListener("click", onStrip);
    return () => btn.removeEventListener("click", onStrip);
  }, [openCart, toast, orderNumbers]);

  useEffect(() => {
    const mc = document.getElementById("modal-cart");
    const closeBtn = document.getElementById("modal-cart-close");
    if (!mc) return;
    const onMc = (e: MouseEvent) => {
      if (e.target === mc) closeCart();
      const add = (e.target as HTMLElement).closest?.("[data-cart-add-more]");
      if (add) {
        e.preventDefault();
        closeCart();
        window.setTimeout(() => {
          openSearchSheet();
        }, 40);
        return;
      }
      const rm = (e.target as HTMLElement).closest?.("[data-cart-draft-remove]") as HTMLElement | null;
      if (!rm) return;
      e.preventDefault();
      const n = Number(rm.getAttribute("data-ticket"));
      if (!Number.isFinite(n)) return;
      setSelected((p) => p.filter((x) => x !== n));
      scheduleSelectionSync();
    };
    mc.addEventListener("click", onMc);
    closeBtn?.addEventListener("click", closeCart);
    return () => {
      mc.removeEventListener("click", onMc);
      closeBtn?.removeEventListener("click", closeCart);
    };
  }, [closeCart, scheduleSelectionSync, renderCartBody, openSearchSheet]);

  useEffect(() => {
    const clearBtn = document.getElementById("modal-cart-clear-all");
    if (!clearBtn) return;
    const onClear = () => {
      const rid = Number(raffle?.id || raffleId);
      setSelected([]);
      if (rid) persistDraft(rid, []);
      void fetch("/api/raffles/cart/clear", { method: "POST", headers: abAuthHeaders() }).catch(() => {});
      void loadAllSlicesRef.current({ force: true, showLoader: false });
    };
    clearBtn.addEventListener("click", onClear);
    return () => clearBtn.removeEventListener("click", onClear);
  }, [raffle?.id, raffleId, persistDraft, renderCartBody]);

  useEffect(() => {
    const co = document.getElementById("modal-cart-checkout");
    if (!co || !raffle?.id) return;
    const onCheckout = async () => {
      const btn = co as HTMLButtonElement;
      const rid = Number(btn.getAttribute("data-checkout-raffle-id"));
      if (!Number.isFinite(rid) || rid < 1 || btn.classList.contains("cart-sheet__cta--loading")) return;
      const nums = selected.slice().sort((a, b) => a - b);
      if (!nums.length) return;
      setCheckoutLoading(true);
      btn.classList.add("cart-sheet__cta--loading");
      const sp = document.getElementById("modal-cart-checkout-spinner");
      if (sp) sp.hidden = false;
      try {
        const data = await abApiJson<{ order?: OrderDto; numbers?: number[]; server_time_ms?: number; payment_participation?: unknown }>(
          "/api/raffles/" + String(rid) + "/reserve",
          { method: "POST", headers: { ...abAuthHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ numbers: nums }) },
        );
        applySkewFromPayload(data as Record<string, unknown>);
        setOrder((data.order as OrderDto) || null);
        setOrderNumbers(Array.isArray(data.numbers) ? (data.numbers as number[]) : []);
        setSelected([]);
        persistDraft(rid, []);
        closeCart();
        const ord = data.order as OrderDto;
        const numsF = (data.numbers as number[]) || [];
        reserveDraftRef.current = {
          orderId: Number(ord?.id) || 0,
          amountRub: Number(ord?.amount_rub ?? 0),
          reservedUntil: Number(ord?.reserved_until ?? 0),
          numbers: numsF,
          paymentMethod: "collection",
          activeBankCard: null,
        };
        void loadAllSlicesRef.current({ force: true, showLoader: false });
        await armPaymentRef.current?.();
      } catch (e) {
        const msg = e instanceof AbApiError && e.status === 401 ? "Войдите снова." : String((e as Error).message || "Ошибка");
        toast(msg, "error");
      } finally {
        setCheckoutLoading(false);
        btn.classList.remove("cart-sheet__cta--loading");
        const sp = document.getElementById("modal-cart-checkout-spinner");
        if (sp) sp.hidden = true;
      }
    };
    co.addEventListener("click", onCheckout);
    return () => co.removeEventListener("click", onCheckout);
  }, [raffle?.id, selected, applySkewFromPayload, closeCart, persistDraft, toast]);

  const raffleIdRef = useRef(raffleId);
  raffleIdRef.current = Number(raffle?.id || raffleId);

  const clearPayTimer = useCallback(() => {
    if (payTimerRef.current) {
      clearInterval(payTimerRef.current);
      payTimerRef.current = null;
    }
  }, []);

  const armPaymentRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!session?.token || !authVerified) return;
    const onUserWs = (ev: Event) => {
      const d = (ev as CustomEvent<{ type?: string; raffle_id?: number }>).detail;
      if (!d || typeof d !== "object") return;
      const rid = raffleIdRef.current;
      if (d.type === "raffle_grid_updated" && Number(d.raffle_id) === rid) {
        allSlicesLoadedRef.current = false;
        sliceCacheRef.current.clear();
        rangeHasFreeRef.current.clear();
        void loadAllSlicesRef.current({ force: true, showLoader: false });
        void syncOrderRef.current();
      }
      if (d.type === "raffle_tickets_updated") {
        if (d.raffle_id != null && Number(d.raffle_id) !== rid) return;
        allSlicesLoadedRef.current = false;
        sliceCacheRef.current.clear();
        rangeHasFreeRef.current.clear();
        void loadAllSlicesRef.current({ force: true, showLoader: false });
        void syncOrderRef.current();
      }
      if (d.type === "raffles_feed_updated") {
        void ensureRaffleActiveRef.current();
      }
    };
    window.addEventListener(AB_USER_WS_EVENT, onUserWs as EventListener);
    return () => window.removeEventListener(AB_USER_WS_EVENT, onUserWs as EventListener);
  }, [session?.token, authVerified]);

  useEffect(() => {
    if (!authVerified && authCheckInFlight) return;
    const syncPaySheetFlow = (phase: "pay" | "receipt") => {
      const nav = document.getElementById("pay-sheet-flow-rail");
      if (!nav) return;
      nav.querySelectorAll("[data-pay-flow-step]").forEach((node) => {
        const k = node.getAttribute("data-pay-flow-step");
        const bubble = node.querySelector(".pay-sheet-flow-rail__bubble");
        node.classList.remove("is-done", "is-current", "is-upcoming");
        if (phase === "pay") {
          if (k === "pick" || k === "cart") {
            node.classList.add("is-done");
            if (bubble) bubble.textContent = "✓";
          } else if (k === "pay") {
            node.classList.add("is-current");
            if (bubble) bubble.textContent = "💳";
          } else {
            node.classList.add("is-upcoming");
            if (bubble) bubble.textContent = "✅";
          }
        } else {
          if (k === "pick" || k === "cart" || k === "pay") {
            node.classList.add("is-done");
            if (bubble) bubble.textContent = "✓";
          } else if (k === "receipt") {
            node.classList.add("is-current");
            if (bubble) bubble.textContent = "✅";
          }
        }
      });
      nav.querySelectorAll("[data-pay-flow-connector]").forEach((node, i) => {
        if (phase === "pay") node.classList.toggle("is-filled", i < 2);
        else node.classList.toggle("is-filled", i < 3);
      });
    };

    const buildAltPayModes = (r: RaffleDto, ticketCount: number): string[] => {
      const { hasCol, hasTbank, hasQr } = getRafflePayChannelFlags(r);
      const scope = String(r.card_payment_scope || "unlimited").toLowerCase();
      const everyN = Math.max(1, Math.floor(Number(r.wholesale_every_n_tickets) || 10));
      const minCardM = Math.max(1, Math.floor(Number(r.card_payment_min_tickets) || 2));
      const wholesaleOk = scope !== "wholesale_only" || ticketCount >= everyN;
      const minOrderOk = scope !== "min_order_tickets" || ticketCount >= minCardM;
      const hasBankCards = Boolean(r.has_bank_cards) && wholesaleOk && minOrderOk;
      const modes: string[] = [];
      if (hasQr) modes.push("qr");
      if (hasBankCards) modes.push("bank_card");
      if (hasTbank) modes.push("tbank_collection");
      if (hasCol) modes.push("collection");
      return modes;
    };

    const paintReservePayment = (
      r: RaffleDto,
      method: "collection" | "tbank_collection" | "qr" | "bank_card",
      bankCard?: { card_number: string; recipient: string } | null,
    ) => {
      const purpose = String(r.qr_payment_purpose || "Оплата услуг").trim() || "Оплата услуг";
      const elPurT = document.getElementById("reserve-payment-purpose-tbank");
      const elQrPur = document.getElementById("reserve-payment-qr-purpose");
      const elQrHint = document.getElementById("reserve-payment-qr-purpose-hint");
      if (elPurT) elPurT.textContent = purpose;
      if (elQrPur) elQrPur.textContent = purpose;
      if (elQrHint) elQrHint.textContent = "«" + purpose + "»";
      const elInstrPur = document.getElementById("reserve-pay-instr-purpose");
      if (elInstrPur) elInstrPur.textContent = purpose;
      const dAmt = reserveDraftRef.current?.amountRub;
      if (typeof dAmt === "number") {
        document.querySelectorAll(".pay-sheet-instr-amt").forEach((el) => {
          el.textContent = formatRub(dAmt) + " ₽";
        });
      }
      const hasCol =
        (r.sber_enabled != null ? Boolean(Number(r.sber_enabled) === 1 || r.sber_enabled === true) : Boolean(String(r.collection_url || "").trim())) &&
        Boolean(String(r.collection_url || "").trim());
      const hasTbank =
        (r.tbank_enabled != null ? Boolean(Number(r.tbank_enabled) === 1 || r.tbank_enabled === true) : Boolean(String(r.tbank_collection_url || "").trim())) &&
        Boolean(String(r.tbank_collection_url || "").trim());
      const hasQr =
        (r.qr_enabled != null ? Boolean(Number(r.qr_enabled) === 1 || r.qr_enabled === true) : Boolean(String(r.qr_image_url || "").trim())) &&
        Boolean(String(r.qr_image_url || "").trim());
      let m = method;
      if (m !== "bank_card") {
        if (m === "collection" && !hasCol) m = hasTbank ? "tbank_collection" : "qr";
        if (m === "tbank_collection" && !hasTbank) m = hasCol ? "collection" : "qr";
        if (m === "qr" && !hasQr) m = hasCol ? "collection" : "tbank_collection";
      }
      const cardResolved =
        bankCard ??
        (m === "bank_card" ? reserveDraftRef.current?.activeBankCard ?? null : null);
      if (reserveDraftRef.current) reserveDraftRef.current.paymentMethod = m;
      const bCol = document.getElementById("reserve-payment-method-collection");
      const bTb = document.getElementById("reserve-payment-method-tbank");
      const bQr = document.getElementById("reserve-payment-method-qr");
      if (bCol) {
        bCol.hidden = !hasCol;
        bCol.classList.toggle("is-active", m === "collection");
        bCol.setAttribute("aria-selected", m === "collection" ? "true" : "false");
      }
      if (bTb) {
        bTb.hidden = !hasTbank;
        bTb.classList.toggle("is-active", m === "tbank_collection");
        bTb.setAttribute("aria-selected", m === "tbank_collection" ? "true" : "false");
      }
      if (bQr) {
        bQr.hidden = !hasQr;
        bQr.classList.toggle("is-active", m === "qr");
        bQr.setAttribute("aria-selected", m === "qr" ? "true" : "false");
      }
      const methEl = document.getElementById("reserve-payment-methods");
      if (methEl) methEl.hidden = true;
      const rec = String(r.sber_collection_recipient || r.collection_recipient || "").trim() || "Реквизиты уточняются";
      const recT = String(r.tbank_collection_recipient || r.collection_recipient || "").trim() || "Реквизиты уточняются";
      const recQr = String(r.qr_recipient || r.collection_recipient || "").trim() || "Реквизиты уточняются";
      const elR = document.getElementById("reserve-payment-recipient");
      const elRT = document.getElementById("reserve-payment-recipient-tbank");
      const elRQ = document.getElementById("reserve-payment-qr-recipient");
      if (elR) elR.textContent = rec;
      if (elRT) elRT.textContent = recT;
      if (elRQ) elRQ.textContent = recQr;
      const href = String(r.collection_url || "").trim();
      const hrefT = String(r.tbank_collection_url || "").trim();
      const a = document.getElementById("reserve-payment-link") as HTMLAnchorElement | null;
      const at = document.getElementById("reserve-payment-link-tbank") as HTMLAnchorElement | null;
      if (a) {
        a.href = href || "#";
        a.setAttribute("aria-disabled", href ? "false" : "true");
        a.classList.toggle("pay-sheet-pay-link--disabled", !href);
      }
      if (at) {
        at.href = hrefT || "#";
        at.setAttribute("aria-disabled", hrefT ? "false" : "true");
        at.classList.toggle("pay-sheet-pay-link--disabled", !hrefT);
      }
      const img = document.getElementById("reserve-payment-qr-image") as HTMLImageElement | null;
      const qr = String(r.qr_image_url || "").trim();
      if (img) {
        if (qr) img.src = qr;
        else img.removeAttribute("src");
      }
      const elBankCard = document.getElementById("reserve-payment-bank-card");
      if (elBankCard) elBankCard.hidden = m !== "bank_card";
      document.getElementById("reserve-payment-collect")!.hidden = m !== "collection";
      document.getElementById("reserve-payment-collect-tbank")!.hidden = m !== "tbank_collection";
      document.getElementById("reserve-payment-qr")!.hidden = m !== "qr";
      const elBn = document.getElementById("reserve-payment-bank-card-number");
      const elBr = document.getElementById("reserve-payment-bank-card-recipient");
      const elBna = document.getElementById("reserve-payment-bank-card-unavailable");
      if (elBn)
        elBn.textContent = cardResolved
          ? formatBankCardForDisplay(String(cardResolved.card_number || ""))
          : "—";
      if (elBr) elBr.textContent = cardResolved ? String(cardResolved.recipient || "").trim() || "—" : "—";
      if (elBna) elBna.hidden = !(m === "bank_card" && !cardResolved);
      const bankBadge = document.getElementById("reserve-payment-collect-bank");
      if (bankBadge) {
        if (m === "collection") bankBadge.textContent = "Сбербанк";
        else if (m === "tbank_collection") bankBadge.textContent = "Тинькофф";
        else if (m === "bank_card") bankBadge.textContent = "Карта";
        else bankBadge.textContent = "QR";
      }
      const rules = String(r.rules_url || "").trim();
      const rw = document.getElementById("reserve-payment-rules-wrap");
      const rl = document.getElementById("reserve-payment-rules-link") as HTMLAnchorElement | null;
      if (rw && rl) {
        rw.hidden = !rules;
        if (rules) rl.href = rules;
      }
      const elStep2Col = document.getElementById("reserve-pay-instr-step2-collection");
      const elStep2Oth = document.getElementById("reserve-pay-instr-step2-other");
      if (elStep2Col && elStep2Oth) {
        const isSberCollection = m === "collection";
        elStep2Col.hidden = !isSberCollection;
        elStep2Oth.hidden = isSberCollection;
      }
      const altBtn = document.getElementById("reserve-payment-alt-requisites");
      const d0 = reserveDraftRef.current;
      const modesN = d0 ? buildAltPayModes(r, d0.numbers.length) : [];
      if (altBtn) altBtn.hidden = modesN.length === 0;
    };

    const switchPayStep = (step: "requisites" | "confirm") => {
      paymentStepRef.current = step;
      const req = document.getElementById("reserve-payment-step-requisites");
      const conf = document.getElementById("reserve-payment-step-confirm");
      const back = document.getElementById("reserve-payment-back");
      const title = document.getElementById("reserve-payment-title");
      const hint = document.getElementById("reserve-payment-phase-hint");
      const fill = document.getElementById("reserve-payment-progress");
      const isC = step === "confirm";
      if (req) req.hidden = isC;
      if (conf) conf.hidden = !isC;
      if (back) back.hidden = !isC;
      if (title) title.textContent = isC ? "Последний шаг — загрузите чек" : "Реквизиты для перевода";
      if (hint) {
        hint.textContent = isC
          ? "Шаг «Чек»: выберите фото или PDF из банка и нажмите «Отправить чек»."
          : "Оплатите сумму ниже, затем нажмите «Я перевёл».";
      }
      if (fill && isC) fill.style.width = "100%";
      paintFlowSteps("reserve-payment-steps", isC ? "confirm" : "requisites");
      syncPaySheetFlow(isC ? "receipt" : "pay");
    };

    const startPayTimer = (untilTs: number) => {
      clearPayTimer();
      let windowTotalMs = 0;
      const tick = () => {
        const left = reservationLeftMsRef.current(untilTs);
        if (windowTotalMs <= 0 && left > 0) windowTotalMs = left;
        const denom = Math.max(windowTotalMs, 1);
        const el = document.getElementById("reserve-payment-timer");
        const fill = document.getElementById("reserve-payment-progress");
        if (el) el.textContent = formatMmSs(left);
        if (fill) fill.style.width = String(Math.max(0, Math.min(100, (left / denom) * 100))) + "%";
        if (left <= 0) {
          clearPayTimer();
          closeOverlay(document.getElementById("modal-reserve-payment"));
          openOverlay(document.getElementById("modal-reserve-expired"));
        }
      };
      tick();
      payTimerRef.current = setInterval(tick, 1000);
    };

    const armPayment = async () => {
      const d = reserveDraftRef.current;
      const r = raffleRef.current;
      if (!d || !r?.id) return;
      altPayCycleRef.current = { modes: [], idx: -1 };
      d.activeBankCard = null;
      d.paymentMethod = "collection";
      closeOverlay(document.getElementById("modal-reserve-success"));
      const amt = d.amountRub;
      document.getElementById("reserve-payment-amount")!.textContent = formatRub(amt);
      document.getElementById("reserve-payment-amount-inline")!.textContent = formatRub(amt) + " ₽";
      document.getElementById("reserve-payment-amount-check")!.textContent = formatRub(amt) + " ₽";
      const stampEl = document.getElementById("reserve-payment-order-stamp");
      if (stampEl) {
        const idn = Math.max(0, Math.floor(Number(d.orderId) || 0));
        stampEl.textContent = idn.toString(16).padStart(8, "0").slice(-8);
      }
      const fullOrd = document.getElementById("reserve-payment-order-id");
      if (fullOrd) fullOrd.textContent = "Заказ A" + String(d.orderId);
      paintReservePayment(r, "collection");
      const modeAfter = reserveDraftRef.current?.paymentMethod ?? "collection";
      try {
        await fetch("/api/raffles/orders/" + String(d.orderId) + "/bank", {
          method: "PATCH",
          headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            bank: modeAfter === "collection" ? "sber" : "other",
            bank_card_id: null,
          }),
        });
      } catch {
        /* ignore */
      }
      switchPayStep("requisites");
      openOverlay(document.getElementById("modal-reserve-payment"));
      syncPaySheetFlow("pay");
      startPayTimer(d.reservedUntil);
    };

    armPaymentRef.current = armPayment;

    const onGoPay = () => {
      void armPayment();
    };

    const onCancelReservation = async () => {
      const oid = reserveDraftRef.current?.orderId || 0;
      if (oid < 1) return;
      try {
        const res = await fetch("/api/raffles/orders/" + String(oid) + "/cancel-reservation", {
          method: "POST",
          headers: abAuthHeaders(),
          cache: "no-store",
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error || "Ошибка");
        closeOverlay(document.getElementById("modal-reserve-payment-cancel-confirm"));
        clearPayTimer();
        closeOverlay(document.getElementById("modal-reserve-payment"));
        reserveDraftRef.current = null;
        void syncOrderRef.current();
        void loadAllSlicesRef.current({ force: true, showLoader: false });
        toastRef.current("Бронь отменена", "success");
      } catch (e) {
        if (isNetworkFetchError(e)) {
          toastRef.current("Нет связи с сервером. Проверьте интернет и попробуйте снова.", "warning");
          return;
        }
        toastRef.current(String((e as Error).message || "Ошибка"), "error");
      }
    };

    const elGoPay = document.getElementById("reserve-success-go-pay");
    elGoPay?.addEventListener("click", onGoPay);

    const onPayClose = () => {
      if (reserveDraftRef.current?.orderId) {
        openOverlay(document.getElementById("modal-reserve-payment-cancel-confirm"));
        return;
      }
      clearPayTimer();
      closeOverlay(document.getElementById("modal-reserve-payment"));
    };
    const elPayClose = document.getElementById("reserve-payment-close");
    elPayClose?.addEventListener("click", onPayClose);
    const elModalPay = document.getElementById("modal-reserve-payment");
    const CHECK_COPY_SVG =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';

    const onModalPayClick = (e: MouseEvent) => {
      const copyBtn = (e.target as HTMLElement).closest?.("[data-copy-target]") as HTMLButtonElement | null;
      if (copyBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = copyBtn.getAttribute("data-copy-target");
        if (!id) return;
        const cel = document.getElementById(id);
        const text = cel?.textContent?.trim() || "";
        if (!text) return;
        const originals = payCopyBtnOriginalHtmlRef.current;
        const timers = payCopyBtnTimerRef.current;
        const prevT = timers.get(copyBtn);
        if (prevT != null) window.clearTimeout(prevT);
        void navigator.clipboard.writeText(text).then(
          () => {
            if (!originals.has(copyBtn)) originals.set(copyBtn, copyBtn.innerHTML);
            copyBtn.classList.add("pay-sheet-copy-btn--copied");
            copyBtn.innerHTML = CHECK_COPY_SVG;
            timers.set(
              copyBtn,
              window.setTimeout(() => {
                copyBtn.classList.remove("pay-sheet-copy-btn--copied");
                copyBtn.innerHTML = originals.get(copyBtn) ?? copyBtn.innerHTML;
                timers.delete(copyBtn);
              }, 3000),
            );
          },
          () => toastRef.current("Не удалось скопировать", "warning"),
        );
        return;
      }
      if (e.target === elModalPay) onPayClose();
    };
    elModalPay?.addEventListener("click", onModalPayClick);

    const onCancelDismiss = () => {
      closeOverlay(document.getElementById("modal-reserve-payment-cancel-confirm"));
    };
    const elCancelDismiss = document.getElementById("reserve-payment-cancel-dismiss");
    elCancelDismiss?.addEventListener("click", onCancelDismiss);

    const elModalCancelConfirm = document.getElementById("modal-reserve-payment-cancel-confirm");
    const onModalCancelConfirmBackdrop = (e: MouseEvent) => {
      if (e.target === elModalCancelConfirm) closeOverlay(document.getElementById("modal-reserve-payment-cancel-confirm"));
    };
    elModalCancelConfirm?.addEventListener("click", onModalCancelConfirmBackdrop);

    const elCancelConfirmBtn = document.getElementById("reserve-payment-cancel-confirm");
    elCancelConfirmBtn?.addEventListener("click", onCancelReservation);

    const onPayDone = () => switchPayStep("confirm");
    const elPayDone = document.getElementById("reserve-payment-done");
    elPayDone?.addEventListener("click", onPayDone);

    const onPayBack = () => switchPayStep("requisites");
    const elPayBack = document.getElementById("reserve-payment-back");
    elPayBack?.addEventListener("click", onPayBack);
    const elPayBackLink = document.getElementById("reserve-payment-back-link");
    elPayBackLink?.addEventListener("click", onPayBack);

    const methodHandlers: Array<{ el: HTMLElement; fn: () => void }> = [];
    for (const spec of [
      { id: "reserve-payment-method-collection", m: "collection" as const },
      { id: "reserve-payment-method-tbank", m: "tbank_collection" as const },
      { id: "reserve-payment-method-qr", m: "qr" as const },
    ]) {
      const el = document.getElementById(spec.id);
      const fn = () => {
        const rf = raffleRef.current;
        if (rf) paintReservePayment(rf, spec.m);
      };
      el?.addEventListener("click", fn);
      if (el) methodHandlers.push({ el, fn });
    }

    const elAltReq = document.getElementById("reserve-payment-alt-requisites");
    const onAltReq = async () => {
      const rf = raffleRef.current;
      const d = reserveDraftRef.current;
      if (!rf || !d?.orderId) return;
      const ch = getRafflePayChannelFlags(rf);
      const shortfall = getBankCardTicketShortfall(rf, d.numbers.length);
      if (shortfall != null && shortfall > 0 && ch.hasCol && !ch.hasTbank && !ch.hasQr) {
        const scope = String(rf.card_payment_scope || "").toLowerCase();
        const minNeed =
          scope === "wholesale_only"
            ? Math.max(1, Math.floor(Number(rf.wholesale_every_n_tickets) || 10))
            : Math.max(1, Math.floor(Number(rf.card_payment_min_tickets) || 2));
        const intro =
          scope === "wholesale_only"
            ? `Оплата переводом на карту доступна при заказе от ${minNeed} номерков (порог опта).`
            : `Оплата переводом на карту доступна при заказе от ${minNeed} номерков.`;
        window.alert(
          intro + "\n\nНе хватает ещё " + String(shortfall) + " номерков. Добавьте их в заказ и снова откройте окно оплаты.",
        );
        return;
      }
      if (!altPayCycleRef.current.modes.length) {
        altPayCycleRef.current.modes = buildAltPayModes(rf, d.numbers.length);
        altPayCycleRef.current.idx = -1;
      }
      const modes = altPayCycleRef.current.modes;
      if (!modes.length) {
        toastRef.current("Нет других способов оплаты", "warning");
        return;
      }
      altPayCycleRef.current.idx = (altPayCycleRef.current.idx + 1) % modes.length;
      const mode = modes[altPayCycleRef.current.idx];
      if (mode === "bank_card") {
        try {
          const res = await fetch("/api/raffles/orders/" + String(d.orderId) + "/payment-bank-card", {
            headers: abAuthHeaders(),
            cache: "no-store",
          });
          const data = (await res.json()) as {
            suggested_bank_card?: { id: number; card_number: string; recipient: string } | null;
            error?: string;
          };
          if (!res.ok) throw new Error(data.error || "Ошибка");
          const card = data.suggested_bank_card;
          if (!card) {
            d.activeBankCard = null;
            await fetch("/api/raffles/orders/" + String(d.orderId) + "/bank", {
              method: "PATCH",
              headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
              body: JSON.stringify({ bank: "other", bank_card_id: null }),
            });
            paintReservePayment(rf, "bank_card", null);
            toastRef.current("Сейчас нет свободной карты — выберите другой способ ниже", "warning");
            return;
          }
          d.activeBankCard = card;
          await fetch("/api/raffles/orders/" + String(d.orderId) + "/bank", {
            method: "PATCH",
            headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ bank: "other", bank_card_id: card.id }),
          });
          paintReservePayment(rf, "bank_card", card);
        } catch (e) {
          toastRef.current(String((e as Error).message || "Ошибка"), "error");
        }
        return;
      }
      d.activeBankCard = null;
      try {
        await fetch("/api/raffles/orders/" + String(d.orderId) + "/bank", {
          method: "PATCH",
          headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            bank: mode === "collection" ? "sber" : "other",
            bank_card_id: null,
          }),
        });
      } catch {
        /* ignore */
      }
      paintReservePayment(rf, mode as "collection" | "tbank_collection" | "qr");
    };
    const onAltReqClick = () => void onAltReq();
    elAltReq?.addEventListener("click", onAltReqClick);

    const setReceiptSendReady = (ready: boolean) => {
      const btn = document.getElementById("reserve-payment-send") as HTMLButtonElement | null;
      if (!btn) return;
      btn.disabled = !ready;
      btn.classList.toggle("pay-sheet-receipt-send--disabled", !ready);
      btn.classList.toggle("pay-sheet-receipt-send--ready", ready);
    };
    const setReceiptProgress = (percent: number, text: string, visible = true) => {
      const wrap = document.getElementById("reserve-payment-upload-progress");
      const fill = document.getElementById("reserve-payment-upload-progress-fill");
      const txt = document.getElementById("reserve-payment-upload-progress-text");
      if (wrap) wrap.hidden = !visible;
      if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
      if (txt) txt.textContent = text;
    };
    const onFileChange = (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      const currentSeq = ++receiptUploadSeqRef.current;
      const el = document.getElementById("reserve-payment-file-name");
      if (el) el.textContent = f ? f.name : "Фото или PDF (до 10 МБ)";
      receiptUploadDataRef.current = null;
      receiptUploadInFlightRef.current = false;
      setReceiptSendReady(false);
      if (!f) {
        setReceiptProgress(0, "Загрузка: 0%", false);
        return;
      }
      receiptUploadInFlightRef.current = true;
      setReceiptProgress(0, "Загрузка: 0%");
      void uploadReceiptFile(f, (p) => {
        if (currentSeq !== receiptUploadSeqRef.current) return;
        setReceiptProgress(p, `Загрузка: ${p}%`);
      })
        .then((uploadData) => {
          if (currentSeq !== receiptUploadSeqRef.current) return;
          receiptUploadDataRef.current = uploadData;
          receiptUploadInFlightRef.current = false;
          setReceiptProgress(100, "Загрузка: 100%");
          setReceiptSendReady(true);
        })
        .catch((err) => {
          if (currentSeq !== receiptUploadSeqRef.current) return;
          receiptUploadDataRef.current = null;
          receiptUploadInFlightRef.current = false;
          setReceiptProgress(0, "Загрузка: 0%", false);
          const msg = String((err as Error).message || "Не удалось загрузить файл");
          toastRef.current(msg, "error");
        });
    };
    const elFile = document.getElementById("reserve-payment-file");
    elFile?.addEventListener("change", onFileChange);
    setReceiptSendReady(false);
    setReceiptProgress(0, "Загрузка: 0%", false);

    const sendReceiptFromModal = async () => {
      const input = document.getElementById("reserve-payment-file") as HTMLInputElement | null;
      const file = input?.files?.[0];
      const oid = reserveDraftRef.current?.orderId;
      if (!file || !oid) {
        toastRef.current("Сначала нажмите «Загрузить чек» и выберите файл", "warning");
        return;
      }
      if (receiptUploadInFlightRef.current) {
        toastRef.current("Дождитесь завершения загрузки файла (100%)", "warning");
        return;
      }
      const uploadData = receiptUploadDataRef.current;
      if (!uploadData) {
        toastRef.current("Файл ещё не загружен. Выберите чек и дождитесь 100%.", "warning");
        return;
      }
      try {
        const res = await postReceiptWithRetries(oid, {
          url: uploadData.url,
          name: uploadData.name,
          mime: uploadData.mime,
          sha256: uploadData.sha256,
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; order?: { receipt_review_eta_hint?: string } };
        if (!res.ok) throw new Error(data.error || "Ошибка");
        clearPayTimer();
        closeOverlay(document.getElementById("modal-reserve-payment"));
        reserveDraftRef.current = null;
        receiptUploadDataRef.current = null;
        receiptUploadInFlightRef.current = false;
        const hint = data.order?.receipt_review_eta_hint ? String(data.order.receipt_review_eta_hint) : "";
        toastRef.current(hint ? "Чек отправлен. " + hint : "Чек отправлен на проверку", "success");
        void syncOrderRef.current();
        void loadAllSlicesRef.current({ force: true, showLoader: false });
        router.replace("/home");
      } catch (e) {
        if (isNetworkFetchError(e)) {
          const titleEl = document.getElementById("action-error-title");
          const textEl = document.getElementById("action-error-text");
          if (titleEl) titleEl.textContent = RECEIPT_NETWORK_MODAL_TITLE;
          if (textEl) textEl.textContent = RECEIPT_NETWORK_MODAL_TEXT;
          openOverlay(document.getElementById("modal-action-error"));
          return;
        }
        toastRef.current(String((e as Error).message || "Не получилось отправить чек"), "error");
      }
    };
    const onSendReceipt = () => void sendReceiptFromModal();
    const onActionErrorRetry = () => {
      closeOverlay(document.getElementById("modal-action-error"));
      void sendReceiptFromModal();
    };
    const elSend = document.getElementById("reserve-payment-send");
    elSend?.addEventListener("click", onSendReceipt);
    const elActionErrRetry = document.getElementById("action-error-retry");
    elActionErrRetry?.addEventListener("click", onActionErrorRetry);
    const elModalActionErr = document.getElementById("modal-action-error");
    const onModalActionErrBackdrop = (e: MouseEvent) => {
      if (e.target === elModalActionErr) closeOverlay(document.getElementById("modal-action-error"));
    };
    elModalActionErr?.addEventListener("click", onModalActionErrBackdrop);

    const onExpiredClose = () => closeOverlay(document.getElementById("modal-reserve-expired"));
    const elExpiredClose = document.getElementById("reserve-expired-close");
    elExpiredClose?.addEventListener("click", onExpiredClose);

    const elModalExpired = document.getElementById("modal-reserve-expired");
    const onModalExpiredBackdrop = (e: MouseEvent) => {
      if (e.target === elModalExpired) closeOverlay(document.getElementById("modal-reserve-expired"));
    };
    elModalExpired?.addEventListener("click", onModalExpiredBackdrop);

    const elModalSuccess = document.getElementById("modal-reserve-success");
    const onModalSuccessBackdrop = (e: MouseEvent) => {
      if (e.target === elModalSuccess) closeOverlay(document.getElementById("modal-reserve-success"));
    };
    elModalSuccess?.addEventListener("click", onModalSuccessBackdrop);

    return () => {
      clearPayTimer();
      elGoPay?.removeEventListener("click", onGoPay);
      elPayClose?.removeEventListener("click", onPayClose);
      elModalPay?.removeEventListener("click", onModalPayClick);
      elAltReq?.removeEventListener("click", onAltReqClick);
      elCancelDismiss?.removeEventListener("click", onCancelDismiss);
      elModalCancelConfirm?.removeEventListener("click", onModalCancelConfirmBackdrop);
      elCancelConfirmBtn?.removeEventListener("click", onCancelReservation);
      elPayDone?.removeEventListener("click", onPayDone);
      elPayBack?.removeEventListener("click", onPayBack);
      elPayBackLink?.removeEventListener("click", onPayBack);
      for (const { el, fn } of methodHandlers) el.removeEventListener("click", fn);
      elFile?.removeEventListener("change", onFileChange);
      receiptUploadSeqRef.current += 1;
      receiptUploadDataRef.current = null;
      receiptUploadInFlightRef.current = false;
      elSend?.removeEventListener("click", onSendReceipt);
      elActionErrRetry?.removeEventListener("click", onActionErrorRetry);
      elModalActionErr?.removeEventListener("click", onModalActionErrBackdrop);
      elExpiredClose?.removeEventListener("click", onExpiredClose);
      elModalExpired?.removeEventListener("click", onModalExpiredBackdrop);
      elModalSuccess?.removeEventListener("click", onModalSuccessBackdrop);
      armPaymentRef.current = null;
    };
  }, [clearPayTimer, authVerified, authCheckInFlight]);

  useEffect(() => {
    return () => {
      document.documentElement.classList.remove("has-cart-action-strip", "bottom-nav-hidden-by-fast-input");
    };
  }, []);

  useEffect(() => {
    if (!authVerified && authCheckInFlight) return;
    const modal = document.getElementById("modal-ticket-search");
    const closeBtn = document.getElementById("modal-ticket-search-close");
    const applyBtn = document.getElementById("ticket-search-apply") as HTMLButtonElement | null;
    const input = document.getElementById("ticket-search-input") as HTMLInputElement | null;
    const field = document.getElementById("ticket-search-field");
    const badge = document.getElementById("ticket-search-status-badge");
    const modeEnter = document.getElementById("ticket-search-mode-enter");
    const modeRandom = document.getElementById("ticket-search-mode-random");
    const panelEnter = document.getElementById("ticket-search-panel-enter");
    const panelRandom = document.getElementById("ticket-search-panel-random");
    const randomMinus = document.getElementById("ticket-search-random-minus");
    const randomPlus = document.getElementById("ticket-search-random-plus");
    const randomQtyDisplay = document.getElementById("ticket-search-random-qty-display");
    const randomApply = document.getElementById("ticket-search-random-apply") as HTMLButtonElement | null;
    const goCart = document.getElementById("ticket-search-go-cart");
    const pickedWrap = document.getElementById("ticket-search-picked");
    const pickedChips = document.getElementById("ticket-search-picked-chips");
    if (!modal || !applyBtn || !input || !field || !badge || !modeEnter || !modeRandom || !panelEnter || !panelRandom || !randomApply) return;

    let searchMode: "enter" | "random" = "enter";
    let randomQty = 5;
    let lookupTimer: ReturnType<typeof setTimeout> | null = null;
    let lookupState: { n: number; kind: string | null } = { n: NaN, kind: null };

    const close = () => closeOverlay(modal);
    const renderPicked = () => {
      const nums = selected.slice().sort((a, b) => a - b);
      if (!pickedWrap || !pickedChips) return;
      if (!nums.length) {
        pickedWrap.hidden = true;
        pickedChips.innerHTML = "";
        return;
      }
      pickedWrap.hidden = false;
      pickedChips.innerHTML = nums
        .map(
          (n) =>
            '<button type="button" class="ticket-search-picked__chip" data-ticket-search-picked-remove="' +
            String(n) +
            '"><span>' +
            esc(String(n)) +
            "</span></button>",
        )
        .join("");
    };

    const updateRandomUi = () => {
      if (randomQtyDisplay) randomQtyDisplay.textContent = String(randomQty);
      randomApply.textContent = "Добавить " + String(randomQty) + " случайных билетов";
      document.querySelectorAll("[data-random-preset]").forEach((x) => {
        const n = Number((x as HTMLElement).getAttribute("data-random-preset"));
        x.classList.toggle("ticket-search-random__preset--active", n === randomQty);
      });
      if (randomMinus) (randomMinus as HTMLButtonElement).disabled = randomQty <= 1;
      if (randomPlus) (randomPlus as HTMLButtonElement).disabled = randomQty >= RAFFLE_MAX_SELECT;
    };

    const setMode = (m: "enter" | "random") => {
      searchMode = m;
      modeEnter.classList.toggle("ticket-search-sheet__seg--active", m === "enter");
      modeRandom.classList.toggle("ticket-search-sheet__seg--active", m === "random");
      modeEnter.setAttribute("aria-selected", m === "enter" ? "true" : "false");
      modeRandom.setAttribute("aria-selected", m === "random" ? "true" : "false");
      panelEnter.hidden = m !== "enter";
      panelRandom.hidden = m !== "random";
    };

    const setEnterUi = (kind: string) => {
      field.className = "ticket-search-sheet__field" + (kind ? " ticket-search-sheet__field--" + kind : "");
      if (kind === "free") {
        badge.className = "ticket-search-status-badge ticket-search-status-badge--free";
        badge.textContent = "Свободен";
        applyBtn.disabled = false;
        applyBtn.textContent = "Добавить в выбор";
        applyBtn.className = "btn btn--primary ticket-search-sheet__cta ticket-search-sheet__cta--primary-dark";
        return;
      }
      if (kind === "self") {
        badge.className = "ticket-search-status-badge ticket-search-status-badge--self";
        badge.textContent = "Уже в вашем выборе";
      } else if (kind === "taken") {
        badge.className = "ticket-search-status-badge ticket-search-status-badge--taken";
        badge.textContent = "Занят";
      } else if (kind === "loading") {
        badge.className = "ticket-search-status-badge ticket-search-status-badge--empty";
        badge.textContent = "Проверяем...";
      } else if (kind === "invalid") {
        badge.className = "ticket-search-status-badge ticket-search-status-badge--invalid";
        badge.textContent = "Нет такого номера";
      } else {
        badge.className = "ticket-search-status-badge ticket-search-status-badge--empty";
        badge.textContent = "";
      }
      applyBtn.disabled = true;
      applyBtn.textContent = "Укажите свободный номер";
      applyBtn.className = "btn btn--primary ticket-search-sheet__cta";
    };

    const checkInput = () => {
      if (lookupTimer) clearTimeout(lookupTimer);
      const raw = String(input.value || "").replace(/\D/g, "");
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 1) {
        lookupState = { n: NaN, kind: null };
        setEnterUi("");
        return;
      }
      const maxN = Math.max(1, Math.floor(Number(raffleRef.current?.ticket_count) || 1));
      if (n > maxN) {
        lookupState = { n, kind: "invalid" };
        setEnterUi("invalid");
        return;
      }
      const cell = cellByNumberRef.current.get(n);
      if (cell) {
        const kind = String(cell.kind || "");
        lookupState = { n, kind };
        if (selRef.current.has(n) || kind === "self_reserved") setEnterUi("self");
        else if (kind === "free") setEnterUi("free");
        else if (kind === "taken") setEnterUi("taken");
        else setEnterUi("invalid");
        return;
      }
      if (allSlicesLoadedRef.current) {
        lookupState = { n, kind: "invalid" };
        setEnterUi("invalid");
        return;
      }
      setEnterUi("loading");
      lookupTimer = setTimeout(() => {
        const cur = Number(String(input.value || "").replace(/\D/g, ""));
        if (cur !== n) return;
        const item = cellByNumberRef.current.get(n);
        const kind = item ? String(item.kind || "invalid") : "invalid";
        lookupState = { n, kind };
        if (selRef.current.has(n) || kind === "self_reserved") setEnterUi("self");
        else if (kind === "free") setEnterUi("free");
        else if (kind === "taken") setEnterUi("taken");
        else setEnterUi("invalid");
      }, 120);
    };

    const submit = () => {
      const o = orderRef.current;
      if (o && String(o.status || "") === "reserved") {
        toast("Сначала завершите оплату по брони.", "info");
        return;
      }
      const n = Number(String(input.value || "").replace(/\D/g, ""));
      if (!Number.isFinite(n) || n < 1) return;
      if (!selRef.current.has(n) && (lookupState.n !== n || lookupState.kind !== "free")) return;
      setSelected((prev) => {
        const set = new Set(prev);
        if (set.size >= RAFFLE_MAX_SELECT || set.has(n)) return prev;
        set.add(n);
        return Array.from(set).sort((a, b) => a - b);
      });
      scheduleSelectionSync();
      renderPicked();
      setEnterUi("self");
    };

    const addRandom = () => {
      const o = orderRef.current;
      if (o && String(o.status || "") === "reserved") {
        toast("Сначала завершите оплату по брони.", "info");
        return;
      }
      const free = collectGlobalFreeNumbers(sliceCacheRef.current, selRef.current);
      if (!free.length) {
        toast("Свободных номерков в акции нет", "warning");
        return;
      }
      const shuffled = free.slice().sort(() => Math.random() - 0.5);
      const add = shuffled.slice(0, Math.max(1, Math.min(randomQty, RAFFLE_MAX_SELECT)));
      setSelected((prev) => {
        const set = new Set(prev);
        for (const n of add) {
          if (set.size >= RAFFLE_MAX_SELECT) break;
          set.add(n);
        }
        return Array.from(set).sort((a, b) => a - b);
      });
      scheduleSelectionSync();
      renderPicked();
      const first = add[0];
      if (first !== undefined) {
        const maxN = Math.max(1, Math.floor(Number(raffleRef.current?.ticket_count) || 1));
        const part = getRangeTabForTicketN(maxN, first);
        if (part) switchRangeTabRef.current(part.from, part.to);
      }
      setMode("enter");
    };

    const onBackdrop = (e: MouseEvent) => {
      if (e.target === modal) close();
    };
    const onPickedClick = (e: Event) => {
      const rm = (e.target as HTMLElement).closest?.("[data-ticket-search-picked-remove]") as HTMLElement | null;
      if (!rm) return;
      const n = Number(rm.getAttribute("data-ticket-search-picked-remove"));
      if (!Number.isFinite(n)) return;
      setSelected((prev) => prev.filter((x) => x !== n));
      scheduleSelectionSync();
      renderPicked();
      checkInput();
    };
    const onGoCart = () => {
      close();
      openCart();
    };
    const onModeEnter = () => setMode("enter");
    const onModeRandom = () => setMode("random");
    const onMinus = () => {
      randomQty = Math.max(1, randomQty - 1);
      updateRandomUi();
    };
    const onPlus = () => {
      randomQty = Math.min(RAFFLE_MAX_SELECT, randomQty + 1);
      updateRandomUi();
    };
    const onPreset = (e: Event) => {
      const t = (e.target as HTMLElement).closest?.("[data-random-preset]") as HTMLElement | null;
      if (!t) return;
      const n = Number(t.getAttribute("data-random-preset"));
      if (!Number.isFinite(n)) return;
      randomQty = Math.max(1, Math.min(RAFFLE_MAX_SELECT, n));
      updateRandomUi();
    };

    setMode("enter");
    updateRandomUi();
    renderPicked();
    checkInput();

    closeBtn?.addEventListener("click", close);
    applyBtn.addEventListener("click", submit);
    input.addEventListener("input", checkInput);
    randomApply.addEventListener("click", addRandom);
    modeEnter.addEventListener("click", onModeEnter);
    modeRandom.addEventListener("click", onModeRandom);
    randomMinus?.addEventListener("click", onMinus);
    randomPlus?.addEventListener("click", onPlus);
    document.querySelectorAll("[data-random-preset]").forEach((x) => x.addEventListener("click", onPreset));
    pickedChips?.addEventListener("click", onPickedClick);
    goCart?.addEventListener("click", onGoCart);
    modal.addEventListener("click", onBackdrop);
    return () => {
      if (lookupTimer) clearTimeout(lookupTimer);
      closeBtn?.removeEventListener("click", close);
      applyBtn.removeEventListener("click", submit);
      input.removeEventListener("input", checkInput);
      randomApply.removeEventListener("click", addRandom);
      modeEnter.removeEventListener("click", onModeEnter);
      modeRandom.removeEventListener("click", onModeRandom);
      randomMinus?.removeEventListener("click", onMinus);
      randomPlus?.removeEventListener("click", onPlus);
      document.querySelectorAll("[data-random-preset]").forEach((x) => x.removeEventListener("click", onPreset));
      pickedChips?.removeEventListener("click", onPickedClick);
      goCart?.removeEventListener("click", onGoCart);
      modal.removeEventListener("click", onBackdrop);
    };
  }, [openCart, scheduleSelectionSync, toast, authVerified, authCheckInFlight]);

  if (!authVerified && authCheckInFlight) {
    return (
      <div className="home-boot-loader" role="status" aria-live="polite" aria-label="Загрузка">
        <div className="home-boot-loader__spinner" aria-hidden="true">
          <span className="home-boot-loader__ring"></span>
        </div>
      </div>
    );
  }

  const lowStockFreeLabel = lowStockModal ? formatRub(lowStockModal.freeCount) : "";

  return (
    <>
      <AbRafflePurchaseShellMarkup />
      {lowStockModal ? (
        <div
          className="modal-overlay raffle-low-stock-modal is-open"
          role="dialog"
          aria-modal="true"
          aria-labelledby="raffle-low-stock-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLowStockModal(null);
          }}
        >
          <div className="raffle-low-stock-modal__card" role="document">
            <h2 id="raffle-low-stock-title" className="raffle-low-stock-modal__title">
              Свободно <span className="raffle-low-stock-modal__count">{lowStockFreeLabel}</span>
            </h2>
            <p className="raffle-low-stock-modal__text">Мест мало. Показать только свободные?</p>
            <div className="raffle-low-stock-modal__actions">
              <button
                type="button"
                className="btn btn--primary raffle-low-stock-modal__btn"
                onClick={() => {
                  setOnlyFreeViewEnabled(true);
                  setLowStockModal(null);
                }}
              >
                Только свободные
              </button>
              <button type="button" className="btn btn--ghost raffle-low-stock-modal__btn" onClick={() => setLowStockModal(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <AppBottomNav
        show={!!(session?.token && session?.phone)}
        profileLetter={letter}
        authVerified={authVerified}
        showSearchSheet
        onSearchSheet={openSearchSheet}
        onChat={() => router.push("/home/chat")}
        onChatBlocked={() => toast("Войдите, чтобы пользоваться чатом", "warning")}
      />
    </>
  );
}
