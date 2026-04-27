"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
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
        let d: { type?: string; raffle_id?: number };
        try {
          d = JSON.parse(String(ev.data || "{}"));
        } catch {
          return;
        }
        if (d.type === "raffles_feed_updated" || d.type === "raffle_grid_updated" || d.type === "raffle_viewers_updated") {
          void loadFeed();
        }
        if (d.type === "raffle_tickets_updated") {
          refreshTicketStrip();
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
          <div className="home-boot-loader__inner">
            <div className="home-boot-loader__logo" aria-hidden="true">
              <img src="/logo-ab.svg" alt="Андрей Болотов" className="home-boot-loader__logo-image" />
            </div>
            <div className="home-boot-loader__spinner" aria-hidden="true">
              <span className="home-boot-loader__ring"></span>
              <span className="home-boot-loader__ring home-boot-loader__ring--inner"></span>
            </div>
            <p className="home-boot-loader__text">Загрузка</p>
          </div>
        </div>
      ) : null}
      <div id="screen-app" className={"screen home-screen" + (showApp ? "" : " screen--hidden")}>
        <div id="view-app-feed" className="app-view home-inner">
          <header className="home-sticky">
            <div className="home-brand-row">
              <div className="home-brand-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
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
                const secondPriceEndAt = Math.floor(
                  Number((r as { second_price_end_at?: number; cenopad_end_at?: number }).second_price_end_at ??
                    (r as { cenopad_end_at?: number }).cenopad_end_at ??
                    0),
                );
                const secondPriceCountdown =
                  hasSecondPriceActive && secondPriceEndAt > nowTs ? formatCountdown(secondPriceEndAt, nowTs) : "";
                const viewers = Math.max(0, Number(r.viewers_count) || 0);
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
                      (hasSecondPriceActive ? " raffle-card--cenopad" : "")
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
                      {hasSecondPriceActive ? (
                        <div className="raffle-card__promo-special" aria-label="Акция по второй цене">
                          <div className="raffle-card__promo-special-title">АКЦИЯ СПЕЦИАЛЬНО ДЛЯ ВАС</div>
                          <div className="raffle-card__promo-special-timer">
                            {secondPriceCountdown || "Скоро завершится"}
                          </div>
                        </div>
                      ) : null}
                      {!(isPaused || isClosed) && viewers > 0 ? (
                        <div className="raffle-card__viewers" aria-label="Смотрят акцию сейчас">
                          <span className="raffle-card__viewers-dot" aria-hidden="true"></span>
                          <span>Онлайн: {viewers}</span>
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
                Розыгрыш перешел в стадию подведения итогов. Покупка новых билетов временно невозможна.
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
