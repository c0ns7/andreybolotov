"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { abApiJson, abAuthHeaders, AbApiError } from "../../lib/ab-api";
import { AB_USER_WS_EVENT } from "../../lib/ab-user-ws-events";
import { getAbMyTicketsCached } from "../../lib/ab-my-tickets-cache";
import AppBottomNav from "./AppBottomNav";
import { useSiteFlags } from "../../lib/use-site-flags";
import HomeFeedEmpty from "./HomeFeedEmpty";
import PullToRefresh from "./PullToRefresh";
import HomeSocialLinks from "./HomeSocialLinks";
import HomeBeginnerOnboarding from "./HomeBeginnerOnboarding";
import HomeMusicToggle from "./HomeMusicToggle";
import HomeHeaderOnline from "./HomeHeaderOnline";
import AnimatedStatNumber from "./AnimatedStatNumber";
import RaffleCardMedia from "./RaffleCardMedia";
import { useAbSession } from "./AbSessionContext";

type RaffleRow = {
  id: number;
  raffle_hash?: string;
  title?: string;
  status?: string;
  cover_image_url?: string;
  cover_gif_url?: string;
  updated_at?: number;
  price_rub?: number;
  base_price_rub?: number;
  cenopad_enabled?: number | boolean;
  cenopad_price_rub?: number | null;
  old_price_rub?: number | null;
  ticket_count?: number;
  occupied_count?: number;
  viewers_count?: number;
  my_order_status?: string;
  promo_5_plus_1_enabled?: number | boolean;
  promo_5_plus_2_enabled?: number | boolean;
  live_stream_note?: string | null;
  live_stream_url?: string | null;
  live_stream_at?: number | null;
  live_stream_status?: string | null;
};

