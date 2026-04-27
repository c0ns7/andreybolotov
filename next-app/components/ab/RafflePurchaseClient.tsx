"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { abApiJson, abAuthHeaders, AbApiError } from "../../lib/ab-api";
import { loadAbSession } from "../../lib/ab-session";
import { buildAbWebSocketUrl } from "../../lib/ab-ws";
import AbRafflePurchaseShellMarkup from "./AbRafflePurchaseShellMarkup";
import AppBottomNav from "./AppBottomNav";
import { useAbSession } from "./AbSessionContext";

const RAFFLE_MAX_SELECT = 25;
const DRAFT_PREFIX = "ab_raffle_draft_";

type RaffleDto = Record<string, unknown> & {
  id?: number;
  title?: string;
  status?: string;
  ticket_count?: number;
  price_rub?: number;
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
};

type OrderDto = Record<string, unknown> & {
  id?: number;
  status?: string;
  raffle_id?: number;
  amount_rub?: number;
  reserved_until?: number;
  bank?: string | null;
};

type Cell = { n: number; kind: string };

function esc(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatRub(n: number) {
  return String(Math.max(0, Math.round(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function isNetworkFetchError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message || "").toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("networkerror");
}

async function postReceiptWithSingleRetry(orderId: number, payload: Record<string, unknown>) {
  const submit = () =>
    fetch("/api/raffles/orders/" + String(orderId) + "/receipt", {
      method: "POST",
      headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  try {
    return await submit();
  } catch (e) {
    if (!isNetworkFetchError(e)) throw e;
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    return await submit();
  }
}

function formatMmSs(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function formatDeadlineMoscow(ms: number) {
  try {
    const d = new Date(Number(ms));
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
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
      html += '<div class="raffle-cell raffle-cell--taken" title="Занято" aria-label="Занято"><span class="raffle-cell__dot"></span></div>';
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
  const [selected, setSelected] = useState<number[]>([]);
  const [order, setOrder] = useState<OrderDto | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const [orderNumbers, setOrderNumbers] = useState<number[]>([]);
  const [viewers, setViewers] = useState(0);
  const rangeHasFreeRef = useRef(new Map<string, boolean>());
  const [serverSkewMs, setServerSkewMs] = useState(0);
  const reserveMono = useRef<{ budgetMs: number | null; anchorPerf: number | null }>({ budgetMs: null, anchorPerf: null });
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [mainStep, setMainStep] = useState<"grid" | "wait">("grid");
  const [navHiddenByInput, setNavHiddenByInput] = useState(false);

  const reserveDraftRef = useRef<{
    orderId: number;
    amountRub: number;
    reservedUntil: number;
    numbers: number[];
    paymentMethod: "collection" | "tbank_collection" | "qr";
  } | null>(null);

  const paymentStepRef = useRef<"requisites" | "confirm">("requisites");
  const payTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoOpenPaymentTriggeredRef = useRef(false);
  const fastLookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fastLookupRef = useRef<{ n: number; kind: string | null }>({ n: NaN, kind: null });
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
  const sliceCacheRef = useRef(new Map<string, { ts: number; cells: Cell[] }>());

  const loadSlice = useCallback(async (opts?: { force?: boolean; showLoader?: boolean }) => {
    const r = raffleRef.current;
    if (!r?.id) return;
    const id = Number(r.id);
    const from = rangeFromRef.current;
    const to = rangeToRef.current;
    const force = Boolean(opts?.force);
    const showLoader = opts?.showLoader !== false;
    const cacheKey = String(id) + ":" + String(from) + "-" + String(to);
    if (!force) {
      const cached = sliceCacheRef.current.get(cacheKey);
      if (cached && Date.now() - cached.ts < 20_000) {
        setCells(cached.cells);
        setGridLoading(false);
        return;
      }
    }
    if (showLoader) {
      setCells([]);
      setGridLoading(true);
    }
    try {
      const res = await fetch(
        "/api/raffles/" + String(id) + "/tickets?from=" + String(from) + "&to=" + String(to),
        { cache: "no-store", headers: abAuthHeaders() },
      );
      const data = (await res.json()) as { cells?: Cell[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      const nextCells = Array.isArray(data.cells) ? data.cells : [];
      setCells(nextCells);
      setGridLoading(false);
      sliceCacheRef.current.set(cacheKey, { ts: Date.now(), cells: nextCells });
      const key = String(from) + "-" + String(to);
      const hasFree = nextCells.some((c) => String(c.kind) === "free");
      rangeHasFreeRef.current.set(key, hasFree);
      const btn = document.querySelector(`.raffle-range-tab[data-from="${from}"][data-to="${to}"]`) as HTMLElement | null;
      if (btn) btn.classList.toggle("raffle-range-tab--no-free", !hasFree);
    } catch (e) {
      setGridLoading(false);
      throw e;
    }
  }, []);

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
    const rf = rangeFromRef.current;
    const rt = rangeToRef.current;
    if (n >= rf && n <= rt) {
      for (const c of cellsRef.current) {
        if (Number(c.n) === n) {
          fastLookupRef.current = { n, kind: String(c.kind || "invalid") };
          renderFastInputState();
          return;
        }
      }
    }
    fastLookupRef.current = { n, kind: null };
    renderFastInputState();
    fastLookupTimerRef.current = setTimeout(() => {
      fastLookupTimerRef.current = null;
      const part = getRangeTabForTicketN(Math.max(1, Math.floor(Number(r.ticket_count) || 1)), n);
      if (!part) {
        fastLookupRef.current = { n, kind: "invalid" };
        renderFastInputState();
        return;
      }
      void (async () => {
        try {
          const res2 = await fetch(
            "/api/raffles/" + String(r.id) + "/tickets?from=" + String(part.from) + "&to=" + String(part.to),
            { cache: "no-store", headers: abAuthHeaders() },
          );
          const d2 = (await res2.json()) as { cells?: Cell[]; error?: string };
          const cur2 = getFastInputN();
          if (!Number.isFinite(cur2) || cur2 !== n) return;
          if (!res2.ok || !Array.isArray(d2.cells)) {
            fastLookupRef.current = { n, kind: "invalid" };
            renderFastInputState();
            return;
          }
          let kind2: string | null = null;
          for (const c of d2.cells) {
            if (Number(c?.n) === n) {
              kind2 = String(c.kind || "");
              break;
            }
          }
          fastLookupRef.current = { n, kind: kind2 || "invalid" };
          renderFastInputState();
        } catch {
          const cur3 = getFastInputN();
          if (!Number.isFinite(cur3) || cur3 !== n) return;
          fastLookupRef.current = { n, kind: "error" };
          renderFastInputState();
        }
      })();
    }, 300);
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
        const badge = document.getElementById("raffle-page-price-badge");
        if (badge) {
          const pr = Number(r.price_rub ?? 0);
          badge.textContent = "БИЛЕТ: " + formatRub(pr) + " ₽";
          badge.hidden = false;
        }
        setViewers(Math.max(0, Number(r.viewers_count) || 0));
        const tabs = document.getElementById("raffle-page-tabs");
        if (tabs) {
          tabs.innerHTML = parts
            .map((p, idx) => {
              const label = String(p.from) + "–" + String(p.to);
              return (
                '<button type="button" role="tab" class="raffle-range-tab' +
                (idx === 0 ? " raffle-range-tab--active" : "") +
                '" data-from="' +
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
        await loadSliceRef.current();
        if (
          shouldAutoOpenPayment &&
          !autoOpenPaymentTriggeredRef.current &&
          reserveDraftRef.current?.orderId &&
          Number(reserveDraftRef.current.orderId) > 0
        ) {
          autoOpenPaymentTriggeredRef.current = true;
          window.setTimeout(() => {
            const btn = document.getElementById("reserve-success-go-pay") as HTMLButtonElement | null;
            btn?.click();
          }, 30);
        }
      } catch (e) {
        toast(String((e as Error).message || "Ошибка"), "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authVerified, session?.token, raffleId, hash, router, toast, shouldAutoOpenPayment, onHashRoute]);

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

  useEffect(() => {
    if (!raffle?.id || !session?.token) return;
    const id = Number(raffle.id);
    const t = window.setInterval(() => {
      fetch("/api/raffles", { cache: "no-store", headers: abAuthHeaders() })
        .then((r) => r.json())
        .then((data: { raffles?: { id?: number; viewers_count?: number }[] }) => {
          const list = Array.isArray(data.raffles) ? data.raffles : [];
          const f = list.find((x) => Number(x.id) === id);
          if (f) setViewers(Math.max(0, Number(f.viewers_count) || 0));
        })
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(t);
  }, [raffle?.id, session?.token]);

  useEffect(() => {
    if (!raffle?.id || !session?.token || !authVerified) return;
    const id = Number(raffle.id);
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/raffles/" + String(id) + "/viewing", { method: "POST", headers: abAuthHeaders(), cache: "no-store" })
        .then((r) => r.json().catch(() => ({})))
        .then((d: { viewers_count?: number }) => {
          if (d && d.viewers_count != null) setViewers(Math.max(0, Number(d.viewers_count) || 0));
        })
        .catch(() => {});
    };
    ping();
    const iv = window.setInterval(ping, 50_000);
    return () => clearInterval(iv);
  }, [raffle?.id, session?.token, authVerified]);

  useEffect(() => {
    const elV = document.getElementById("raffle-page-viewers");
    const elT = document.getElementById("raffle-page-viewers-text");
    if (elT) {
      if (viewers <= 0) elT.textContent = "Онлайн: 0";
      else if (viewers === 1) elT.textContent = "Онлайн: ВЫ";
      else elT.textContent = "Онлайн: " + String(viewers);
    }
    if (elV) elV.hidden = viewers <= 0;
  }, [viewers]);

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
      document.querySelectorAll(".raffle-range-tab").forEach((b) => {
        b.classList.toggle("raffle-range-tab--active", b === t);
      });
      setGridLoading(true);
      setCells([]);
      setRangeFrom(from);
      setRangeTo(to);
    };
    const tabs = document.getElementById("raffle-page-tabs");
    tabs?.addEventListener("click", onTabs);
    return () => tabs?.removeEventListener("click", onTabs);
  }, []);

  useEffect(() => {
    if (!raffle?.id) return;
    void loadSliceRef.current().catch(() => {});
  }, [raffle?.id, rangeFrom, rangeTo]);

  useEffect(() => {
    sliceCacheRef.current.clear();
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
      if (reload) void loadSliceRef.current();
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
      const free = cellsRef.current
        .filter((c) => String(c.kind) === "free")
        .map((c) => c.n)
        .filter((num) => !selRef.current.has(num));
      if (!free.length) {
        toastRef.current("Свободных номерков в этой таблице нет", "warning");
        return;
      }
      const rnd = free[Math.floor(Math.random() * free.length)];
      if (rnd === undefined) return;
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
    const eye = document.getElementById("raffle-page-only-free");
    if (!eye) return;
    const onEye = () => {
      setOnlyFreeView((v) => {
        const n = !v;
        eye.setAttribute("aria-pressed", n ? "true" : "false");
        eye.classList.toggle("raffle-range-eye--active", n);
        return n;
      });
    };
    eye.addEventListener("click", onEye);
    return () => eye.removeEventListener("click", onEye);
  }, []);

  useEffect(() => {
    const g = document.getElementById("raffle-page-step-grid");
    const w = document.getElementById("raffle-page-step-wait");
    if (g) g.hidden = mainStep !== "grid";
    if (w) w.hidden = mainStep !== "wait";
  }, [mainStep]);

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
        const amount = Number(ord?.amount_rub ?? 0);
        const elOrder = document.getElementById("reserve-success-order-id");
        const elPick = document.getElementById("reserve-success-picked-label");
        const elNums = document.getElementById("reserve-success-numbers");
        const elAmt = document.getElementById("reserve-success-amount");
        const elDl = document.getElementById("reserve-success-deadline");
        if (elOrder) elOrder.textContent = ord?.id ? "A" + String(ord.id) : "—";
        if (elPick) elPick.textContent = "Выбрано (" + String(nums.length) + ")";
        if (elNums) {
          elNums.innerHTML = nums
            .map((n) => '<span class="reserve-success-modal__chip">' + esc(String(n)) + "</span>")
            .join("");
        }
        if (elAmt) elAmt.textContent = formatRub(amount) + " ₽";
        if (elDl) {
          const until = Number(ord?.reserved_until ?? 0);
          elDl.textContent = until ? "Крайний срок брони (МСК): " + formatDeadlineMoscow(until) : "";
        }
        openOverlay(document.getElementById("modal-reserve-success"));
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
      void loadSliceRef.current();
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
        paintFlowSteps("reserve-success-steps", "success");
        const ord = data.order as OrderDto;
        const numsF = (data.numbers as number[]) || [];
        const amount = Number(ord?.amount_rub ?? 0);
        const elOrder = document.getElementById("reserve-success-order-id");
        const elPick = document.getElementById("reserve-success-picked-label");
        const elNums = document.getElementById("reserve-success-numbers");
        const elAmt = document.getElementById("reserve-success-amount");
        const elDl = document.getElementById("reserve-success-deadline");
        if (elOrder) elOrder.textContent = ord?.id ? "A" + String(ord.id) : "—";
        if (elPick) elPick.textContent = "Выбрано (" + String(numsF.length) + ")";
        if (elNums)
          elNums.innerHTML = numsF
            .map((n) => '<span class="reserve-success-modal__chip">' + esc(String(n)) + "</span>")
            .join("");
        if (elAmt) elAmt.textContent = formatRub(amount) + " ₽";
        if (elDl) elDl.textContent = ord?.reserved_until ? "Крайний срок брони (МСК): " + formatDeadlineMoscow(Number(ord.reserved_until)) : "";
        reserveDraftRef.current = {
          orderId: Number(ord?.id) || 0,
          amountRub: Number(ord?.amount_rub ?? 0),
          reservedUntil: Number(ord?.reserved_until ?? 0),
          numbers: numsF,
          paymentMethod: "collection",
        };
        openOverlay(document.getElementById("modal-reserve-success"));
        void loadSliceRef.current();
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

  useEffect(() => {
    const wsUrl = session?.token && authVerified ? buildAbWebSocketUrl(session.token) : "";
    if (!wsUrl) return;
    let ws: WebSocket | null = null;
    let t: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        return;
      }
      ws.onmessage = (ev) => {
        let d: { type?: string; raffle_id?: number };
        try {
          d = JSON.parse(ev.data);
        } catch {
          return;
        }
        const rid = raffleIdRef.current;
        if (d.type === "raffle_grid_updated" && Number(d.raffle_id) === rid) {
          sliceCacheRef.current.clear();
          void loadSliceRef.current({ force: true, showLoader: false });
          void syncOrderRef.current();
        }
        if (d.type === "raffle_tickets_updated") {
          if (d.raffle_id != null && Number(d.raffle_id) !== rid) return;
          sliceCacheRef.current.clear();
          void loadSliceRef.current({ force: true, showLoader: false });
          void syncOrderRef.current();
        }
        if (d.type === "raffles_feed_updated") {
          void ensureRaffleActive();
        }
        if (d.type === "raffle_viewers_updated" && Number(d.raffle_id) === rid) {
          void fetch("/api/raffles/" + String(rid), { cache: "no-store", headers: abAuthHeaders() })
            .then((r) => r.json().catch(() => ({})))
            .then((x: { raffle?: { viewers_count?: number } }) => {
              const v = Number(x?.raffle?.viewers_count);
              if (Number.isFinite(v)) setViewers(Math.max(0, v));
            })
            .catch(() => {});
        }
      };
      ws.onclose = () => {
        t = setTimeout(connect, 2500);
      };
    };
    connect();
    return () => {
      if (t) clearTimeout(t);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [session?.token, authVerified, ensureRaffleActive]);

  useEffect(() => {
    if (!authVerified && authCheckInFlight) return;
    const paintReservePayment = (r: RaffleDto, method: "collection" | "tbank_collection" | "qr") => {
      const purpose = String(r.qr_payment_purpose || "Оплата услуг").trim() || "Оплата услуг";
      const elPurT = document.getElementById("reserve-payment-purpose-tbank");
      const elQrPur = document.getElementById("reserve-payment-qr-purpose");
      const elQrHint = document.getElementById("reserve-payment-qr-purpose-hint");
      if (elPurT) elPurT.textContent = purpose;
      if (elQrPur) elQrPur.textContent = purpose;
      if (elQrHint) elQrHint.textContent = "«" + purpose + "»";
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
      if (m === "collection" && !hasCol) m = hasTbank ? "tbank_collection" : "qr";
      if (m === "tbank_collection" && !hasTbank) m = hasCol ? "collection" : "qr";
      if (m === "qr" && !hasQr) m = hasCol ? "collection" : "tbank_collection";
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
      document.getElementById("reserve-payment-methods")!.hidden = Number(hasCol) + Number(hasTbank) + Number(hasQr) < 2;
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
        a.classList.toggle("reserve-flow-btn--disabled", !href);
      }
      if (at) {
        at.href = hrefT || "#";
        at.setAttribute("aria-disabled", hrefT ? "false" : "true");
        at.classList.toggle("reserve-flow-btn--disabled", !hrefT);
      }
      const img = document.getElementById("reserve-payment-qr-image") as HTMLImageElement | null;
      const qr = String(r.qr_image_url || "").trim();
      if (img) {
        if (qr) img.src = qr;
        else img.removeAttribute("src");
      }
      document.getElementById("reserve-payment-collect")!.hidden = m !== "collection";
      document.getElementById("reserve-payment-collect-tbank")!.hidden = m !== "tbank_collection";
      document.getElementById("reserve-payment-qr")!.hidden = m !== "qr";
      const rules = String(r.rules_url || "").trim();
      const rw = document.getElementById("reserve-payment-rules-wrap");
      const rl = document.getElementById("reserve-payment-rules-link") as HTMLAnchorElement | null;
      if (rw && rl) {
        rw.hidden = !rules;
        if (rules) rl.href = rules;
      }
    };

    const switchPayStep = (step: "requisites" | "confirm") => {
      paymentStepRef.current = step;
      const req = document.getElementById("reserve-payment-step-requisites");
      const conf = document.getElementById("reserve-payment-step-confirm");
      const back = document.getElementById("reserve-payment-back");
      const title = document.getElementById("reserve-payment-title");
      const hint = document.getElementById("reserve-payment-phase-hint");
      const isC = step === "confirm";
      if (req) req.hidden = isC;
      if (conf) conf.hidden = !isC;
      if (back) back.hidden = !isC;
      if (title) title.textContent = isC ? "Чек по переводу" : "Реквизиты для перевода";
      if (hint) {
        hint.textContent = isC
          ? "Шаг 3 из 3: прикрепите чек (фото или PDF). После отправки заявка уйдёт на проверку."
          : "Шаг 2 из 3: переведите сумму снизу, затем нажмите «Я перевёл — загрузить чек».";
      }
      paintFlowSteps("reserve-payment-steps", isC ? "confirm" : "requisites");
    };

    const startPayTimer = (untilTs: number) => {
      clearPayTimer();
      const tick = () => {
        const left = reservationLeftMsRef.current(untilTs);
        const el = document.getElementById("reserve-payment-timer");
        const fill = document.getElementById("reserve-payment-progress");
        const denom = Math.max(60_000, left);
        if (el) el.textContent = formatMmSs(left);
        if (fill) fill.style.width = String(Math.max(0, Math.min(100, denom > 0 ? (left / denom) * 100 : 0))) + "%";
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
      try {
        await fetch("/api/raffles/orders/" + String(d.orderId) + "/bank", {
          method: "PATCH",
          headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ bank: "sber" }),
        });
      } catch {
        /* ignore */
      }
      closeOverlay(document.getElementById("modal-reserve-success"));
      const amt = d.amountRub;
      document.getElementById("reserve-payment-amount")!.textContent = formatRub(amt) + " ₽";
      document.getElementById("reserve-payment-amount-inline")!.textContent = formatRub(amt) + " ₽";
      document.getElementById("reserve-payment-amount-check")!.textContent = formatRub(amt) + " ₽";
      document.getElementById("reserve-payment-order-id")!.textContent = "A" + String(d.orderId);
      const dl = document.getElementById("reserve-payment-deadline");
      if (dl) dl.textContent = d.reservedUntil ? "Крайний срок брони (МСК): " + formatDeadlineMoscow(d.reservedUntil) : "";
      paintReservePayment(r, d.paymentMethod);
      switchPayStep("requisites");
      openOverlay(document.getElementById("modal-reserve-payment"));
      startPayTimer(d.reservedUntil);
    };

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
        void loadSliceRef.current();
        toastRef.current("Бронь отменена", "success");
      } catch (e) {
        if (isNetworkFetchError(e)) {
          toastRef.current("Сеть нестабильна. Чек не отправлен, попробуйте еще раз.", "warning");
          return;
        }
        toastRef.current(String((e as Error).message || "Ошибка"), "error");
      }
    };

    const elGoPay = document.getElementById("reserve-success-go-pay");
    elGoPay?.addEventListener("click", onGoPay);

    const onPayClose = () => {
      if (paymentStepRef.current === "confirm") {
        switchPayStep("requisites");
        return;
      }
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
    const onModalPayBackdrop = (e: MouseEvent) => {
      if (e.target === elModalPay) onPayClose();
    };
    elModalPay?.addEventListener("click", onModalPayBackdrop);

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

    const onSupport = () => {
      toastRef.current("Напишите в чат с «Главной»: укажите заказ A" + String(reserveDraftRef.current?.orderId || ""), "info");
    };
    const elSupport = document.getElementById("reserve-payment-support");
    elSupport?.addEventListener("click", onSupport);

    const onFileChange = (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      const el = document.getElementById("reserve-payment-file-name");
      if (el) el.textContent = f ? f.name : "Фото или PDF перевода";
    };
    const elFile = document.getElementById("reserve-payment-file");
    elFile?.addEventListener("change", onFileChange);

    const onSendReceipt = async () => {
      const input = document.getElementById("reserve-payment-file") as HTMLInputElement | null;
      const file = input?.files?.[0];
      const oid = reserveDraftRef.current?.orderId;
      if (!file || !oid) {
        toastRef.current("Выберите файл чека", "warning");
        return;
      }
      try {
        const fd = new FormData();
        fd.append("file", file);
        const up = await fetch("/api/raffles/receipt-upload", { method: "POST", headers: abAuthHeaders(), body: fd });
        const uploadData = (await up.json()) as Record<string, unknown>;
        if (!up.ok) throw new Error(String(uploadData.error || "Ошибка загрузки"));
        const res = await postReceiptWithSingleRetry(oid, {
          url: uploadData.url,
          name: uploadData.name,
          mime: uploadData.mime,
          sha256: uploadData.sha256,
        });
        const data = (await res.json()) as { error?: string; order?: { receipt_review_eta_hint?: string } };
        if (!res.ok) throw new Error(data.error || "Ошибка");
        clearPayTimer();
        closeOverlay(document.getElementById("modal-reserve-payment"));
        reserveDraftRef.current = null;
        const hint = data.order?.receipt_review_eta_hint ? String(data.order.receipt_review_eta_hint) : "";
        toastRef.current(hint ? "Чек отправлен. " + hint : "Чек отправлен на проверку", "success");
        void syncOrderRef.current();
        void loadSliceRef.current();
        router.replace("/home");
      } catch (e) {
        toastRef.current(String((e as Error).message || "Ошибка"), "error");
      }
    };
    const elSend = document.getElementById("reserve-payment-send");
    elSend?.addEventListener("click", onSendReceipt);

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
      elModalPay?.removeEventListener("click", onModalPayBackdrop);
      elCancelDismiss?.removeEventListener("click", onCancelDismiss);
      elModalCancelConfirm?.removeEventListener("click", onModalCancelConfirmBackdrop);
      elCancelConfirmBtn?.removeEventListener("click", onCancelReservation);
      elPayDone?.removeEventListener("click", onPayDone);
      elPayBack?.removeEventListener("click", onPayBack);
      elPayBackLink?.removeEventListener("click", onPayBack);
      for (const { el, fn } of methodHandlers) el.removeEventListener("click", fn);
      elSupport?.removeEventListener("click", onSupport);
      elFile?.removeEventListener("change", onFileChange);
      elSend?.removeEventListener("click", onSendReceipt);
      elExpiredClose?.removeEventListener("click", onExpiredClose);
      elModalExpired?.removeEventListener("click", onModalExpiredBackdrop);
      elModalSuccess?.removeEventListener("click", onModalSuccessBackdrop);
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
      const cell = cellsRef.current.find((c) => Number(c.n) === n);
      if (cell) {
        const kind = String(cell.kind || "");
        lookupState = { n, kind };
        if (selRef.current.has(n) || kind === "self_reserved") setEnterUi("self");
        else if (kind === "free") setEnterUi("free");
        else if (kind === "taken") setEnterUi("taken");
        else setEnterUi("invalid");
        return;
      }
      setEnterUi("loading");
      lookupTimer = setTimeout(async () => {
        const part = getRangeTabForTicketN(maxN, n);
        if (!part || !raffleRef.current?.id) {
          lookupState = { n, kind: "invalid" };
          setEnterUi("invalid");
          return;
        }
        try {
          const res = await fetch(
            "/api/raffles/" + String(raffleRef.current.id) + "/tickets?from=" + String(part.from) + "&to=" + String(part.to),
            { cache: "no-store", headers: abAuthHeaders() },
          );
          const data = (await res.json()) as { cells?: Cell[] };
          const cur = Number(String(input.value || "").replace(/\D/g, ""));
          if (cur !== n) return;
          const item = Array.isArray(data.cells) ? data.cells.find((c) => Number(c?.n) === n) : undefined;
          const kind = String(item?.kind || "invalid");
          lookupState = { n, kind };
          if (selRef.current.has(n) || kind === "self_reserved") setEnterUi("self");
          else if (kind === "free") setEnterUi("free");
          else if (kind === "taken") setEnterUi("taken");
          else setEnterUi("invalid");
        } catch {
          setEnterUi("invalid");
        }
      }, 260);
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
      const free = cellsRef.current
        .filter((c) => String(c.kind) === "free")
        .map((c) => c.n)
        .filter((n) => !selRef.current.has(n));
      if (!free.length) {
        toast("Свободных номерков в этом диапазоне нет", "warning");
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
        <div className="home-boot-loader__inner">
          <div className="home-boot-loader__logo" aria-hidden="true">
            <img src="/logo.png" alt="Андрей Болотов" className="home-boot-loader__logo-image" />
          </div>
          <div className="home-boot-loader__spinner" aria-hidden="true">
            <span className="home-boot-loader__ring"></span>
            <span className="home-boot-loader__ring home-boot-loader__ring--inner"></span>
          </div>
          <p className="home-boot-loader__text">Загрузка</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <AbRafflePurchaseShellMarkup />
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
