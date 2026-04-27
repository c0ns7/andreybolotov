"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, Clock3, Gift, Hash, Hourglass, Mail, MapPin } from "lucide-react";
import { abAuthHeaders } from "../../lib/ab-api";
import { getAbChatUnreadCached, invalidateAbChatUnreadCache } from "../../lib/ab-chat-unread-cache";
import { getAbMyTicketsCached, invalidateAbMyTicketsCache } from "../../lib/ab-my-tickets-cache";
import {
  getAbParticipationHistoryCached,
  invalidateAbParticipationHistoryCache,
} from "../../lib/ab-participation-history-cache";
import { loadAbSession } from "../../lib/ab-session";
import { buildAbWebSocketUrl } from "../../lib/ab-ws";
import { useAbSession } from "./AbSessionContext";

type Props = {
  show: boolean;
  profileLetter: string;
  onChat: () => void;
  onChatBlocked?: () => void;
  authVerified: boolean;
  showSearchSheet?: boolean;
  onSearchSheet?: () => void;
  forceShowTableTab?: boolean;
};

type TicketsPayload = {
  reserved?: TicketGroup[];
  pending_review?: TicketGroup[];
  confirmed?: TicketGroup[];
};

type TicketGroup = {
  raffle?: { id?: number; title?: string; status?: string };
  numbers?: number[];
  order?: { id?: number };
};

type HistoryPayload = {
  raffles?: Array<{
    raffle?: { title?: string; status?: string };
    numbers?: { reserved?: number[]; pending_review?: number[]; confirmed?: number[]; bonus_confirmed?: number[] };
    last_activity_at?: number;
  }>;
};

function formatPhoneRu(raw?: string) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length < 11) return raw || "";
  const n = d.startsWith("8") ? "7" + d.slice(1) : d;
  const a = n.slice(-10);
  return `+7 (${a.slice(0, 3)}) ${a.slice(3, 6)}-${a.slice(6, 8)}-${a.slice(8, 10)}`;
}

function numChips(nums?: number[], readonly = true) {
  const arr = Array.isArray(nums) ? nums : [];
  if (!arr.length) return <p className="tickets-empty__text">Нет номерков</p>;
  return (
    <div className="tickets-chips">
      {arr.map((n) => (
        <span key={String(n)} className={"tickets-chip" + (readonly ? " tickets-chip--readonly" : "")}>
          № {String(n)}
        </span>
      ))}
    </div>
  );
}

function numChipsForHistory(nums?: number[], className = "", readonly = true) {
  const arr = Array.isArray(nums) ? nums : [];
  if (!arr.length) return null;
  return (
    <div className={"tickets-chips " + className}>
      {arr.map((n) => (
        <span key={String(n)} className={"tickets-chip" + (readonly ? " tickets-chip--readonly" : "")}>
          № {String(n)}
        </span>
      ))}
    </div>
  );
}

