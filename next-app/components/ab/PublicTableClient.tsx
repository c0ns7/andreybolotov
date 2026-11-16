"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Grid2X2, RefreshCw, SlidersHorizontal, Ticket, Users, X } from "lucide-react";
import { buildAbPublicWebSocketUrl, detachWebSocket } from "../../lib/ab-ws";

type PublicTicketCard = {
  raffleId: number;
  ticket: number;
  raffleTitle: string;
  status: "free" | "taken";
};

function statusLabel(status: PublicTicketCard["status"]): string {
  return status === "free" ? "Свободен" : "Занят";
}

function buildTableRangeTabs(meta: {
  ticketCount: number;
  ticketStart?: number;
  ticketEnd?: number;
  sequentialWindows?: Array<{ from: number; to: number }> | null;
  sequentialWindowFrom?: number | null;
  sequentialWindowTo?: number | null;
}): Array<{ key: string; label: string; from: number; to: number }> {
  const start = Math.max(1, Math.floor(Number(meta.ticketStart) || 1));
  const endRaw = Math.floor(Number(meta.ticketEnd) || 0);
  const count = Math.max(0, Math.floor(Number(meta.ticketCount) || 0));
  const end = endRaw >= start ? endRaw : count > 0 ? start + count - 1 : start;

  const chunk = 500;
  const tabs: Array<{ key: string; label: string; from: number; to: number }> = [];

  const rawWindows = Array.isArray(meta.sequentialWindows) ? meta.sequentialWindows : null;
  if (rawWindows && rawWindows.length) {
    for (const w of rawWindows) {
      const winFrom = Math.max(start, Math.floor(Number(w.from) || start));
      const winTo = Math.min(end, Math.floor(Number(w.to) || winFrom));
      if (winTo < winFrom) continue;
      if (winTo - winFrom + 1 <= chunk) {
        tabs.push({ key: `${winFrom}-${winTo}`, label: `${winFrom}–${winTo}`, from: winFrom, to: winTo });
        continue;
      }
      for (let from = winFrom; from <= winTo; from += chunk) {
        const to = Math.min(from + chunk - 1, winTo);
        tabs.push({ key: `${from}-${to}`, label: `${from}–${to}`, from, to });
      }
    }
    return tabs.length ? tabs : [{ key: String(start), label: String(start), from: start, to: start }];
  }

  const hasSequentialWindow =
    meta.sequentialWindowFrom != null &&
    meta.sequentialWindowTo != null &&
    Number.isFinite(Number(meta.sequentialWindowFrom)) &&
    Number.isFinite(Number(meta.sequentialWindowTo));

  let rangeStart = start;
  let rangeEnd = end;
  if (hasSequentialWindow) {
    rangeStart = Math.max(start, Math.floor(Number(meta.sequentialWindowFrom)));
    rangeEnd = Math.min(end, Math.max(rangeStart, Math.floor(Number(meta.sequentialWindowTo))));
  }

  if (rangeEnd < rangeStart) {
    return [{ key: String(rangeStart), label: String(rangeStart), from: rangeStart, to: rangeStart }];
  }

  if (hasSequentialWindow) {
    for (let from = rangeStart; from <= rangeEnd; from += chunk) {
      const to = Math.min(from + chunk - 1, rangeEnd);
      tabs.push({ key: `${from}-${to}`, label: `${from}–${to}`, from, to });
    }
    return tabs;
  }

  tabs.push({ key: "all", label: "Общий", from: rangeStart, to: rangeEnd });
  for (let from = rangeStart; from <= rangeEnd; from += chunk) {
    const to = Math.min(from + chunk - 1, rangeEnd);
    tabs.push({ key: `${from}-${to}`, label: `${from}–${to}`, from, to });
  }
  return tabs;
}

