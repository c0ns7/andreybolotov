"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { abAuthHeaders } from "../../lib/ab-api";
import AppBottomNav from "./AppBottomNav";
import { useAbSession } from "./AbSessionContext";

type HistoryPayload = {
  raffles?: Array<{
    raffle?: { title?: string; status?: string };
    numbers?: { reserved?: number[]; pending_review?: number[]; confirmed?: number[]; bonus_confirmed?: number[] };
  }>;
};

type TicketCard = {
  ticket: number;
  phone: string;
  raffleTitle: string;
  status: "reserved" | "pending_review" | "confirmed" | "bonus_confirmed";
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
  const [cards, setCards] = useState<TicketCard[]>([]);

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
        const res = await fetch("/api/raffles/participation-history", {
          cache: "no-store",
          headers: abAuthHeaders(),
        });
        const data = (await res.json().catch(() => ({}))) as HistoryPayload & { error?: string };
        if (!res.ok) throw new Error(String(data.error || "Не удалось загрузить таблицу"));
        const phone = formatPhoneRu(session?.phone);
        const next: TicketCard[] = [];
        const rows = Array.isArray(data.raffles) ? data.raffles : [];
        for (const item of rows) {
          const title = String(item.raffle?.title || "Акция");
          const numbers = item.numbers || {};
          const pushNums = (list: number[] | undefined, status: TicketCard["status"]) => {
            const arr = Array.isArray(list) ? list : [];
            for (const n of arr) {
              const x = Math.floor(Number(n));
              if (!Number.isFinite(x) || x <= 0) continue;
              next.push({ ticket: x, phone, raffleTitle: title, status });
            }
          };
          pushNums(numbers.reserved, "reserved");
          pushNums(numbers.pending_review, "pending_review");
          pushNums(numbers.confirmed, "confirmed");
          pushNums(numbers.bonus_confirmed, "bonus_confirmed");
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
    if (!q) return cards;
    return cards.filter((item) => {
      const byTicket = String(item.ticket).includes(queryDigits || q);
      const byPhone = normalizePhone(item.phone).includes(queryDigits);
      return byTicket || byPhone;
    });
  }, [cards, query, queryDigits]);

  const profileLetter = useMemo(() => {
    const n = session?.name?.trim()?.[0] || session?.phone?.replace(/\D/g, "")?.slice(-1) || "К";
    return n.toUpperCase();
  }, [session?.name, session?.phone]);

  const hasPurchased = cards.some((c) => c.status === "confirmed" || c.status === "bonus_confirmed");

  return (
    <>
      <div className={"screen home-screen" + (mounted ? "" : " screen--hidden")}>
        <div className="app-view home-inner table-page">
          <header className="table-page__header">
            <h1 className="table-page__title">Таблица номерков</h1>
            <p className="table-page__subtitle">Поиск по номерку или номеру телефона</p>
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
          </header>
          <div className="table-page__cards">
            {loading ? <p className="table-page__empty">Загрузка...</p> : null}
            {!loading && error ? <p className="table-page__empty">{error}</p> : null}
            {!loading && !error && !cards.length ? <p className="table-page__empty">У вас пока нет номерков.</p> : null}
            {!loading && !error && cards.length && !filtered.length ? <p className="table-page__empty">Ничего не найдено.</p> : null}
            {!loading && !error
              ? filtered.map((card, idx) => (
                  <article className="table-ticket-card" key={String(idx) + "_" + String(card.ticket)}>
                    <div className="table-ticket-card__row">
                      <span className="table-ticket-card__label">Номерок</span>
                      <strong className="table-ticket-card__value">№ {card.ticket}</strong>
                    </div>
                    <div className="table-ticket-card__row">
                      <span className="table-ticket-card__label">Телефон</span>
                      <span className="table-ticket-card__value">{card.phone}</span>
                    </div>
                    <div className="table-ticket-card__row">
                      <span className="table-ticket-card__label">Таблица (акция)</span>
                      <span className="table-ticket-card__value">{card.raffleTitle}</span>
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