export default function AppBottomNav({
  show,
  profileLetter,
  onChat,
  onChatBlocked,
  authVerified,
  showSearchSheet,
  onSearchSheet,
  forceShowTableTab,
}: Props) {
  const { session } = useAbSession();
  const pathname = usePathname() || "";
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState("");
  const [tickets, setTickets] = useState<TicketsPayload>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [history, setHistory] = useState<HistoryPayload>({});
  const [profileTicketsBadge, setProfileTicketsBadge] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [hasLatestVisibleRaffle, setHasLatestVisibleRaffle] = useState(false);
  const isHome = pathname === "/home";
  const isTable = pathname === "/home/table";
  const isChat = pathname === "/home/chat";
  const isProfile = profileOpen || pathname === "/home/profile" || pathname === "/home/settings";

  const refreshMyTickets = useCallback(
    async (withLoading = false) => {
      const cur = loadAbSession();
      if (!cur?.token || !authVerified) return;
      if (withLoading) {
        setTicketsLoading(true);
        setTicketsError("");
      }
      try {
        if (withLoading) {
          invalidateAbMyTicketsCache();
        }
        const data = await getAbMyTicketsCached({ force: withLoading });
        const next = {
          reserved: Array.isArray(data.reserved) ? data.reserved : [],
          pending_review: Array.isArray(data.pending_review) ? data.pending_review : [],
          confirmed: Array.isArray(data.confirmed) ? data.confirmed : [],
        };
        setTickets(next);
        const reservedCount = next.reserved.reduce((acc, it) => acc + (Array.isArray(it?.numbers) ? it.numbers.length : 0), 0);
        const pendingCount = next.pending_review.reduce((acc, it) => acc + (Array.isArray(it?.numbers) ? it.numbers.length : 0), 0);
        setProfileTicketsBadge(Math.max(0, reservedCount + pendingCount));
      } catch (e) {
        if (withLoading) setTicketsError(String((e as Error).message || "Ошибка"));
      } finally {
        if (withLoading) setTicketsLoading(false);
      }
    },
    [authVerified],
  );

  const refreshHistory = useCallback(
    async (withLoading = false) => {
      const cur = loadAbSession();
      if (!cur?.token || !authVerified) return;
      if (withLoading) {
        setHistoryLoading(true);
        setHistoryError("");
      }
      try {
        if (withLoading) {
          invalidateAbParticipationHistoryCache();
        }
        const data = (await getAbParticipationHistoryCached({
          force: withLoading,
        })) as HistoryPayload;
        setHistory({ raffles: Array.isArray(data.raffles) ? data.raffles : [] });
      } catch (e) {
        if (withLoading) setHistoryError(String((e as Error).message || "Ошибка"));
      } finally {
        if (withLoading) setHistoryLoading(false);
      }
    },
    [authVerified],
  );

  const refreshHistorySummary = useCallback(async () => {
    const cur = loadAbSession();
    if (!cur?.token || !authVerified) return;
    try {
      const res = await fetch("/api/raffles/participation-history?mode=summary", {
        cache: "no-store",
        headers: abAuthHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as { raffles_count?: number };
      if (!res.ok) return;
    } catch {
      /* ignore */
    }
  }, [authVerified]);

  const refreshChatUnread = useCallback(async () => {
    const cur = loadAbSession();
    if (!cur?.token || !authVerified) return;
    try {
      const unread = await getAbChatUnreadCached();
      setChatUnread(unread);
    } catch {
      /* ignore */
    }
  }, [authVerified]);

  const refreshLatestVisibleRaffle = useCallback(async () => {
    const cur = loadAbSession();
    if (!cur?.token || !authVerified) {
      setHasLatestVisibleRaffle(false);
      return;
    }
    try {
      const res = await fetch("/api/raffles/latest-visible/table", {
        cache: "no-store",
        headers: abAuthHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as { raffle?: { id?: number; ticket_count?: number } | null };
      if (!res.ok) {
        setHasLatestVisibleRaffle(false);
        return;
      }
      const id = Math.floor(Number(data?.raffle?.id) || 0);
      const cnt = Math.floor(Number(data?.raffle?.ticket_count) || 0);
      setHasLatestVisibleRaffle(Number.isFinite(id) && id > 0 && Number.isFinite(cnt) && cnt > 0);
    } catch {
      setHasLatestVisibleRaffle(false);
    }
  }, [authVerified]);

  useEffect(() => {
    if (!profileOpen) return;
    void refreshMyTickets(false);
  }, [profileOpen, refreshMyTickets]);

  useEffect(() => {
    void refreshMyTickets(false);
  }, [refreshMyTickets]);

  useEffect(() => {
    void refreshHistorySummary();
  }, [refreshHistorySummary]);

  useEffect(() => {
    void refreshChatUnread();
  }, [refreshChatUnread]);

  useEffect(() => {
    void refreshLatestVisibleRaffle();
  }, [refreshLatestVisibleRaffle]);

  useEffect(() => {
    const cur = loadAbSession();
    if (!cur?.token || !authVerified) return;
    const wsUrl = buildAbWebSocketUrl(cur.token);
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
        let d: { type?: string };
        try {
          d = JSON.parse(String(ev.data || "{}"));
        } catch {
          return;
        }
        if (d.type === "raffle_tickets_updated") {
          invalidateAbParticipationHistoryCache();
          invalidateAbMyTicketsCache();
          void refreshMyTickets(true);
          void refreshHistorySummary();
          void refreshLatestVisibleRaffle();
          if (historyOpen) void refreshHistory(true);
        }
        if (d.type === "raffles_feed_updated" || d.type === "raffle_grid_updated") {
          void refreshLatestVisibleRaffle();
        }
        if (d.type === "chat_message") {
          invalidateAbChatUnreadCache();
          void refreshChatUnread();
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
  }, [authVerified, refreshMyTickets, refreshHistory, refreshHistorySummary, refreshChatUnread, refreshLatestVisibleRaffle, profileOpen, historyOpen]);

  useEffect(() => {
    if (!historyOpen) return;
    void refreshHistory(true);
  }, [historyOpen, refreshHistory]);

  useEffect(() => {
    if (pathname !== "/home/chat") return;
    void refreshChatUnread();
    const t = window.setInterval(() => {
      void refreshChatUnread();
    }, 10_000);
    return () => window.clearInterval(t);
  }, [pathname, refreshChatUnread]);

  const isAdmin = mounted && String(session?.role || "") === "admin";
  const reserved = Array.isArray(tickets.reserved) ? tickets.reserved : [];
  const pending = Array.isArray(tickets.pending_review) ? tickets.pending_review : [];
  const confirmed = Array.isArray(tickets.confirmed) ? tickets.confirmed : [];
  const hasConfirmedTickets = confirmed.some((it) => Array.isArray(it?.numbers) && it.numbers.length > 0);
  const showTableTab = hasLatestVisibleRaffle && !!(forceShowTableTab || hasConfirmedTickets || isAdmin);
  const confirmedNumbersFlat = useMemo(() => {
    const set = new Set<number>();
    for (const group of confirmed) {
      const nums = Array.isArray(group?.numbers) ? group.numbers : [];
      for (const n of nums) {
        const x = Math.floor(Number(n));
        if (Number.isFinite(x) && x > 0) set.add(x);
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [confirmed]);
  const profilePhone = mounted ? formatPhoneRu(session?.phone) : "";
  const profileEmail = mounted ? session?.email || "Не указано" : "Не указано";
  const profileLocality = mounted ? (session?.locality?.trim() || "Не указано") : "Не указано";
  const profileUserId =
    mounted && session?.id != null && Number(session.id) > 0 ? String(Math.floor(Number(session.id))) : "";
  const profileUserIdDisplay = profileUserId || (mounted ? "—" : "");

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <nav className={"bottom-nav" + (show ? "" : " bottom-nav--hidden")} id="bottom-nav" aria-label="Разделы приложения">
        <button type="button" className="bottom-nav-scrolltop" id="tab-scroll-top" aria-label="Наверх" title="Наверх" hidden />
        <div className="bottom-nav__inner bottom-nav__inner--3">
          <Link href="/home" className={"bottom-nav-btn" + (isHome ? " bottom-nav-btn--active" : "")} id="tab-home" aria-label="Главная">
            <span className="bottom-nav-btn__icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </span>
            <span className="bottom-nav-btn__label">Главная</span>
          </Link>
          {showTableTab ? (
            <Link href="/home/table" className={"bottom-nav-btn" + (isTable ? " bottom-nav-btn--active" : "")} id="tab-table" aria-label="Таблица">
              <span className="bottom-nav-btn__icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M3 10h18" />
                  <path d="M9 4v16" />
                  <path d="M15 4v16" />
                </svg>
              </span>
              <span className="bottom-nav-btn__label">Таблица</span>
            </Link>
          ) : null}
          {showSearchSheet ? (
            <button type="button" className="bottom-nav-btn bottom-nav-btn--dock-search" id="tab-ticket-search" aria-label="Поиск" onClick={onSearchSheet}>
              <span className="bottom-nav-btn__icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m21 21-4.34-4.34" />
                  <circle cx="11" cy="11" r="8" />
                </svg>
              </span>
              <span className="bottom-nav-btn__label">Поиск</span>
            </button>
          ) : null}
          <button
            type="button"
            className={
              "bottom-nav-btn" +
              (isChat ? " bottom-nav-btn--active" : "") +
              (!isChat && chatUnread > 0 ? " bottom-nav-btn--chat-unread" : "")
            }
            id="tab-chat"
            aria-label="Чат"
            onClick={() => {
              const cur = loadAbSession();
              if (!cur?.token || !authVerified) {
                onChatBlocked?.();
                return;
              }
              setChatUnread(0);
              invalidateAbChatUnreadCache();
              onChat();
            }}
          >
            <span className="bottom-nav-btn__icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
              </svg>
              <span className="bottom-nav-btn__badge" hidden={chatUnread <= 0}>
                {chatUnread > 99 ? "99+" : String(chatUnread)}
              </span>
            </span>
            <span className="bottom-nav-btn__label">Чат</span>
          </button>
          <button
            type="button"
            className={"bottom-nav-btn" + (isProfile ? " bottom-nav-btn--active" : "")}
            id="tab-profile"
            aria-label="Профиль"
            onClick={() => {
              setHistoryOpen(false);
              setProfileOpen(true);
            }}
          >
            <span className="bottom-nav-btn__icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 21v-1a7 7 0 0 0-14 0v1" />
                <circle cx="12" cy="8" r="4" />
              </svg>
              <span className="bottom-nav-btn__badge" hidden={!profileTicketsBadge}>
                {profileTicketsBadge > 99 ? "99+" : String(profileTicketsBadge)}
              </span>
            </span>
            <span className="bottom-nav-btn__label">Профиль</span>
          </button>
        </div>
      </nav>
      <div
        id="modal-profile"
        className={"modal-overlay modal-overlay--profile" + (profileOpen ? " is-open" : "")}
        aria-hidden={profileOpen ? "false" : "true"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-heading"
        onClick={(e) => {
          if (e.target === e.currentTarget) setProfileOpen(false);
        }}
      >
        <div className="profile-modal">
          <div className="profile-modal__sheet-handle" aria-hidden="true">
            <div className="cart-sheet__grabber"></div>
          </div>
          <button type="button" className="profile-modal__close" id="profile-modal-close" aria-label="Закрыть" onClick={() => setProfileOpen(false)}>
            ✕
          </button>
          <div className="profile-modal__body">
            <div className="profile-modal__hero">
              <div className="profile-modal__avatar" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
              <h3 id="profile-modal-heading" className="profile-modal__title">Профиль</h3>
              <p id="profile-modal-phone-hero" className="profile-modal__phone-sub" suppressHydrationWarning>{profilePhone}</p>
            </div>
            <div className="profile-modal__card profile-modal__kv-list">
              <div className="profile-modal__kv-row">
                <div className="profile-modal__kv-left">
                  <span className="profile-modal__kv-icon profile-modal__kv-icon--id" aria-hidden="true">
                    <Hash size={18} strokeWidth={2.2} />
                  </span>
                  <span className="profile-modal__kv-label">Идентификатор</span>
                </div>
                <div
                  id="profile-field-user-id"
                  className="profile-modal__kv-value profile-modal__value--mono"
                  suppressHydrationWarning
                >
                  {profileUserIdDisplay}
                </div>
              </div>
              <div className="profile-modal__kv-row">
                <div className="profile-modal__kv-left">
                  <span className="profile-modal__kv-icon profile-modal__kv-icon--email" aria-hidden="true">
                    <Mail size={18} strokeWidth={2.2} />
                  </span>
                  <span className="profile-modal__kv-label">EMAIL</span>
                </div>
                <div id="profile-field-email" className="profile-modal__kv-value" suppressHydrationWarning>
                  {profileEmail}
                </div>
              </div>
              <div className="profile-modal__kv-row">
                <div className="profile-modal__kv-left">
                  <span className="profile-modal__kv-icon profile-modal__kv-icon--locality" aria-hidden="true">
                    <MapPin size={18} strokeWidth={2.2} />
                  </span>
                  <span className="profile-modal__kv-label">Населенный пункт</span>
                </div>
                <div id="profile-field-locality" className="profile-modal__kv-value" suppressHydrationWarning>
                  {profileLocality}
                </div>
              </div>
            </div>
            <div className="profile-modal__tickets-card">
              <div className="profile-modal__tickets-card-head">
                <div className="profile-modal__tickets-card-head-left">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="profile-modal__tickets-card-head-icon"
                    aria-hidden="true"
                  >
                    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"></path>
                    <path d="M13 5v2"></path>
                    <path d="M13 17v2"></path>
                    <path d="M13 11v2"></path>
                  </svg>
                  <span className="profile-modal__tickets-card-label">Мои билеты</span>
                </div>
                <button
                  type="button"
                  className="profile-modal__tickets-history-btn"
                  id="profile-open-history"
                  onClick={() => {
                    setProfileOpen(false);
                    setHistoryOpen(true);
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M3 3v5h5"></path>
                    <path d="M3.05 13a9 9 0 1 0 .5-4.5L8 13"></path>
                    <path d="M12 7v5l3 2"></path>
                  </svg>
                  <span>История</span>
                </button>
              </div>
              <div id="profile-tickets-body" className="profile-modal__tickets-body custom-scrollbar" data-profile-tickets="1">
                {ticketsLoading ? (
                  <p className="history-empty">Загрузка...</p>
                ) : ticketsError ? (
                  <p className="profile-modal__tickets-err">{ticketsError}</p>
                ) : !reserved.length && !pending.length && !confirmed.length ? (
                  <div className="profile-tickets-empty" role="status">
                    <p className="profile-tickets-empty__title">Билетов пока нет</p>
                    <p className="profile-tickets-empty__sub">Участвуйте в акциях!</p>
                  </div>
                ) : (
                  <>
                    {reserved.length ? (
                      <section className="tickets-section">
                        <h3 className="tickets-section__title">
                          <Clock3 className="tickets-section__title-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
                          <span>Забронированные</span>
                        </h3>
                        {reserved.map((it, i) => (
                          <section className="tickets-group tickets-group--reserved-pending" key={"r_" + String(i)}>
                            <h3 className="tickets-group__title">{String(it.raffle?.title || "Акция")}</h3>
                            {numChips(it.numbers)}
                          </section>
                        ))}
                      </section>
                    ) : null}
                    {pending.length ? (
                      <section className="tickets-section tickets-section--pending">
                        <h3 className="tickets-section__title">
                          <Hourglass className="tickets-section__title-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
                          <span>На проверке</span>
                        </h3>
                        {pending.map((it, i) => (
                          <section className="tickets-group tickets-group--reserved-pending" key={"p_" + String(i)}>
                            <h3 className="tickets-group__title">{String(it.raffle?.title || "Акция")}</h3>
                            {numChips(it.numbers)}
                          </section>
                        ))}
                      </section>
                    ) : null}
                    {confirmed.length ? (
                      <section className="tickets-section tickets-section--confirmed">
                        <h3 className="tickets-section__title">
                          <BadgeCheck className="tickets-section__title-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
                          <span>Закрепленные</span>
                        </h3>
                        {numChips(confirmedNumbersFlat, false)}
                      </section>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className="profile-modal__actions-row">
              {isAdmin ? (
                <Link
                  href="/admin"
                  className="profile-modal__icon-settings profile-modal__icon-settings--admin"
                  id="link-admin"
                  aria-label="Панель администратора"
                  title="Панель администратора"
                  onClick={() => setProfileOpen(false)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 2 4 6v6c0 5 3.4 9.4 8 10 4.6-.6 8-5 8-10V6l-8-4z"></path>
                    <path d="M9.5 12.5 11 14l3.5-3.5"></path>
                  </svg>
                </Link>
              ) : null}
              <button
                type="button"
                className="profile-modal__icon-settings"
                id="link-profile-settings"
                aria-label="Настройки"
                title="Настройки"
                onClick={() => {
                  setProfileOpen(false);
                  router.push("/home/settings");
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
              <button type="button" className="profile-modal__btn-back profile-modal__btn-back--row" id="profile-modal-dismiss" onClick={() => setProfileOpen(false)}>
                Вернуться
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        id="modal-participation-history"
        className={"modal-overlay modal-overlay--tickets" + (historyOpen ? " is-open" : "")}
        aria-hidden={historyOpen ? "false" : "true"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-participation-history-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) setHistoryOpen(false);
        }}
      >
        <div className="modal modal--tickets-sheet">
          <div className="cart-sheet__grabber" aria-hidden="true"></div>
          <div className="tickets-sheet__header">
            <div className="tickets-sheet__header-text">
              <h2 id="modal-participation-history-title" className="tickets-sheet__title">
                История участий
              </h2>
              <p className="tickets-sheet__subtitle">Все акции и ваши номерки по ним</p>
            </div>
            <button type="button" className="tickets-sheet__close" id="modal-participation-history-close" aria-label="Закрыть" onClick={() => setHistoryOpen(false)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          <div className="tickets-sheet__body custom-scrollbar" id="modal-participation-history-body">
            {historyLoading ? (
              <p className="history-empty">Загрузка...</p>
            ) : historyError ? (
              <p className="history-empty">{historyError}</p>
            ) : !history.raffles?.length ? (
              <p className="history-empty">История участия пока пуста.</p>
            ) : (
              history.raffles.map((it, idx) => (
                <article className="history-card" key={"h_" + String(idx)}>
                  <div className="history-card__head">
                    <h3 className="history-card__title">{String(it.raffle?.title || "Акция")}</h3>
                  </div>
                  {it.numbers?.reserved?.length ? (
                    <div className="history-row">
                      <strong className="history-row__label">
                        <Clock3 size={14} strokeWidth={2.2} aria-hidden="true" />
                        <span>В брони:</span>
                      </strong>
                      {numChipsForHistory(it.numbers.reserved, "", true)}
                    </div>
                  ) : null}
                  {it.numbers?.pending_review?.length ? (
                    <div className="history-row history-row--pending">
                      <strong className="history-row__label">
                        <Hourglass size={14} strokeWidth={2.2} aria-hidden="true" />
                        <span>На проверке:</span>
                      </strong>
                      {numChipsForHistory(it.numbers.pending_review, "history-row__chips--pending", true)}
                    </div>
                  ) : null}
                  {it.numbers?.confirmed?.length ? (
                    <div className="history-row history-row--confirmed">
                      <strong className="history-row__label">
                        <BadgeCheck size={14} strokeWidth={2.2} aria-hidden="true" />
                        <span>Закреплено:</span>
                      </strong>
                      {numChipsForHistory(it.numbers.confirmed, "history-row__chips--confirmed", false)}
                    </div>
                  ) : null}
                  {it.numbers?.bonus_confirmed?.length ? (
                    <div className="history-row history-row--bonus">
                      <strong className="history-row__label">
                        <Gift size={14} strokeWidth={2.2} aria-hidden="true" />
                        <span>Бонус 5+1:</span>
                      </strong>
                      {numChipsForHistory(it.numbers.bonus_confirmed, "history-row__chips--bonus", true)}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
