"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Grid2X2, Phone, Search, Ticket } from "lucide-react";
import { buildAbWebSocketUrl } from "../../lib/ab-ws";
import { getAbLatestTableCached, invalidateAbLatestTableCache, type AbLatestTableRow } from "../../lib/ab-latest-table-cache";
import AppBottomNav from "./AppBottomNav";
import { useAbSession } from "./AbSessionContext";

type TicketCard = {
  raffleId: number;
  ticket: number;
  phone: string;
  raffleTitle: string;
  status: "free" | "taken" | "self_reserved" | "self_pending" | "self_confirmed";
};

function normalizePhone(raw?: string) {
  return String(raw || "").replace(/\D/g, "");
}

function formatPhoneRu(raw?: string) {
  const d = normalizePhone(raw);
  if (d.length < 11) return raw || "—";
  const n = d.startsWith("8") ? "7" + d.slice(1) : d;
  const a = n.slice(-10);
  return `+7 (${a.slice(0, 3)}) ${a.slice(3, 6)}-${a.slice(6, 8)}-${a.slice(8, 10)}`;
}

export default function HomeTableClient() {
  const router = useRouter();
  const { session, authVerified, authCheckInFlight, toast } = useAbSession();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [cards, setCards] = useState<TicketCard[]>([]);
  const [raffleTitle, setRaffleTitle] = useState("");
  const [revealedPhones, setRevealedPhones] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (authCheckInFlight) return;
    if (!session?.token || !authVerified) {
      router.replace("/");
      return;
    }
    let disposed = false;
    const load = async (force = false) => {
      setLoading(true);
      setError("");
      try {
        const payload = await getAbLatestTableCached({ force, ttlMs: 45_000 });
        const raffle = payload.raffle;
        const raffleId = Math.floor(Number(raffle?.id) || 0);
        if (!Number.isFinite(raffleId) || raffleId <= 0 || !raffle) {
          if (!disposed) {
            setCards([]);
            setRaffleTitle("");
          }
          return;
        }
        const title = String(raffle.title || "Акция");
        if (!disposed) setRaffleTitle(title);
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        if (!rows.length) {
          if (!disposed) setCards([]);
          return;
        }

        const next: TicketCard[] = [];
        for (const row of rows as AbLatestTableRow[]) {
          const n = Math.floor(Number(row.n));
          if (!Number.isFinite(n) || n <= 0) continue;
          const kindRaw = String(row.status || "free");
          const status: TicketCard["status"] = kindRaw === "taken"
              ? "taken"
              : kindRaw === "self_pending"
                ? "self_pending"
                : kindRaw === "self_reserved"
                  ? "self_reserved"
                  : kindRaw === "self_confirmed"
                    ? "self_confirmed"
                    : "free";
          const phoneRaw = String(row.phone || "").trim();
          next.push({
            raffleId,
            ticket: n,
            phone: phoneRaw ? formatPhoneRu(phoneRaw) : "—",
            raffleTitle: title,
            status,
          });
        }
        next.sort((a, b) => a.ticket - b.ticket);
        if (!disposed) setCards(next);
      } catch (e) {
        if (!disposed) setError(String((e as Error).message || "Ошибка загрузки"));
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load(false);
    return () => {
      disposed = true;
    };
  }, [session?.token, session?.phone, authVerified, authCheckInFlight, router]);

  useEffect(() => {
    if (!session?.token || !authVerified) return;
    const wsUrl = buildAbWebSocketUrl(session.token);
    if (!wsUrl) return;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const reconnect = () => {
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        retryTimer = setTimeout(reconnect, 2500);
        return;
      }
      ws.onmessage = (ev) => {
        let d: { type?: string };
        try {
          d = JSON.parse(String(ev.data || "{}"));
        } catch {
          return;
        }
        if (d.type === "raffle_tickets_updated" || d.type === "raffles_feed_updated" || d.type === "raffle_grid_updated") {
          invalidateAbLatestTableCache();
          setTimeout(() => {
            void getAbLatestTableCached({ force: true, ttlMs: 0 }).then((payload) => {
              const raffle = payload.raffle;
              if (!raffle) return;
              const rows = Array.isArray(payload.rows) ? payload.rows : [];
              const mapped: TicketCard[] = rows
                .map((row) => {
                  const n = Math.floor(Number(row.n));
                  if (!Number.isFinite(n) || n <= 0) return null;
                  const kindRaw = String(row.status || "free");
                  const status: TicketCard["status"] = kindRaw === "taken"
                    ? "taken"
                    : kindRaw === "self_pending"
                      ? "self_pending"
                      : kindRaw === "self_reserved"
                        ? "self_reserved"
                        : kindRaw === "self_confirmed"
                          ? "self_confirmed"
                          : "free";
                  return {
                    raffleId: Math.floor(Number(raffle.id) || 0),
                    ticket: n,
                    phone: row.phone ? formatPhoneRu(String(row.phone)) : "—",
                    raffleTitle: String(raffle.title || "Акция"),
                    status,
                  };
                })
                .filter((x): x is TicketCard => x != null)
                .sort((a, b) => a.ticket - b.ticket);
              setRaffleTitle(String(raffle.title || "Акция"));
              setCards(mapped);
            }).catch(() => {});
          }, 120);
        }
      };
      ws.onclose = () => {
        retryTimer = setTimeout(reconnect, 2500);
      };
    };
    reconnect();
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [session?.token, authVerified]);

  const queryDigits = useMemo(() => normalizePhone(query), [query]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = onlyMine ? cards.filter((item) => item.status.startsWith("self_")) : cards;
    if (!q) return base;
    return base.filter((item) => {
      const byTicket = String(item.ticket).includes(queryDigits || q);
      const byPhone = normalizePhone(item.phone).includes(queryDigits);
      const byRaffle = item.raffleTitle.toLowerCase().includes(q);
      return byTicket || byPhone || byRaffle;
    });
  }, [cards, onlyMine, query, queryDigits]);

  const profileLetter = useMemo(() => {
    const n = session?.name?.trim()?.[0] || session?.phone?.replace(/\D/g, "")?.slice(-1) || "К";
    return n.toUpperCase();
  }, [session?.name, session?.phone]);

  const hasPurchased = cards.some((c) => c.status === "self_confirmed");

  return (
    <>
      <div className={"screen home-screen" + (mounted ? "" : " screen--hidden")}>
        <div className="app-view home-inner table-page">
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
                  {raffleTitle ? `Последняя активная акция: ${raffleTitle}` : "Поиск по номерку или номеру телефона"}
                </p>
              </div>
            </div>
            <label className="table-page__search">
              <Search size={16} aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Например: 125 или 79991234567"
                aria-label="Поиск по номерку или номеру телефона"
              />
            </label>
            <button
              type="button"
              className={"table-page__mine-toggle" + (onlyMine ? " is-active" : "")}
              onClick={() => setOnlyMine((v) => !v)}
            >
              {onlyMine ? "Показаны только мои" : "Показать только мои"}
            </button>
          </header>
          <div className="table-page__cards">
            {loading ? <p className="table-page__empty">Загрузка...</p> : null}
            {!loading && error ? <p className="table-page__empty">{error}</p> : null}
            {!loading && !error && !cards.length ? (
              <p className="table-page__empty">
                Нет данных по акции. Попробуйте обновить страницу через несколько секунд.
              </p>
            ) : null}
            {!loading && !error && cards.length && !filtered.length ? <p className="table-page__empty">Ничего не найдено.</p> : null}
            {!loading && !error
              ? filtered.map((card, idx) => (
                  <article
                    className={
                      "table-ticket-card table-ticket-card--" +
                      card.status +
                      (card.status.startsWith("self_") ? " table-ticket-card--mine" : "")
                    }
                    key={String(idx) + "_" + String(card.raffleId) + "_" + String(card.ticket)}
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
                          (card.phone !== "—" && !revealedPhones[card.ticket] ? " is-blurred" : "")
                        }
                        onClick={() => {
                          if (card.phone === "—") return;
                          setRevealedPhones((prev) => ({ ...prev, [card.ticket]: !prev[card.ticket] }));
                        }}
                        aria-label="Показать или скрыть телефон"
                      >
                        {card.phone}
                      </button>
                    </div>
                    <div className="table-ticket-card__line">
                      <span className="table-ticket-card__icon" aria-hidden="true">
                        <Grid2X2 size={12} />
                      </span>
                      <span className="table-ticket-card__tiny">{card.raffleTitle}</span>
                    </div>
                    <div className="table-ticket-card__status">
                      {card.status === "free"
                        ? "Свободен"
                        : card.status === "taken"
                          ? "Занят"
                          : card.status === "self_reserved"
                            ? "Моя бронь"
                            : card.status === "self_pending"
                              ? "На проверке"
                              : "Оплачен"}
                    </div>
                  </article>
                ))
              : null}
          </div>
        </div>
      </div>

      <AppBottomNav
        show={mounted}
        profileLetter={profileLetter}
        authVerified={authVerified}
        onChat={() => router.push("/home/chat")}
        onChatBlocked={() => toast("Войдите, чтобы написать в чат", "warning")}
        forceShowTableTab={hasPurchased}
      />
    </>
  );
}
