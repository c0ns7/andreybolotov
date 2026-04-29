"use client";

import { useEffect, useMemo, useState } from "react";
import { Grid2X2, Phone, RefreshCw, Search, SlidersHorizontal, Ticket, Users, X } from "lucide-react";
import { buildAbPublicWebSocketUrl } from "../../lib/ab-ws";

type PublicTicketCard = {
  raffleId: number;
  ticket: number;
  phone: string;
  raffleTitle: string;
  status: "free" | "taken";
};

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [phoneQuery, setPhoneQuery] = useState("");
  const [ticketQuery, setTicketQuery] = useState("");
  const [cards, setCards] = useState<PublicTicketCard[]>([]);
  const [raffleTitle, setRaffleTitle] = useState("");
  const [ticketCount, setTicketCount] = useState(0);
  const [raffleId, setRaffleId] = useState(0);
  const [viewersCount, setViewersCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
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
        setRaffleId(0);
        setRaffleTitle("");
        setViewersCount(0);
        return;
      }
      const rid = Math.max(0, Math.floor(Number(raffle.id) || 0));
      const count = Math.max(0, Math.floor(Number(raffle.ticket_count) || 0));
      setTicketCount(count);
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
    if (!raffleId) return;
    const wsUrl = buildAbPublicWebSocketUrl("public_raffle_feed");
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
        let d: { type?: string; raffle_id?: number };
        try {
          d = JSON.parse(String(ev.data || "{}"));
        } catch {
          return;
        }
        if (d.type !== "raffle_viewers_updated" || Math.floor(Number(d.raffle_id) || 0) !== raffleId) return;
        void fetch("/api/public/raffles/" + raffleId + "/viewers-count", { cache: "no-store" })
          .then((r) => r.json())
          .then((data) => {
            setViewersCount(Math.max(0, Math.floor(Number(data?.viewers_count) || 0)));
          })
          .catch(() => {});
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
  }, [raffleId]);

  const rangeTabs = useMemo(() => buildRangeTabs(ticketCount), [ticketCount]);
  const activeRange = useMemo(
    () => rangeTabs.find((x) => x.key === activeRangeKey) || rangeTabs[0] || { key: "all", label: "Общий", from: 1, to: 999999 },
    [rangeTabs, activeRangeKey],
  );
  const phoneDigits = useMemo(() => normalizePhone(phoneQuery), [phoneQuery]);
  const ticketDigits = useMemo(() => String(ticketQuery || "").replace(/\D/g, ""), [ticketQuery]);
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
          <h1 className="table-page__title">Таблица номерков</h1>
          <p className="table-page__subtitle">
            {raffleTitle ? `Текущая акция: ${raffleTitle}` : "Публичная таблица с поиском по номеркам и телефону"}
          </p>
          <div className="table-page__meta-row">
            <span className="table-page__online">
              <Users size={14} aria-hidden="true" />
              Онлайн: {viewersCount}
            </span>
            <button
              type="button"
              className={"table-page__refresh-btn" + (refreshing ? " is-loading" : "")}
              onClick={() => void loadTable({ silent: true })}
              aria-label="Обновить таблицу"
              title="Обновить"
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span>Обновить</span>
            </button>
          </div>
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
                <article className={"table-ticket-card table-ticket-card--" + card.status} key={String(card.raffleId) + "_" + String(card.ticket)}>
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
                    <span className="table-ticket-card__tiny table-ticket-card__phone">{card.phone || "—"}</span>
                  </div>
                  <div className="table-ticket-card__line">
                    <span className="table-ticket-card__icon" aria-hidden="true">
                      <Grid2X2 size={12} />
                    </span>
                    <span className="table-ticket-card__tiny">{card.raffleTitle}</span>
                  </div>
                  <div className="table-ticket-card__status">{card.status === "free" ? "Свободен" : "Занят"}</div>
                </article>
              ))
            : null}
        </div>
      </div>
    </div>
  );
}
