"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Award, ChevronLeft, Gift, Phone, Search, Sparkles, Trophy } from "lucide-react";
import { abApiJson, AbApiError } from "../../lib/ab-api";
import AppBottomNav from "./AppBottomNav";
import { useAbSession } from "./AbSessionContext";

type BonusTableEntry = {
  position: number;
  phone: string;
  is_mine: boolean;
  created_at: number;
};

type BonusTablePayload = {
  table?: {
    id: number;
    title: string;
    description?: string;
    condition_label?: string;
    entry_count?: number;
    start_at_local?: string;
    end_at_local?: string;
    status?: string;
  };
  entries?: BonusTableEntry[];
  my_positions?: number[];
  raffle_title?: string;
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

export default function BonusTableClient({ slug }: { slug: string }) {
  const router = useRouter();
  const { session, authVerified, authCheckInFlight } = useAbSession();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [payload, setPayload] = useState<BonusTablePayload | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (authCheckInFlight) return;
    if (!session?.token || !authVerified) {
      router.replace("/?login=1");
      return;
    }
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await abApiJson<BonusTablePayload>(`/api/bonus-tables/${encodeURIComponent(slug)}`);
        if (!disposed) setPayload(data);
      } catch (e) {
        if (!disposed) {
          const msg = e instanceof AbApiError ? e.message : String((e as Error).message || "Ошибка загрузки");
          setError(msg);
          setPayload(null);
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [slug, session?.token, authVerified, authCheckInFlight, router]);

  const entries = useMemo(() => {
    const rows = Array.isArray(payload?.entries) ? payload!.entries! : [];
    return [...rows].sort((a, b) => a.position - b.position);
  }, [payload]);

  const queryDigits = useMemo(() => normalizePhone(query), [query]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((item) => {
      const byPos = String(item.position).includes(q);
      const byPhone = normalizePhone(item.phone).includes(queryDigits);
      return byPos || byPhone;
    });
  }, [entries, query, queryDigits]);

  const myPositions = useMemo(() => {
    const fromApi = Array.isArray(payload?.my_positions) ? payload!.my_positions! : [];
    if (fromApi.length) return fromApi;
    return entries.filter((e) => e.is_mine).map((e) => e.position);
  }, [payload, entries]);

  const table = payload?.table;
  const raffleTitle = String(payload?.raffle_title || "Акция");

  return (
    <>
      <div className={"screen home-screen" + (mounted ? "" : " screen--hidden")}>
        <div className="app-view home-inner bonus-table-page">
          <header className="bonus-table-page__header">
            <div className="bonus-table-page__head-row">
              <button
                type="button"
                className="bonus-table-page__back"
                onClick={() => router.push("/home")}
                aria-label="На главную"
              >
                <ChevronLeft size={22} strokeWidth={2.25} />
              </button>
              <div className="bonus-table-page__head-titles">
                <div className="bonus-table-page__badge">
                  <Gift size={14} aria-hidden="true" />
                  <span>Бонусная таблица</span>
                </div>
                <h1 className="bonus-table-page__title">{table?.title || "Загрузка…"}</h1>
                <p className="bonus-table-page__subtitle">
                  {raffleTitle}
                  {table?.condition_label ? ` · ${table.condition_label}` : ""}
                </p>
              </div>
            </div>

            {table?.description ? <p className="bonus-table-page__description">{table.description}</p> : null}

            {myPositions.length ? (
              <div className="bonus-table-page__mine-banner" role="status">
                <Sparkles size={16} aria-hidden="true" />
                <span>
                  Ваше место в таблице:{" "}
                  <strong>{myPositions.map((p) => `#${p}`).join(", ")}</strong>
                </span>
              </div>
            ) : null}

            <label className="bonus-table-page__search">
              <Search size={16} aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по номеру телефона или месту"
                aria-label="Поиск"
              />
            </label>
          </header>

          <div className="bonus-table-page__stats">
            <div className="bonus-table-page__stat">
              <Trophy size={15} aria-hidden="true" />
              <span>{table?.entry_count ?? entries.length} участников</span>
            </div>
            {table?.status === "active" ? (
              <div className="bonus-table-page__stat bonus-table-page__stat--live">
                <Award size={15} aria-hidden="true" />
                <span>Активна</span>
              </div>
            ) : null}
          </div>

          <div className="bonus-table-page__list">
            {loading ? <p className="bonus-table-page__empty">Загрузка списка…</p> : null}
            {!loading && error ? <p className="bonus-table-page__empty bonus-table-page__empty--error">{error}</p> : null}
            {!loading && !error && !entries.length ? (
              <p className="bonus-table-page__empty">Пока никто не попал в бонусную таблицу.</p>
            ) : null}
            {!loading && !error && entries.length && !filtered.length ? (
              <p className="bonus-table-page__empty">Ничего не найдено.</p>
            ) : null}
            {!loading && !error
              ? filtered.map((row, idx) => (
                  <article
                    key={String(row.position) + "_" + String(idx)}
                    className={
                      "bonus-table-row" + (row.is_mine ? " bonus-table-row--mine" : "") + " bonus-table-row--appear"
                    }
                    style={{ animationDelay: `${Math.min(idx, 12) * 40}ms` }}
                  >
                    <div className="bonus-table-row__pos">
                      <span className="bonus-table-row__pos-hash">#</span>
                      {row.position}
                    </div>
                    <div className="bonus-table-row__phone-wrap">
                      <Phone size={14} className="bonus-table-row__phone-ico" aria-hidden="true" />
                      <span className="bonus-table-row__phone">{formatPhoneRu(row.phone)}</span>
                      {row.is_mine ? <span className="bonus-table-row__you">Вы</span> : null}
                    </div>
                  </article>
                ))
              : null}
          </div>
        </div>
      </div>
      <AppBottomNav active="home" />
    </>
  );
}
