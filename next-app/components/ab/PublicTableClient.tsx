"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Grid2X2, Phone, RefreshCw, Search, SlidersHorizontal, Ticket, Users, X } from "lucide-react";
import { buildAbPublicWebSocketUrl, detachWebSocket } from "../../lib/ab-ws";

type PublicTicketCard = {
  raffleId: number;
  ticket: number;
  phone: string;
  raffleTitle: string;
  status: "free" | "taken";
};

function statusLabel(status: PublicTicketCard["status"]): string {
  return status === "free" ? "Свободен" : "Занят";
}

function normalizePhone(raw?: string) {
  return String(raw || "").replace(/\D/g, "");
}

function formatPhoneRu(raw?: string) {
  const d = normalizePhone(raw);
  if (d.length < 11) return raw || "";
  const n = d.startsWith("8") ? "7" + d.slice(1) : d;
  const a = n.slice(-10);
  return `+7 (${a.slice(0, 3)}) ${a.slice(3, 6)}-${a.slice(6, 8)}-${a.slice(8, 10)}`;
}

function formatSearchPhone(raw: string): string {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d[0] === "8") d = "7" + d.slice(1);
  if (d[0] === "9") d = "7" + d;
  if (d[0] !== "7") d = "7" + d.replace(/^7+/, "");
  d = d.slice(0, 11);
  let out = "+7";
  if (d.length > 1) out += " (" + d.slice(1, 4);
  if (d.length >= 4) out += ")";
  if (d.length > 4) out += " " + d.slice(4, 7);
  if (d.length > 7) out += "-" + d.slice(7, 9);
  if (d.length > 9) out += "-" + d.slice(9, 11);
  return out;
}

function buildRangeTabs(ticketCount: number): Array<{ key: string; label: string; from: number; to: number }> {
  const tabs = [{ key: "all", label: "Общий", from: 1, to: Math.max(1, ticketCount) }];
  const size = 500;
  for (let from = 1; from <= ticketCount; from += size) {
    const to = Math.min(ticketCount, from + size - 1);
    tabs.push({ key: `${from}-${to}`, label: `${from}-${to}`, from, to });
  }
  return tabs;
}

export default function PublicTableClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [phoneQuery, setPhoneQuery] = useState("");
  const [ticketQuery, setTicketQuery] = useState("");
  const [cards, setCards] = useState<PublicTicketCard[]>([]);
  const [raffleTitle, setRaffleTitle] = useState("");
  const [ticketCount, setTicketCount] = useState(0);
  const [hideTicketStats, setHideTicketStats] = useState(false);
  const [raffleId, setRaffleId] = useState(0);
  const [viewersCount, setViewersCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [revealedPhones, setRevealedPhones] = useState<Record<number, boolean>>({});
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
      setTicketCount(count);
      setHideTicketStats(Boolean(Number(raffle.hide_ticket_stats) || raffle.hide_ticket_stats === true));
      setRaffleId(rid);
      setRaffleTitle(String(raffle.title || "Акция"));
      setViewersCount(Math.max(0, Math.floor(Number(raffle.viewers_count) || 0)));
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const mapped: PublicTicketCard[] = rows
        .map((row: { n?: number; status?: string; phone?: string | null }) => {
          const n = Math.floor(Number(row?.n));
          if (!Number.isFinite(n) || n <= 0) return null;
          const status: PublicTicketCard["status"] = String(row?.status || "") === "taken" ? "taken" : "free";
          const phoneRaw = String(row?.phone || "").trim();
          return {
            raffleId: rid,
            ticket: n,
            phone: phoneRaw ? formatPhoneRu(phoneRaw) : "",
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

  const rangeTabs = useMemo(() => buildRangeTabs(ticketCount), [ticketCount]);
  const activeRange = useMemo(
    () => rangeTabs.find((x) => x.key === activeRangeKey) || rangeTabs[0] || { key: "all", label: "Общий", from: 1, to: 999999 },
    [rangeTabs, activeRangeKey],
  );
  const phoneDigits = useMemo(() => normalizePhone(phoneQuery), [phoneQuery]);
  const ticketDigits = useMemo(() => String(ticketQuery || "").replace(/\D/g, ""), [ticketQuery]);
  const totalCount = cards.length;
  const freeCount = useMemo(() => cards.filter((c) => c.status === "free").length, [cards]);
  const takenCount = Math.max(0, totalCount - freeCount);
  const takenPercent = totalCount > 0 ? Math.min(100, Math.round((takenCount / totalCount) * 100)) : 0;
  const filtered = useMemo(() => {
    const inRange = cards.filter((item) => item.ticket >= activeRange.from && item.ticket <= activeRange.to);
    if (!phoneDigits && !ticketDigits) return inRange;
    return inRange.filter((item) => {
      const byPhone = !phoneDigits || normalizePhone(item.phone).includes(phoneDigits);
      const byTicket = !ticketDigits || String(item.ticket).includes(ticketDigits);
      return byPhone && byTicket;
    });
  }, [cards, activeRange.from, activeRange.to, phoneDigits, ticketDigits]);
  const hasActiveFilters = phoneDigits.length > 0 || ticketDigits.length > 0;

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
                {raffleTitle ? `Текущая акция: ${raffleTitle}` : "Публичная таблица с поиском по номеркам и телефону"}
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
              onClick={() => {
                setPhoneQuery("");
                setTicketQuery("");
              }}
              disabled={!hasActiveFilters}
            >
              <X size={14} aria-hidden="true" />
              <span>Сбросить фильтры</span>
            </button>
          </div>
          {filtersOpen ? (
            <div className="table-page__filters">
              <label className="table-page__search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="text"
                  value={phoneQuery}
                  onChange={(e) => setPhoneQuery(formatSearchPhone(e.target.value))}
                  placeholder="+7 (9__) ___-__-__"
                  aria-label="Фильтр по номеру телефона"
                />
              </label>
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
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest(".table-ticket-card__phone")) return;
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
                      <Phone size={12} />
                    </span>
                    <button
                      type="button"
                      className={
                        "table-ticket-card__tiny table-ticket-card__phone" +
                        (card.phone && !revealedPhones[card.ticket] ? " is-blurred" : "")
                      }
                      onClick={() => {
                        if (!card.phone) return;
                        setRevealedPhones((prev) => ({ ...prev, [card.ticket]: !prev[card.ticket] }));
                      }}
                      aria-label="Показать или скрыть телефон"
                    >
                      {card.phone || "—"}
                    </button>
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
              <span>Телефон</span>
              <strong>{modalCard.phone || "—"}</strong>
            </div>
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
