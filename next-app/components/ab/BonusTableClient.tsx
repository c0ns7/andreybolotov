"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Award, ChevronLeft, Gift, Hash, Phone, PhoneCall, Sparkles, Trophy } from "lucide-react";
import { abApiJson, AbApiError } from "../../lib/ab-api";
import { isStaffRole } from "../../lib/ab-admin-roles";
import { formatRuPhoneInput, phoneToNormalized } from "../../lib/ab-phone";
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

function phoneSearchKey(raw?: string) {
  return phoneToNormalized(String(raw || ""));
}

function hasPhoneSearch(raw: string) {
  return phoneSearchKey(raw).length > 1;
}

function formatPhoneRu(raw?: string) {
  const d = normalizePhone(raw);
  if (d.length < 11) return raw || "—";
  const n = d.startsWith("8") ? "7" + d.slice(1) : d;
  const a = n.slice(-10);
  return `+7 (${a.slice(0, 3)}) ${a.slice(3, 6)}-${a.slice(6, 8)}-${a.slice(8, 10)}`;
}

/** Номер для tel: в формате 89528144572 */
function phoneToCall8(raw?: string): string {
  const n = phoneToNormalized(String(raw || ""));
  if (n.length < 11) return "";
  const ten = n.slice(-10);
  return "8" + ten;
}