function formatRub(n: number) {
  return String(Math.max(0, Math.round(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatCountdown(targetMs: number, nowMs: number) {
  const left = Math.max(0, targetMs - nowMs);
  const totalSec = Math.floor(left / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}д ${hours.toString().padStart(2, "0")}ч ${mins.toString().padStart(2, "0")}м`;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export default function HomeAppClient() {
  const router = useRouter();
  const { session, authVerified, authCheckInFlight, toast, verifySession } = useAbSession();
  const { blog_enabled: blogEnabled } = useSiteFlags();
  const [mounted, setMounted] = useState(false);
  const [raffles, setRaffles] = useState<RaffleRow[]>([]);
  const [feedErr, setFeedErr] = useState(false);
  const [feedRetrying, setFeedRetrying] = useState(false);
  const [feedBootstrapped, setFeedBootstrapped] = useState(false);
  const [reservedCount, setReservedCount] = useState(0);
  const [reservedRaffleId, setReservedRaffleId] = useState<number>(0);
  const [rejectedReason, setRejectedReason] = useState("");
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [closedRaffleModal, setClosedRaffleModal] = useState<RaffleRow | null>(null);
  const [localityModalOpen, setLocalityModalOpen] = useState(false);
  const [localityInput, setLocalityInput] = useState("");
  const [localitySaving, setLocalitySaving] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [pushPromptVisible, setPushPromptVisible] = useState(false);
  const [pushRequesting, setPushRequesting] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const pushLastShownRef = useRef<Record<string, number>>({});
  const [tableRaffleId, setTableRaffleId] = useState(0);
  const [canOpenTable, setCanOpenTable] = useState(false);

  const letter = useMemo(() => {
    const n = session?.name?.trim()?.[0] || session?.phone?.replace(/\D/g, "")?.slice(-1) || "К";
    return n.toUpperCase();
  }, [session]);

  useEffect(() => {
    if (authCheckInFlight) return;
    if (!session?.token) {
      router.replace("/");
    }
  }, [session, authCheckInFlight, router]);

  useEffect(() => {
    if (authCheckInFlight) return;
    if (session?.token && !authVerified) {
      router.replace("/");
    }
  }, [session?.token, authVerified, authCheckInFlight, router]);

  const refreshTableAccess = useCallback(async () => {
    if (!session?.token || !authVerified) {
      setTableRaffleId(0);
      setCanOpenTable(false);
      return;
    }
    try {
      const [latestRes, ticketPayload] = await Promise.all([
        fetch("/api/raffles/latest-visible/table", { cache: "no-store", headers: abAuthHeaders() }),
        getAbMyTicketsCached(),
      ]);
      const latestData = (await latestRes.json().catch(() => ({}))) as {
        raffle?: { id?: number; ticket_count?: number };
      };
      const id = Math.floor(Number(latestData?.raffle?.id) || 0);
      const cnt = Math.floor(Number(latestData?.raffle?.ticket_count) || 0);
      const hasRaffle = latestRes.ok && id > 0 && cnt > 0;
      const confirmed = Array.isArray(ticketPayload?.confirmed) ? ticketPayload.confirmed : [];
      const hasConfirmed = confirmed.some((g) => Array.isArray(g?.numbers) && g.numbers.length > 0);
      const isAdmin = String(session?.role || "") === "admin";
      setTableRaffleId(hasRaffle ? id : 0);
      setCanOpenTable(hasRaffle && (hasConfirmed || isAdmin));
    } catch {
      setTableRaffleId(0);
      setCanOpenTable(false);
    }
  }, [session?.token, authVerified, session?.role]);

  useEffect(() => {
    void refreshTableAccess();
  }, [refreshTableAccess]);

  const loadFeed = useCallback(async () => {
    if (!session?.token || !authVerified) {
      setFeedBootstrapped(true);
      return;
    }
    const ctrl = new AbortController();
    const abortTimer = window.setTimeout(() => ctrl.abort(), 12_000);
    try {
      const data = await abApiJson<{ raffles?: RaffleRow[] }>("/api/raffles", {
        headers: abAuthHeaders(),
        signal: ctrl.signal,
      });
      setRaffles(Array.isArray(data.raffles) ? data.raffles : []);
      setFeedErr(false);
      void refreshTableAccess();
    } catch (e) {
      if (e instanceof AbApiError && e.maintenance) {
        router.replace("/maintenance");
        return;
      }
      if (e instanceof AbApiError && e.status === 401) {
        router.replace("/");
        return;
      }
      setFeedErr(true);
    } finally {
      window.clearTimeout(abortTimer);
      setFeedBootstrapped(true);
    }
  }, [session, authVerified, router, refreshTableAccess]);

  const onRetryFeed = useCallback(async () => {
    if (feedRetrying || !session?.token || !authVerified) return;
    setFeedRetrying(true);
    try {
      await loadFeed();
    } finally {
      setFeedRetrying(false);
    }
  }, [feedRetrying, session?.token, authVerified, loadFeed]);

  useEffect(() => {
    void loadFeed();
    const t = window.setInterval(() => void loadFeed(), 60_000);
    return () => window.clearInterval(t);
  }, [loadFeed]);

  const refreshTicketStrip = useCallback(() => {
    if (!session?.token || !authVerified) return;
    void fetch("/api/raffles/my-tickets?mode=summary", { cache: "no-store", headers: abAuthHeaders() })
      .then((r) => r.json().catch(() => ({})))
      .then((x: {
        reserved_count?: number;
        pending_review_count?: number;
        reserved_raffle_id?: number | null;
        rejected_reason?: string;
      }) => {
        setReservedCount(Math.max(0, Number(x.reserved_count) || 0));
        setPendingReviewCount(Math.max(0, Number(x.pending_review_count) || 0));
        const rid = Number(x.reserved_raffle_id ?? 0);
        setReservedRaffleId(Number.isFinite(rid) && rid > 0 ? rid : 0);
        setRejectedReason(String(x.rejected_reason || "").trim());
      })
      .catch(() => {});
  }, [session?.token, authVerified]);

  const loadFeedRef = useRef(loadFeed);
  loadFeedRef.current = loadFeed;
  const refreshTicketStripRef = useRef(refreshTicketStrip);
  refreshTicketStripRef.current = refreshTicketStrip;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    if (!session?.token || !authVerified) return;
    const onUserWs = (ev: Event) => {
      const d = (ev as CustomEvent<{
        type?: string;
        raffle_id?: number;
        userId?: number;
        message?: { is_staff?: boolean };
      }>).detail;
      if (!d || typeof d !== "object") return;
      const canNotify = typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
      const now = Date.now();
      const onceIn = (key: string, ttlMs: number) => {
        const prev = pushLastShownRef.current[key] ?? 0;
        if (now - prev < ttlMs) return false;
        pushLastShownRef.current[key] = now;
        return true;
      };
      const notify = (title: string, body: string, key: string, ttlMs = 40_000) => {
        if (!canNotify || !onceIn(key, ttlMs)) return;
        try {
          const n = new Notification(title, { body, tag: key });
          window.setTimeout(() => n.close(), 9_000);
        } catch {
          /* ignore */
        }
      };
      const s = sessionRef.current;
      if (d.type === "raffles_feed_updated" || d.type === "raffle_grid_updated") {
        void loadFeedRef.current();
      }
      if (d.type === "raffle_tickets_updated") {
        refreshTicketStripRef.current();
      }
      if (
        d.type === "chat_message" &&
        s?.role !== "admin" &&
        d.message?.is_staff === true &&
        Number(d.userId) === Number(s?.id)
      ) {
        notify("Новое сообщение в чате", "Откройте чат, чтобы прочитать ответ.", "push_chat_message");
      }
      if (d.type === "raffle_launch_notified") {
        notify("Новая акция на сайте", "Администратор открыл новую акцию.", "push_raffle_launch_notified", 90_000);
      }
    };
    window.addEventListener(AB_USER_WS_EVENT, onUserWs as EventListener);
    return () => window.removeEventListener(AB_USER_WS_EVENT, onUserWs as EventListener);
  }, [session?.token, authVerified]);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const perm = Notification.permission;
    setPushPermission(perm);
    if (!session?.token || !authVerified) {
      setPushPromptVisible(false);
      return;
    }
    const dismissed = localStorage.getItem("ab_push_prompt_dismissed") === "1";
    setPushPromptVisible(perm === "default" && !dismissed);
  }, [session?.token, authVerified]);

  const onAllowPush = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setPushRequesting(true);
    try {
      const perm = await Notification.requestPermission();
      setPushPermission(perm);
      setPushPromptVisible(false);
      localStorage.setItem("ab_push_prompt_dismissed", "1");
      if (perm === "granted") {
        toast("Push-уведомления включены", "success");
      }
    } finally {
      setPushRequesting(false);
    }
  }, [toast]);

  const onLaterPush = useCallback(() => {
    setPushPromptVisible(false);
    if (typeof window !== "undefined") localStorage.setItem("ab_push_prompt_dismissed", "1");
  }, []);

  useEffect(() => {
    refreshTicketStrip();
  }, [refreshTicketStrip]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const hasClosedStream = raffles.some((r) => String(r.status || "") === "closed" && Number(r.live_stream_at || 0) > 0);
    if (!hasClosedStream) return;
    const t = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [raffles]);

  useEffect(() => {
    if (!session?.token || !authVerified) return;
    const current = String(session.locality ?? "").trim();
    if (current) {
      setLocalityModalOpen(false);
      return;
    }
    setLocalityInput("");
    setLocalityModalOpen(true);
  }, [session?.token, session?.locality, authVerified]);

  const onSaveLocality = useCallback(async () => {
    const locality = localityInput.trim();
    if (!locality) {
      toast("Укажите населенный пункт", "warning");
      return;
    }
    setLocalitySaving(true);
    try {
      await abApiJson("/api/auth/locality", {
        method: "PATCH",
        headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ locality }),
      });
      await verifySession();
      setLocalityModalOpen(false);
      toast("Населенный пункт сохранен", "success");
    } catch (e) {
      const msg = e instanceof AbApiError ? e.message : "Не удалось сохранить";
      toast(msg, "error");
    } finally {
      setLocalitySaving(false);
    }
  }, [localityInput, toast, verifySession]);

  const showApp = !!(mounted && session?.token && session?.phone && (authVerified || authCheckInFlight));
  const showHomeBootLoader = !!(authCheckInFlight || (session?.token && authVerified && !feedBootstrapped));

  const handlePullRefresh = useCallback(async () => {
    await loadFeed();
    refreshTicketStrip();
  }, [loadFeed, refreshTicketStrip]);

  return (
    <>
      {showHomeBootLoader ? (
        <div className="home-boot-loader" role="status" aria-live="polite" aria-label="Загрузка">
          <div className="home-boot-loader__spinner" aria-hidden="true">
            <span className="home-boot-loader__ring"></span>
          </div>
        </div>
      ) : null}
      <div id="screen-app" className={"screen home-screen" + (showApp ? "" : " screen--hidden")}>
        <PullToRefresh
          onRefresh={handlePullRefresh}
          disabled={!showApp || showHomeBootLoader || localityModalOpen || !!closedRaffleModal}
          className="home-screen__ptr"
        >
        <div id="view-app-feed" className="app-view home-inner">
          <header className="home-sticky">
            <div className="home-brand-row">
              <div className="home-brand-row__main">
                <div className="home-brand-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" />
                    <path d="M4 12h16" />
                    <path d="M12 22v-9" />
                    <path d="M12 13a5 5 0 0 0 5-5V8a3 3 0 0 0-3-3 4 4 0 0 0-4 4 4 4 0 0 0-4-4 3 3 0 0 0-3 3v2a5 5 0 0 0 5 5" />
                  </svg>
                </div>
                <h1 className="home-brand-title">Быть добру!</h1>
              </div>
              <div className="home-brand-row__actions">
                <HomeHeaderOnline />
                <HomeMusicToggle />
              </div>
            </div>
          </header>
          <h2 className="home-section-title">Активные акции</h2>
          <div className="home-cards" id="home-cards-app">
            {feedErr ? (
              <HomeFeedEmpty
                variant="error"
                retrying={feedRetrying}
                onRetry={() => void onRetryFeed()}
                onOpenChat={() => router.push("/home/chat")}
              />
            ) : !raffles.length ? (
              <HomeFeedEmpty variant="empty" onOpenChat={() => router.push("/home/chat")} />
            ) : (
              raffles.map((r, idx) => {
                const st = String(r.status || "active");
                const myOrderStatus = String(r.my_order_status || "");
                const isPaused = st === "paused";
                const isClosed = st === "closed";
                const streamAt = Math.floor(Number(r.live_stream_at || 0));
                const streamStatusRaw = String(r.live_stream_status || "").trim().toLowerCase();
                const streamState =
                  streamStatusRaw === "ended"
                    ? "ended"
                    : streamStatusRaw === "live" || (streamAt > 0 && nowTs >= streamAt)
                      ? "live"
                      : "scheduled";
                const streamCountdown = streamAt > 0 && streamState === "scheduled" ? formatCountdown(streamAt, nowTs) : "";
                const streamUrl = String(r.live_stream_url || "").trim();
                const isWaitCheck = st === "active" && myOrderStatus === "reserved";
                const total = Math.max(0, Number(r.ticket_count) || 0);
                const occupied = Math.max(0, Math.min(total, Number(r.occupied_count) || 0));
                const free = Math.max(0, total - occupied);
                const freePct = total > 0 ? (free / total) * 100 : 0;
                const isLowFree = free <= 300;
                const currentPrice = Math.max(0, Math.floor(Number(r.price_rub ?? 0)));
                const basePrice = Math.max(0, Math.floor(Number(r.base_price_rub ?? currentPrice)));
                const hasSecondPriceActive = basePrice > currentPrice && currentPrice > 0;
                const hasPromo5plus2 = Boolean(Number(r.promo_5_plus_2_enabled) || r.promo_5_plus_2_enabled === true);
                const hasPromo5plus1 = Boolean(Number(r.promo_5_plus_1_enabled) || r.promo_5_plus_1_enabled === true);
                const hasPromoPack = hasPromo5plus1 || hasPromo5plus2;
                const promoPackLabel = hasPromo5plus2 ? "5+2" : "5+1";
                const showTableBtn =
                  canOpenTable && tableRaffleId > 0 && Math.floor(Number(r.id) || 0) === tableRaffleId;
                const secondPriceEndAt = Math.floor(
                  Number((r as { second_price_end_at?: number; cenopad_end_at?: number }).second_price_end_at ??
                    (r as { cenopad_end_at?: number }).cenopad_end_at ??
                    0),
                );
                const secondPriceCountdown =
                  hasSecondPriceActive && secondPriceEndAt > nowTs ? formatCountdown(secondPriceEndAt, nowTs) : "";
                const go = () => {
                  if (st === "active") {
                    const hash = String(r.raffle_hash || "").trim();
                    if (hash) router.push("/raffle/" + encodeURIComponent(hash));
                    else router.push("/home/raffle?id=" + encodeURIComponent(String(r.id)));
                  }
                };
                const openClosedDetails = (e: MouseEvent<HTMLButtonElement>) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setClosedRaffleModal(r);
                };
                return (
                  <article
                    key={String(r.id)}
                    className={
                      "raffle-card" +
                      (st === "active" ? " raffle-card--active" : "") +
                      (hasSecondPriceActive ? " raffle-card--cenopad" : "") +
                      (hasPromoPack ? " raffle-card--promo-5plus1" : "")
                    }
                    data-status={st}
                    role={st === "active" ? "link" : undefined}
                    tabIndex={st === "active" ? 0 : -1}
                    onClick={go}
                    onKeyDown={(e) => {
                      if (st === "active" && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        go();
                      }
                    }}
                  >
                    <div className="raffle-card__media">
                      <RaffleCardMedia
                        raffleId={Math.floor(Number(r.id) || 0)}
                        coverUrl={r.cover_image_url}
                        gifUrl={r.cover_gif_url}
                        updatedAt={Math.floor(Number(r.updated_at) || 0)}
                        loading={idx < 2 ? "eager" : "lazy"}
                        animEnabled={st === "active"}
                      />
                      <div className="raffle-card__grad" />
                      {hasPromoPack ? <div className="raffle-card__promo-badge">{promoPackLabel}</div> : null}
                      {hasSecondPriceActive ? (
                        <div className="raffle-card__promo-special" aria-label="Акция по второй цене">
                          <div className="raffle-card__promo-special-title">АКЦИЯ СПЕЦИАЛЬНО ДЛЯ ВАС</div>
                          <div className="raffle-card__promo-special-timer">
                            {secondPriceCountdown || "Скоро завершится"}
                          </div>
                        </div>
                      ) : null}
                      {isWaitCheck ? (
                        <div className="raffle-card__badge-wrap raffle-card__badge-wrap--wait-check">
                          <div className="raffle-card__badge raffle-card__badge--wait-check">Ждём чек</div>
                        </div>
                      ) : null}
                      {isPaused ? (
                        <div className="raffle-card__badge-wrap raffle-card__badge-wrap--paused">
                          <div className="raffle-card__badge raffle-card__badge--pause">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <circle cx="12" cy="12" r="10"></circle>
                              <path d="M12 8v4M12 16h.01"></path>
                            </svg>
                            Техническая пауза
                          </div>
                          <div className="raffle-card__sub">Скоро вернёмся</div>
                        </div>
                      ) : null}
                      {isClosed ? (
                        <div className="raffle-card__badge-wrap raffle-card__badge-wrap--closed">
                          <div className="raffle-card__badge raffle-card__badge--pause">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                            </svg>
                            Продажи закрыты
                          </div>
                          {streamState === "scheduled" ? (
                            <>
                              <div className="raffle-card__sub">До эфира</div>
                              {streamCountdown ? <div className="raffle-card__sub raffle-card__sub--timer">{streamCountdown}</div> : null}
                            </>
                          ) : streamState === "live" ? (
                            <div className="raffle-card__sub">Эфир уже начался</div>
                          ) : (
                            <div className="raffle-card__sub">Эфир окончен</div>
                          )}
                        </div>
                      ) : null}
                      <h3 className="raffle-card__title">{String(r.title || "")}</h3>
                    </div>
                    <div className="raffle-card__foot">
                      <div className="raffle-card__progress-wrap">
                        <div className="raffle-card__progress-meta">
                          <span>
                            Занято: <AnimatedStatNumber value={occupied} />
                          </span>
                          <span>
                            Осталось: <AnimatedStatNumber value={free} />
                          </span>
                        </div>
                        <div className="raffle-card__progress-track" role="img" aria-label={"Осталось " + Math.round(freePct) + " процентов"}>
                          <span
                            className={
                              "raffle-card__progress-fill " +
                              (isLowFree
                                ? "raffle-card__progress-fill--danger raffle-card__progress-fill--blink"
                                : "raffle-card__progress-fill--ok")
                            }
                            style={{ width: Math.max(0, Math.min(100, freePct)).toFixed(1) + "%" }}
                          />
                        </div>
                      </div>
                      <div className="raffle-card__price-row">
                        {st === "closed" && streamUrl ? (
                          <a href={streamUrl} target="_blank" rel="noopener noreferrer" className="raffle-card__stream-cta">
                            Смотреть эфир
                          </a>
                        ) : (
                          <>
                            <div className="raffle-card__price">
                              {hasSecondPriceActive ? (
                                <>
                                  <span className="raffle-card__price-old">{formatRub(basePrice)} ₽</span>
                                  <span className="raffle-card__price-current">{formatRub(currentPrice)} ₽</span>{" "}
                                  <span className="raffle-card__price-suffix">/ билет</span>
                                </>
                              ) : (
                                <>
                                  {formatRub(currentPrice)}&nbsp;₽ <span className="raffle-card__price-suffix">/ билет</span>
                                </>
                              )}
                            </div>
                            <div className="raffle-card__actions">
                              {showTableBtn ? (
                                <Link
                                  href="/home/table"
                                  className="raffle-card__table-btn"
                                  aria-label="Таблица номерков"
                                  onClick={(e: MouseEvent) => e.stopPropagation()}
                                  onKeyDown={(e) => e.stopPropagation()}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <rect x="3" y="4" width="18" height="16" rx="2" />
                                    <path d="M3 10h18" />
                                    <path d="M9 4v16" />
                                    <path d="M15 4v16" />
                                  </svg>
                                </Link>
                              ) : null}
                              {st === "active" ? (
                                <span className="raffle-card__cta raffle-card__cta--dark raffle-card__cta--compact">
                                  <span className="raffle-card__cta-label">Участвовать</span>
                                  <span className="raffle-card__cta-arrow" aria-hidden="true">
                                    →
                                  </span>
                                </span>
                              ) : st === "closed" ? (
                                <button
                                  type="button"
                                  className="raffle-card__cta raffle-card__cta--dark raffle-card__cta--compact"
                                  onClick={openClosedDetails}
                                >
                                  <span className="raffle-card__cta-label">Подробно</span>
                                </button>
                              ) : (
                                <span className="raffle-card__cta raffle-card__cta--dark raffle-card__cta--compact" aria-disabled="true">
                                  <span className="raffle-card__cta-label">Участвовать</span>
                                  <span className="raffle-card__cta-arrow" aria-hidden="true">
                                    →
                                  </span>
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
          <h2 className="home-section-title home-section-title--social">Мы в социальных сетях</h2>
          <HomeSocialLinks />
          <HomeBeginnerOnboarding authVerified={authVerified} sessionToken={session?.token} />
        </div>
        </PullToRefresh>

      {showApp && (reservedCount > 0 || pendingReviewCount > 0) ? (
        <button
          type="button"
          className="home-pending-strip"
          onClick={() => {
            if (reservedCount > 0 && reservedRaffleId > 0) {
              if (rejectedReason) {
                toast("Причина отклонения: " + rejectedReason, "warning");
              }
              const raffleById = raffles.find((it) => Number(it.id) === reservedRaffleId);
              const raffleHash = String(raffleById?.raffle_hash || "").trim();
              if (raffleHash) {
                router.push("/raffle/" + encodeURIComponent(raffleHash) + "?openPayment=1");
              } else {
                router.push("/home/raffle?id=" + encodeURIComponent(String(reservedRaffleId)) + "&openPayment=1");
              }
              return;
            }
            const btn = document.getElementById("tab-profile") as HTMLButtonElement | null;
            if (btn) {
              btn.click();
              return;
            }
            router.push("/home/settings");
          }}
        >
          {reservedCount > 0
            ? rejectedReason
              ? "Ваш платеж был отклонен"
              : "Завершить оплату"
            : "Ваши номерки на проверке"}
        </button>
      ) : null}

      {closedRaffleModal ? (
        <div
          className="modal-overlay modal-overlay--raffle-unavailable is-open"
          aria-hidden="false"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setClosedRaffleModal(null);
          }}
        >
          <div className="modal modal--raffle-unavailable raffle-unavailable--closed">
            <button
              type="button"
              className="raffle-unavailable__close"
              aria-label="Закрыть"
              onClick={() => setClosedRaffleModal(null)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18"></path>
                <path d="m6 6 12 12"></path>
              </svg>
            </button>
            <div className="raffle-unavailable__cover">
              <img
                className="raffle-unavailable__cover-img"
                src={String(closedRaffleModal.cover_image_url || "/favicon.svg")}
                alt={String(closedRaffleModal.title || "Обложка акции")}
              />
              <div className="raffle-unavailable__cover-fade"></div>
              <div className="raffle-unavailable__hero-icon" aria-hidden="true">
                <svg className="raffle-unavailable__hero-icon-svg raffle-unavailable__hero-icon-svg--closed" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z"></path>
                  <circle cx="12" cy="12" r="10"></circle>
                </svg>
              </div>
            </div>
            <div className="raffle-unavailable__body">
              <h2 className="raffle-unavailable__heading">Продажи закрыты</h2>
              <p className="raffle-unavailable__text">
                Акция перешла в стадию подведения итогов. Покупка новых билетов временно невозможна.
              </p>
              <div className="raffle-unavailable__info-card">
                <div className="raffle-unavailable__info-item">
                  <div className="raffle-unavailable__info-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 2v4"></path>
                      <path d="M16 2v4"></path>
                      <rect width="18" height="18" x="3" y="4" rx="2"></rect>
                      <path d="M3 10h18"></path>
                    </svg>
                  </div>
                  <div className="raffle-unavailable__info-text">
                    <p className="raffle-unavailable__info-label">Время эфира</p>
                    <p className="raffle-unavailable__info-value">
                      {String(closedRaffleModal.live_stream_note || "").trim() ||
                        "Эфир закончился, смотрите запись эфира по ссылке."}
                    </p>
                  </div>
                </div>
              </div>
              {String(closedRaffleModal.live_stream_url || "").trim() ? (
                <a
                  href={String(closedRaffleModal.live_stream_url || "").trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="raffle-unavailable__cta"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z"></path>
                    <circle cx="12" cy="12" r="10"></circle>
                  </svg>
                  <span>Смотреть эфир</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 3h6v6"></path>
                    <path d="M10 14 21 3"></path>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  </svg>
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {localityModalOpen ? (
        <div className="modal-overlay modal-overlay--locality is-open" role="dialog" aria-modal="true" aria-hidden="false">
          <div className="modal locality-modal">
            <div className="locality-modal__head">
              <div className="locality-modal__icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
                  <circle cx="12" cy="10" r="3"></circle>
                </svg>
              </div>
              <h2 className="locality-modal__title">Укажите населенный пункт</h2>
              <p className="locality-modal__subtitle">Это обязательное поле для участия в акциях и корректной обработки заявок.</p>
            </div>
            <div className="modal__body locality-modal__body">
              <div className="form-group locality-modal__group">
                <label htmlFor="profile-locality-required">Ваш населенный пункт</label>
                <input
                  id="profile-locality-required"
                  className="input locality-modal__input"
                  type="text"
                  autoComplete="address-level2"
                  placeholder="Например, Москва"
                  value={localityInput}
                  onChange={(e) => setLocalityInput(e.target.value)}
                />
              </div>
              <div className="form-actions locality-modal__actions">
                <button
                  type="button"
                  className="btn btn--primary locality-modal__save-btn"
                  disabled={localitySaving}
                  onClick={() => void onSaveLocality()}
                >
                  {localitySaving ? "Сохраняем..." : "Сохранить"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {pushPromptVisible && pushPermission === "default" && showApp && !showHomeBootLoader ? (
        <div className="home-push-permission" role="dialog" aria-modal="false" aria-labelledby="home-push-permission-title">
          <div className="home-push-permission__icon-wrap" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.268 21a2 2 0 0 0 3.464 0"></path>
              <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"></path>
            </svg>
          </div>
          <div className="home-push-permission__main">
            <h4 id="home-push-permission-title" className="home-push-permission__title">
              Уведомления
            </h4>
            <p className="home-push-permission__text">Включите Push, чтобы узнавать о сообщениях и выигрышах.</p>
            <div className="home-push-permission__actions">
              <button
                type="button"
                className="home-push-permission__btn home-push-permission__btn--primary"
                onClick={() => void onAllowPush()}
                disabled={pushRequesting}
              >
                {pushRequesting ? "Включаем..." : "Включить"}
              </button>
              <button type="button" className="home-push-permission__btn home-push-permission__btn--ghost" onClick={onLaterPush} disabled={pushRequesting}>
                Позже
              </button>
            </div>
          </div>
          <button type="button" className="home-push-permission__close" onClick={onLaterPush} disabled={pushRequesting} aria-label="Закрыть">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18"></path>
              <path d="m6 6 12 12"></path>
            </svg>
          </button>
        </div>
      ) : null}

      </div>

      <AppBottomNav
        show={showApp}
        profileLetter={letter}
        authVerified={authVerified}
        showBlog
        blogEnabled={blogEnabled}
        onChat={() => router.push("/home/chat")}
        onChatBlocked={() => toast("Войдите, чтобы написать в чат", "warning")}
      />
    </>
  );
}