export default function PublicTableClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [ticketQuery, setTicketQuery] = useState("");
  const [cards, setCards] = useState<PublicTicketCard[]>([]);
  const [raffleTitle, setRaffleTitle] = useState("");
  const [ticketCount, setTicketCount] = useState(0);
  const [ticketStart, setTicketStart] = useState(1);
  const [ticketEnd, setTicketEnd] = useState(0);
  const [sequentialWindows, setSequentialWindows] = useState<Array<{ from: number; to: number }> | null>(null);
  const [sequentialWindowFrom, setSequentialWindowFrom] = useState<number | null>(null);
  const [sequentialWindowTo, setSequentialWindowTo] = useState<number | null>(null);
  const [hideTicketStats, setHideTicketStats] = useState(false);
  const [raffleId, setRaffleId] = useState(0);
  const [viewersCount, setViewersCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [modalCard, setModalCard] = useState<PublicTicketCard | null>(null);
  const [activeRangeKey, setActiveRangeKey] = useState("all");

  async function loadTable(opts?: { silent?: boolean }) {
    const silent = Boolean(opts?.silent);
    if (!silent) setLoading(true);
    setRefreshing(silent);
    setError("");
    try {
      const res = await fetch("/api/public/raffles/latest-visible/table", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || "Ошибка загрузки таблицы"));
      const raffle = data?.raffle;
      if (!raffle) {
        setCards([]);
        setTicketCount(0);
        setHideTicketStats(false);
        setRaffleId(0);
        setRaffleTitle("");
        setViewersCount(0);
        return;
      }
      const rid = Math.max(0, Math.floor(Number(raffle.id) || 0));
      const count = Math.max(0, Math.floor(Number(raffle.ticket_count) || 0));
      const start = Math.max(1, Math.floor(Number(raffle.ticket_start_number) || 1));
      const endRaw = Math.floor(Number(raffle.ticket_end_number) || 0);
      const end = endRaw >= start ? endRaw : count > 0 ? start + count - 1 : start;
      const seqFromRaw = raffle.sequential_window_from;
      const seqToRaw = raffle.sequential_window_to;
      const seqWindowsRaw = Array.isArray(raffle.sequential_windows) ? raffle.sequential_windows : null;
      const seqFrom =
        seqFromRaw != null && Number.isFinite(Number(seqFromRaw)) ? Math.floor(Number(seqFromRaw)) : null;
      const seqTo = seqToRaw != null && Number.isFinite(Number(seqToRaw)) ? Math.floor(Number(seqToRaw)) : null;
      const seqWindows =
        seqWindowsRaw && seqWindowsRaw.length
          ? seqWindowsRaw
              .map((w: { from?: number; to?: number }) => ({
                from: Math.floor(Number(w.from)),
                to: Math.floor(Number(w.to)),
              }))
              .filter((w: { from: number; to: number }) => Number.isFinite(w.from) && Number.isFinite(w.to) && w.to >= w.from)
          : null;
      setTicketCount(count);
      setTicketStart(start);
      setTicketEnd(end);
      setSequentialWindows(seqWindows);
      setSequentialWindowFrom(seqFrom);
      setSequentialWindowTo(seqTo);
      const tabs = buildTableRangeTabs({
        ticketCount: count,
        ticketStart: start,
        ticketEnd: end,
        sequentialWindows: seqWindows,
        sequentialWindowFrom: seqFrom,
        sequentialWindowTo: seqTo,
      });
      setActiveRangeKey(tabs[0]?.key || "all");
      setHideTicketStats(Boolean(Number(raffle.hide_ticket_stats) || raffle.hide_ticket_stats === true));
      setRaffleId(rid);
      setRaffleTitle(String(raffle.title || "Акция"));
      setViewersCount(Math.max(0, Math.floor(Number(raffle.viewers_count) || 0)));
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const mapped: PublicTicketCard[] = rows
        .map((row: { n?: number; status?: string }) => {
          const n = Math.floor(Number(row?.n));
          if (!Number.isFinite(n) || n <= 0) return null;
          const status: PublicTicketCard["status"] = String(row?.status || "") === "taken" ? "taken" : "free";
          return {
            raffleId: rid,
            ticket: n,
            raffleTitle: String(raffle.title || "Акция"),
            status,
          };
        })
        .filter((x: PublicTicketCard | null): x is PublicTicketCard => x != null)
        .sort((a, b) => a.ticket - b.ticket);
      setCards(mapped);
    } catch (e) {
      setError(String((e as Error).message || "Ошибка загрузки"));
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadTable();
  }, []);

  useEffect(() => {
    const wsUrl = buildAbPublicWebSocketUrl("public_table");
    if (!wsUrl) return;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        retryTimer = setTimeout(connect, 2500);
        return;
      }
      ws.onmessage = (ev) => {
        let d: { type?: string; viewers_count?: number };
        try {
          d = JSON.parse(String(ev.data || "{}"));
        } catch {
          return;
        }
        if (d.type === "public_table_viewers_updated" || d.type === "ready") {
          setViewersCount(Math.max(0, Math.floor(Number(d.viewers_count) || 0)));
        }
      };
      ws.onclose = () => {
        retryTimer = setTimeout(connect, 2500);
      };
    };
    connect();
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      detachWebSocket(ws);
    };
  }, []);

  const rangeTabs = useMemo(
    () =>
      buildTableRangeTabs({
        ticketCount,
        ticketStart,
        ticketEnd,
        sequentialWindows,
        sequentialWindowFrom,
        sequentialWindowTo,
      }),
    [ticketCount, ticketStart, ticketEnd, sequentialWindows, sequentialWindowFrom, sequentialWindowTo],
  );
  const activeRange = useMemo(
    () => rangeTabs.find((x) => x.key === activeRangeKey) || rangeTabs[0] || { key: "all", label: "Общий", from: 1, to: 999999 },
    [rangeTabs, activeRangeKey],
  );
  const ticketDigits = useMemo(() => String(ticketQuery || "").replace(/\D/g, ""), [ticketQuery]);
  const totalCount = cards.length;
  const freeCount = useMemo(() => cards.filter((c) => c.status === "free").length, [cards]);
  const takenCount = Math.max(0, totalCount - freeCount);
  const takenPercent = totalCount > 0 ? Math.min(100, Math.round((takenCount / totalCount) * 100)) : 0;
  const filtered = useMemo(() => {
    const inRange = cards.filter((item) => item.ticket >= activeRange.from && item.ticket <= activeRange.to);
    if (!ticketDigits) return inRange;
    return inRange.filter((item) => String(item.ticket).includes(ticketDigits));
  }, [cards, activeRange.from, activeRange.to, ticketDigits]);
  const hasActiveFilters = ticketDigits.length > 0;

  return (
    <div className="screen home-screen">
      <div className="app-view home-inner table-page table-page--public">
        <header className="table-page__header">
          <div className="table-page__head-row">
            <button
              type="button"
              className="table-page__back"
              onClick={() => router.push("/home")}
              aria-label="На главную"
              title="На главную"
            >
              <ChevronLeft size={22} aria-hidden="true" strokeWidth={2.25} />
            </button>
            <div className="table-page__head-titles">
              <h1 className="table-page__title">Таблица номерков</h1>
              <p className="table-page__subtitle">
                {raffleTitle ? `Текущая акция: ${raffleTitle}` : "Публичная таблица с поиском по номеркам"}
              </p>
            </div>
          </div>
          <div className="table-page__meta-row">
            <span className="table-page__online">
              <Users size={14} aria-hidden="true" />
              Онлайн: {viewersCount}
            </span>
            <button
              type="button"
              className={"table-page__refresh-btn" + (refreshing ? " is-loading" : "")}
              onClick={() => {
                void loadTable({ silent: true });
                void fetch("/api/public/table/viewers-count", { cache: "no-store" })
                  .then((r) => r.json())
                  .then((d) => setViewersCount(Math.max(0, Math.floor(Number(d?.viewers_count) || 0))))
                  .catch(() => {});
              }}
              aria-label="Обновить таблицу"
              title="Обновить"
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span>Обновить</span>
            </button>
          </div>
          {!hideTicketStats ? (
          <section className="table-page__summary" aria-label="Статистика по номеркам">
            <div className="table-page__summary-grid">
              <div className="table-page__summary-item table-page__summary-item--free">
                <span className="table-page__summary-label">Свободно</span>
                <strong className="table-page__summary-value">{freeCount}</strong>
              </div>
              <div className="table-page__summary-item table-page__summary-item--taken">
                <span className="table-page__summary-label">Занято</span>
                <strong className="table-page__summary-value">{takenCount}</strong>
              </div>
              <div className="table-page__summary-item table-page__summary-item--total">
                <span className="table-page__summary-label">Всего</span>
                <strong className="table-page__summary-value">{totalCount}</strong>
              </div>
            </div>
            <div className="table-page__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={takenPercent}>
              <span className="table-page__progress-bar" style={{ width: `${takenPercent}%` }} />
            </div>
            <p className="table-page__progress-caption">Заполнено: {takenPercent}%</p>
          </section>
          ) : null}
          <div className="table-page__filters-actions">
            <button
              type="button"
              className={"table-page__filters-toggle" + (filtersOpen ? " is-active" : "")}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span>Фильтры</span>
            </button>
            <button
              type="button"
              className={"table-page__filters-reset" + (hasActiveFilters ? " is-active" : "")}
              onClick={() => setTicketQuery("")}
              disabled={!hasActiveFilters}
            >
              <X size={14} aria-hidden="true" />
              <span>Сбросить фильтры</span>
            </button>
          </div>
          {filtersOpen ? (
            <div className="table-page__filters">
              <label className="table-page__search">
                <Ticket size={16} aria-hidden="true" />
                <input
                  type="text"
                  value={ticketQuery}
                  onChange={(e) => setTicketQuery(String(e.target.value || "").replace(/\D/g, "").slice(0, 6))}
                  placeholder="Номерок, например 125"
                  aria-label="Фильтр по номерку"
                />
              </label>
            </div>
          ) : null}
          {rangeTabs.length > 1 ? (
          <div className="table-page__ranges" role="tablist" aria-label="Диапазоны номерков">
            {rangeTabs.map((tab) => (
              <button
                type="button"
                key={tab.key}
                className={"table-page__range-tab" + (tab.key === activeRange.key ? " is-active" : "")}
                onClick={() => setActiveRangeKey(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          ) : null}
        </header>

        <div className="table-page__cards">
          {loading ? <p className="table-page__empty">Загрузка...</p> : null}
          {!loading && error ? <p className="table-page__empty">{error}</p> : null}
          {!loading && !error && !cards.length ? (
            <p className="table-page__empty">Нет данных по акции. Попробуйте обновить страницу через несколько секунд.</p>
          ) : null}
          {!loading && !error && cards.length && !filtered.length ? <p className="table-page__empty">Ничего не найдено.</p> : null}
          {!loading && !error
            ? filtered.map((card) => (
                <article
                  className={"table-ticket-card table-ticket-card--" + card.status}
                  key={String(card.raffleId) + "_" + String(card.ticket)}
                  onClick={() => {
                    if (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) {
                      setModalCard(card);
                    }
                  }}
                >
                  <div className="table-ticket-card__head">
                    <span className="table-ticket-card__icon table-ticket-card__icon--ticket" aria-hidden="true">
                      <Ticket size={13} />
                    </span>
                    <strong className="table-ticket-card__num">№ {card.ticket}</strong>
                  </div>
                  <div className="table-ticket-card__line">
                    <span className="table-ticket-card__icon" aria-hidden="true">
                      <Grid2X2 size={12} />
                    </span>
                    <span className="table-ticket-card__tiny">{card.raffleTitle}</span>
                  </div>
                  <div className="table-ticket-card__status">{statusLabel(card.status)}</div>
                </article>
              ))
            : null}
        </div>
      </div>
      {modalCard ? (
        <div className="table-card-modal" role="dialog" aria-modal="true" aria-label="Информация по номерку" onClick={() => setModalCard(null)}>
          <div className="table-card-modal__sheet" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="table-card-modal__close" onClick={() => setModalCard(null)} aria-label="Закрыть">
              <X size={18} />
            </button>
            <h3 className="table-card-modal__title">Номерок № {modalCard.ticket}</h3>
            <div className="table-card-modal__row">
              <span>Таблица</span>
              <strong>{modalCard.raffleTitle}</strong>
            </div>
            <div className="table-card-modal__row">
              <span>Статус</span>
              <strong>{statusLabel(modalCard.status)}</strong>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
