"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { abApiJson, abAuthHeaders, AbApiError } from "../../lib/ab-api";
import { buildAbWebSocketUrl } from "../../lib/ab-ws";
import AppBottomNav from "./AppBottomNav";
import { useAbSession } from "./AbSessionContext";

type RaffleRow = {
  id: number;
  raffle_hash?: string;
  title?: string;
  status?: string;
  cover_image_url?: string;
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
  const [mounted, setMounted] = useState(false);
  const [raffles, setRaffles] = useState<RaffleRow[]>([]);
  const [feedErr, setFeedErr] = useState(false);
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
  const [socialModalOpen, setSocialModalOpen] = useState(false);
  const [handbookModalOpen, setHandbookModalOpen] = useState(false);

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

  useEffect(() => {
    if (!socialModalOpen && !handbookModalOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (handbookModalOpen) setHandbookModalOpen(false);
      else setSocialModalOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [socialModalOpen, handbookModalOpen]);

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
  }, [session, authVerified, router]);

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

  useEffect(() => {
    if (!session?.token || !authVerified) return;
    const wsUrl = buildAbWebSocketUrl(session.token);
    if (!wsUrl) return;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        return;
      }
      ws.onmessage = (ev) => {
        let d: {
          type?: string;
          raffle_id?: number;
          userId?: number;
          message?: { is_staff?: boolean };
        };
        try {
          d = JSON.parse(String(ev.data || "{}"));
        } catch {
          return;
        }
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
        if (d.type === "raffles_feed_updated" || d.type === "raffle_grid_updated") {
          void loadFeed();
        }
        if (d.type === "raffle_tickets_updated") {
          refreshTicketStrip();
        }
        if (
          d.type === "chat_message" &&
          session?.role !== "admin" &&
          d.message?.is_staff === true &&
          Number(d.userId) === Number(session?.id)
        ) {
          notify("Новое сообщение в чате", "Откройте чат, чтобы прочитать ответ.", "push_chat_message");
        }
        if (d.type === "raffle_launch_notified") {
          notify("Новая акция на сайте", "Администратор открыл новую акцию.", "push_raffle_launch_notified", 90_000);
        }
      };
      ws.onclose = () => {
        retryTimer = setTimeout(connect, 2500);
      };
    };
    connect();
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [session?.token, authVerified, loadFeed, refreshTicketStrip]);

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
        <div id="view-app-feed" className="app-view home-inner">
          <header className="home-sticky">
            <div className="home-brand-row">
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
          </header>
          <div className="home-cards" id="home-cards-app">
            {feedErr ? (
              <p className="home-feed-empty">Не удалось загрузить акции. Попробуйте обновить страницу.</p>
            ) : !raffles.length ? (
              <p className="home-feed-empty">Пока нет акций.</p>
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
                const hasPromoFivePlusOne = Boolean(Number(r.promo_5_plus_1_enabled) || r.promo_5_plus_1_enabled === true);
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
                      (hasPromoFivePlusOne ? " raffle-card--promo-5plus1" : "")
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
                      {r.cover_image_url?.trim() ? (
                        <img src={String(r.cover_image_url)} alt="" width={480} height={160} loading={idx < 2 ? "eager" : "lazy"} />
                      ) : null}
                      <div className="raffle-card__grad" />
                      {hasPromoFivePlusOne ? <div className="raffle-card__promo-badge">5+1</div> : null}
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
                          <span>Занято: {occupied}</span>
                          <span>Осталось: {free}</span>
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
                            {st === "active" ? (
                          <span className="raffle-card__cta raffle-card__cta--dark">
                            <span className="raffle-card__cta-label">Участвовать</span>
                            <span className="raffle-card__cta-arrow" aria-hidden="true">
                              →
                            </span>
                          </span>
                            ) : st === "closed" ? (
                          <button type="button" className="raffle-card__cta raffle-card__cta--dark" onClick={openClosedDetails}>
                            <span className="raffle-card__cta-label">Подробно</span>
                          </button>
                            ) : (
                          <span className="raffle-card__cta raffle-card__cta--dark" aria-disabled="true">
                            <span className="raffle-card__cta-label">Участвовать</span>
                            <span className="raffle-card__cta-arrow" aria-hidden="true">
                              →
                            </span>
                          </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <section className="home-action-strip" aria-label="Соцсети и справочник">
            <div className="home-action-strip__row">
              <button type="button" className="home-action-strip__btn home-action-strip__btn--social" onClick={() => setSocialModalOpen(true)}>
                <span className="home-action-strip__icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                  </svg>
                </span>
                <span className="home-action-strip__text">
                  <span className="home-action-strip__title">Соцсети</span>
                  <span className="home-action-strip__sub">VK · Telegram · MAX</span>
                </span>
                <span className="home-action-strip__chev" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6"></path>
                  </svg>
                </span>
              </button>
              <button type="button" className="home-action-strip__btn home-action-strip__btn--handbook" onClick={() => setHandbookModalOpen(true)}>
                <span className="home-action-strip__icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                    <path d="M8 7h8"></path>
                    <path d="M8 11h8"></path>
                  </svg>
                </span>
                <span className="home-action-strip__text">
                  <span className="home-action-strip__title">Справочник</span>
                  <span className="home-action-strip__sub">Частые вопросы</span>
                </span>
                <span className="home-action-strip__chev" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6"></path>
                  </svg>
                </span>
              </button>
            </div>
          </section>
        </div>
      </div>

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

      {socialModalOpen ? (
        <div
          className="modal-overlay modal-overlay--social is-open"
          role="dialog"
          aria-modal="true"
          aria-labelledby="home-social-modal-title"
          aria-hidden="false"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSocialModalOpen(false);
          }}
        >
          <div className="modal home-social-modal">
            <button type="button" className="home-social-modal__close" onClick={() => setSocialModalOpen(false)} aria-label="Закрыть">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18"></path>
                <path d="m6 6 12 12"></path>
              </svg>
            </button>
            <div className="home-social-modal__head">
              <div className="home-social-modal__head-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M12 16v-4"></path>
                  <path d="M12 8h.01"></path>
                </svg>
              </div>
              <h2 id="home-social-modal-title" className="home-social-modal__title">
                Мы на связи
              </h2>
              <p className="home-social-modal__intro">Подпишитесь, чтобы не пропускать новости, эфиры и объявления.</p>
            </div>
            <ul className="home-social-modal__list">
              <li className="home-social-modal__item" style={{ animationDelay: "0.05s" }}>
                <a
                  href="https://vk.com/bolotovandrey80"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="home-social-card home-social-card--vk"
                >
                  <span className="home-social-card__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
                      <path d="M15.684 0H8.316C1.592 0 0 1.592 0 8.316v7.368C0 22.408 1.592 24 8.316 24h7.368C22.408 24 24 22.408 24 15.684V8.316C24 1.592 22.408 0 15.684 0zm3.692 17.123h-1.744c-.66 0-.862-.525-2.05-1.727-1.033-1-1.49-1.135-1.744-1.135-.356 0-.458.102-.458.593v1.575c0 .424-.135.678-1.253.678-1.846 0-3.942-1.186-5.408-3.396-2.102-3.119-2.68-5.475-2.68-5.956 0-.254.102-.491.678-.491h1.744c.508 0 .593.229.762.678.847 2.458 2.34 4.62 2.948 4.62.254 0 .373-.118.373-.779V9.721c-.068-1.186-.695-1.287-.695-1.71 0-.203.17-.407.508-.407h2.744c.423 0 .576.254.576.643v4.267c0 .423.186.576.305.576.254 0 .474-.153.948-.627 1.465-1.643 2.507-4.178 2.507-4.178.145-.305.373-.491.949-.491h1.744c.593 0 .729.305.593.847-.254 1.186-2.56 4.62-2.56 4.62-.406.645-.542.949 0 1.643.406.542 1.736 1.676 1.991 2.102.593.847.678 1.423.678 1.847-.017.508-.423.593-1.016.593z" />
                    </svg>
                  </span>
                  <span className="home-social-card__body">
                    <span className="home-social-card__name">ВКонтакте</span>
                    <span className="home-social-card__desc">Сообщество Андрея Болотова — новости и обсуждения</span>
                  </span>
                  <span className="home-social-card__go" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 17 17 7"></path>
                      <path d="M7 7h10v10"></path>
                    </svg>
                  </span>
                </a>
              </li>
              <li className="home-social-modal__item" style={{ animationDelay: "0.12s" }}>
                <a
                  href="https://t.me/Andrey_Bolotovv"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="home-social-card home-social-card--tg"
                >
                  <span className="home-social-card__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
                      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                    </svg>
                  </span>
                  <span className="home-social-card__body">
                    <span className="home-social-card__name">Telegram</span>
                    <span className="home-social-card__desc">Канал с анонсами и полезными материалами</span>
                  </span>
                  <span className="home-social-card__go" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 17 17 7"></path>
                      <path d="M7 7h10v10"></path>
                    </svg>
                  </span>
                </a>
              </li>
              <li className="home-social-modal__item" style={{ animationDelay: "0.19s" }}>
                <a
                  href="https://max.ru/join/Xfy4YvDujQD09ESpzRLrDvoxVXm0LmgdSyEJjD-I3fM"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="home-social-card home-social-card--max"
                >
                  <span className="home-social-card__icon home-social-card__icon--text" aria-hidden="true">
                    M
                  </span>
                  <span className="home-social-card__body">
                    <span className="home-social-card__name">MAX</span>
                    <span className="home-social-card__desc">Канал в мессенджере MAX — быстрые обновления</span>
                  </span>
                  <span className="home-social-card__go" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 17 17 7"></path>
                      <path d="M7 7h10v10"></path>
                    </svg>
                  </span>
                </a>
              </li>
            </ul>
          </div>
        </div>
      ) : null}

      {handbookModalOpen ? (
        <div
          className="modal-overlay modal-overlay--handbook is-open"
          role="dialog"
          aria-modal="true"
          aria-labelledby="home-handbook-modal-title"
          aria-hidden="false"
          onClick={(e) => {
            if (e.target === e.currentTarget) setHandbookModalOpen(false);
          }}
        >
          <div className="modal home-handbook-modal">
            <button type="button" className="home-handbook-modal__close" onClick={() => setHandbookModalOpen(false)} aria-label="Закрыть">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18"></path>
                <path d="m6 6 12 12"></path>
              </svg>
            </button>
            <div className="home-handbook-modal__head">
              <div className="home-handbook-modal__head-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                  <path d="M8 7h8"></path>
                  <path d="M8 11h6"></path>
                </svg>
              </div>
              <h2 id="home-handbook-modal-title" className="home-handbook-modal__title">
                Справочник
              </h2>
              <p className="home-handbook-modal__intro">Короткие ответы на частые вопросы об участии и оплате.</p>
            </div>
            <div className="home-handbook-modal__faq">
              <article className="home-faq-item">
                <h3 className="home-faq-item__q">Что делать, если заблокировали платёж?</h3>
                <p className="home-faq-item__a">Оплатите другим банком по QR-коду, который указан в окне оплаты.</p>
              </article>
              <article className="home-faq-item">
                <h3 className="home-faq-item__q">Где снова открыть оплату?</h3>
                <p className="home-faq-item__a">
                  На главной нажмите «Завершить оплату» внизу экрана или откройте нужную акцию — там будет переход к окну с реквизитами и QR.
                </p>
              </article>
              <article className="home-faq-item">
                <h3 className="home-faq-item__q">Не успел прикрепить чек, а оплату уже внёс — что делать?</h3>
                <p className="home-faq-item__a">
                  Забронируйте номерки ещё раз, нажмите «К оплате» и дойдите до шага с прикреплением чека: загрузите тот же перевод, повторно оплачивать не нужно — вы уже оплатили.
                </p>
              </article>
              <article className="home-faq-item">
                <h3 className="home-faq-item__q">Как написать в поддержку?</h3>
                <p className="home-faq-item__a">Откройте чат через вкладку «Сообщения» в нижней панели.</p>
              </article>
            </div>
          </div>
        </div>
      ) : null}

      <AppBottomNav
        show={showApp}
        profileLetter={letter}
        authVerified={authVerified}
        onChat={() => router.push("/home/chat")}
        onChatBlocked={() => toast("Войдите, чтобы написать в чат", "warning")}
      />
    </>
  );
}
