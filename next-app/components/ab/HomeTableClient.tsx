"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Grid2X2, Phone, Search, Ticket } from "lucide-react";
import { abAuthHeaders } from "../../lib/ab-api";
import AppBottomNav from "./AppBottomNav";
import { useAbSession } from "./AbSessionContext";

type RaffleDto = { id?: number; title?: string; ticket_count?: number };
type RafflesPayload = { raffles?: RaffleDto[]; error?: string };
type SliceCell = { n?: number; kind?: string };
type SlicePayload = { cells?: SliceCell[]; error?: string };

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
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const rafflesRes = await fetch("/api/raffles", {
          cache: "no-store",
          headers: abAuthHeaders(),
        });
        const rafflesData = (await rafflesRes.json().catch(() => ({}))) as RafflesPayload;
        if (!rafflesRes.ok) throw new Error(String(rafflesData.error || "Не удалось загрузить акции"));
        const raffleRows = Array.isArray(rafflesData.raffles) ? rafflesData.raffles : [];
        const latestActive = raffleRows
          .filter((r) => String((r as { status?: string }).status || "") === "active")
          .sort((a, b) => Math.floor(Number(b.id) || 0) - Math.floor(Number(a.id) || 0))[0];
        const raffleId = Math.floor(Number(latestActive?.id));
        if (!Number.isFinite(raffleId) || raffleId <= 0) {
          if (!disposed) {
            setCards([]);
            setRaffleTitle("");
          }
          return;
        }

        const raffleRes = await fetch("/api/raffles/" + String(raffleId), {
          cache: "no-store",
          headers: abAuthHeaders(),
        });
        const raffleData = (await raffleRes.json().catch(() => ({}))) as { raffle?: RaffleDto; error?: string };
        if (!raffleRes.ok) throw new Error(String(raffleData.error || "Не удалось загрузить таблицу"));
        const ticketCount = Math.max(0, Math.floor(Number(raffleData.raffle?.ticket_count) || 0));
        const title = String(raffleData.raffle?.title || latestActive?.title || "Акция");
        if (!disposed) setRaffleTitle(title);
        if (!ticketCount) {
          if (!disposed) setCards([]);
          return;
        }

        const myPhone = formatPhoneRu(session?.phone);
        const next: TicketCard[] = [];

        const cellByNumber = new Map<number, string>();
        for (let from = 1; from <= ticketCount; from += 500) {
          const to = Math.min(from + 499, ticketCount);
          const sliceRes = await fetch(
            "/api/raffles/" + String(raffleId) + "/tickets?from=" + String(from) + "&to=" + String(to),
            { cache: "no-store", headers: abAuthHeaders() },
          );
          const sliceData = (await sliceRes.json().catch(() => ({}))) as SlicePayload;
          if (!sliceRes.ok) throw new Error(String(sliceData.error || "Не удалось загрузить таблицу"));
          const cells = Array.isArray(sliceData.cells) ? sliceData.cells : [];
          for (const c of cells) {
            const n = Math.floor(Number(c.n));
            if (!Number.isFinite(n) || n <= 0) continue;
            cellByNumber.set(n, String(c.kind || "free"));
          }
        }

        for (let n = 1; n <= ticketCount; n++) {
          const kindRaw = String(cellByNumber.get(n) || "free");
          const status: TicketCard["status"] =
            kindRaw === "taken"
              ? "taken"
              : kindRaw === "self_pending"
                ? "self_pending"
                : kindRaw === "self_reserved"
                  ? "self_reserved"
                  : kindRaw === "self_confirmed"
                    ? "self_confirmed"
                    : "free";
          next.push({
            raffleId,
            ticket: n,
            phone: status.startsWith("self_") ? myPhone : "—",
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
    void load();
    return () => {
      disposed = true;
    };
  }, [session?.token, session?.phone, authVerified, authCheckInFlight, router]);

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
            <h1 className="table-page__title">Таблица номерков</h1>
            <p className="table-page__subtitle">
              {raffleTitle ? `Последняя активная акция: ${raffleTitle}` : "Поиск по номерку или номеру телефона"}
            </p>
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
            {!loading && !error && !cards.length ? <p className="table-page__empty">Нет данных по акциям.</p> : null}
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
                      <span className="table-ticket-card__tiny">{card.phone}</span>
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