export default function BonusTableClient({ slug }: { slug: string }) {
  const router = useRouter();
  const { session, authVerified, authCheckInFlight, toast } = useAbSession();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [positionQuery, setPositionQuery] = useState("");
  const [phoneQuery, setPhoneQuery] = useState("");
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

  const positionDigits = useMemo(() => String(positionQuery || "").replace(/\D/g, ""), [positionQuery]);
  const phoneDigits = useMemo(() => phoneSearchKey(phoneQuery), [phoneQuery]);
  const phoneSearchActive = phoneDigits.length > 1;

  const filtered = useMemo(() => {
    if (!positionDigits && !phoneSearchActive) return entries;
    return entries.filter((item) => {
      const byPos = !positionDigits || String(item.position).includes(positionDigits);
      const entryPhone = phoneSearchKey(item.phone);
      const byPhone =
        !phoneSearchActive ||
        entryPhone.includes(phoneDigits) ||
        entryPhone.slice(1).includes(phoneDigits.slice(1));
      return byPos && byPhone;
    });
  }, [entries, positionDigits, phoneDigits, phoneSearchActive]);

  const myPositions = useMemo(() => {
    const fromApi = Array.isArray(payload?.my_positions) ? payload!.my_positions! : [];
    if (fromApi.length) return fromApi;
    return entries.filter((e) => e.is_mine).map((e) => e.position);
  }, [payload, entries]);

  const profileLetter = useMemo(() => {
    const n = session?.name?.trim()?.[0] || session?.phone?.replace(/\D/g, "")?.slice(-1) || "К";
    return n.toUpperCase();
  }, [session?.name, session?.phone]);

  const isAdmin = isStaffRole(session?.role);

  const table = payload?.table;
  const raffleTitle = String(payload?.raffle_title || "Акция");
  const listRef = useRef<HTMLDivElement>(null);
  const revealFilterKey = `${positionDigits}|${phoneDigits}`;

  useEffect(() => {
    if (loading || !filtered.length) return;
    const root = listRef.current;
    if (!root) return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pending = root.querySelectorAll<HTMLElement>("[data-bonus-row-reveal]");

    if (!pending.length) return;

    if (prefersReduced) {
      pending.forEach((el) => {
        el.classList.add("bonus-table-row--revealed");
        el.removeAttribute("data-bonus-row-reveal");
      });
      return;
    }

    let stagger = 0;
    let staggerResetTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (!visible.length) return;

        visible.sort(
          (a, b) => (a.target as HTMLElement).offsetTop - (b.target as HTMLElement).offsetTop,
        );

        visible.forEach((entry) => {
          const el = entry.target as HTMLElement;
          el.style.setProperty("--bonus-row-delay", `${stagger}ms`);
          stagger += 52;
          el.classList.add("bonus-table-row--revealed");
          el.removeAttribute("data-bonus-row-reveal");
          observer.unobserve(el);
        });

        if (staggerResetTimer) clearTimeout(staggerResetTimer);
        staggerResetTimer = setTimeout(() => {
          stagger = 0;
        }, 420);
      },
      { root: null, rootMargin: "0px 0px -4% 0px", threshold: 0.12 },
    );

    pending.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      if (staggerResetTimer) clearTimeout(staggerResetTimer);
    };
  }, [loading, filtered, revealFilterKey]);

  return (
    <>
      <div className={"screen home-screen" + (mounted ? "" : " screen--hidden")}>
        <div className="app-view home-inner bonus-table-page">
          <header className="bonus-table-page__header">
            <div className="bonus-table-page__topbar">
              <button
                type="button"
                className="bonus-table-page__back"
                onClick={() => router.push("/home")}
                aria-label="На главную"
                title="На главную"
              >
                <ChevronLeft size={22} strokeWidth={2.25} aria-hidden="true" />
              </button>
              <div className="bonus-table-page__badge">
                <Gift size={14} aria-hidden="true" />
                <span>Бонусная таблица</span>
              </div>
            </div>

            <div className="bonus-table-page__hero">
              <h1 className="bonus-table-page__title">{table?.title || "Загрузка…"}</h1>
              <p className="bonus-table-page__subtitle">{raffleTitle}</p>
              {table?.condition_label ? (
                <p className="bonus-table-page__condition">{table.condition_label}</p>
              ) : null}
            </div>

            {table?.description ? <p className="bonus-table-page__description">{table.description}</p> : null}

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

            {myPositions.length ? (
              <div className="bonus-table-page__mine-banner" role="status">
                <Sparkles size={16} aria-hidden="true" />
                <span>
                  Ваше место:{" "}
                  <strong>{myPositions.map((p) => `#${p}`).join(", ")}</strong>
                </span>
              </div>
            ) : null}

            <div className="bonus-table-page__searches">
              <label className="bonus-table-page__search">
                <Hash size={16} aria-hidden="true" />
                <input
                  type="text"
                  inputMode="numeric"
                  value={positionQuery}
                  onChange={(e) => setPositionQuery(String(e.target.value || "").replace(/\D/g, "").slice(0, 6))}
                  placeholder="Место, например 3"
                  aria-label="Поиск по месту в таблице"
                />
              </label>
              <label
                className={
                  "bonus-table-page__search" +
                  (hasPhoneSearch(phoneQuery) && phoneDigits.length < 11 ? " bonus-table-page__search--partial" : "")
                }
              >
                <Phone size={16} aria-hidden="true" />
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phoneQuery}
                  onChange={(e) => setPhoneQuery(formatRuPhoneInput(e.target.value))}
                  placeholder="+7 (___) ___-__-__"
                  aria-label="Поиск по номеру телефона"
                />
              </label>
            </div>
          </header>

          <div className="bonus-table-page__list" ref={listRef}>
            {loading ? <p className="bonus-table-page__empty">Загрузка списка…</p> : null}
            {!loading && error ? <p className="bonus-table-page__empty bonus-table-page__empty--error">{error}</p> : null}
            {!loading && !error && !entries.length ? (
              <p className="bonus-table-page__empty">Пока никто не попал в бонусную таблицу.</p>
            ) : null}
            {!loading && !error && entries.length && !filtered.length ? (
              <p className="bonus-table-page__empty">Ничего не найдено.</p>
            ) : null}
            {!loading && !error
              ? filtered.map((row) => {
                  const callNumber = isAdmin ? phoneToCall8(row.phone) : "";
                  return (
                    <article
                      key={`row-${row.position}-${revealFilterKey}`}
                      data-bonus-row-reveal=""
                      className={
                        "bonus-table-row" +
                        (row.is_mine ? " bonus-table-row--mine" : "") +
                        (isAdmin ? " bonus-table-row--admin" : "")
                      }
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
                      {isAdmin && callNumber ? (
                        <a
                          className="bonus-table-row__call"
                          href={`tel:${callNumber}`}
                          aria-label={`Позвонить ${callNumber}`}
                          title={`Позвонить ${callNumber}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <PhoneCall size={16} strokeWidth={2.2} aria-hidden="true" />
                        </a>
                      ) : null}
                    </article>
                  );
                })
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
      />
    </>
  );
}
