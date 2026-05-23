"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, BadgeCheck, Clock3, Gift, HandHeart, Hash, Hourglass, MapPin, Ticket } from "lucide-react";
import { abAuthHeaders } from "../../lib/ab-api";
import { getAbBlogUnreadCached, invalidateAbBlogUnreadCache } from "../../lib/ab-blog-unread-cache";
import { getAbChatUnreadCached, invalidateAbChatUnreadCache } from "../../lib/ab-chat-unread-cache";
import { getAbMyTicketsCached, invalidateAbMyTicketsCache } from "../../lib/ab-my-tickets-cache";
import {
  getAbParticipationHistoryCached,
  invalidateAbParticipationHistoryCache,
} from "../../lib/ab-participation-history-cache";
import { loadAbSession } from "../../lib/ab-session";
import { AB_USER_WS_EVENT } from "../../lib/ab-user-ws-events";
import { useAbSession } from "./AbSessionContext";
import HomeBlogStubModal from "./HomeBlogStubModal";

type Props = {
  show: boolean;
  profileLetter: string;
  onChat: () => void;
  onChatBlocked?: () => void;
  authVerified: boolean;
  showSearchSheet?: boolean;
  onSearchSheet?: () => void;
  /** Скрыть «Чат» (страница акции /raffle…) */
  hideChat?: boolean;
  /** Показать «Блог» на главной */
  showBlog?: boolean;
  blogEnabled?: boolean;
};

type WholesaleSlotRow = { raffle_id?: number; wholesale_numbers?: number[] };

type TicketsPayload = {
  reserved?: TicketGroup[];
  pending_review?: TicketGroup[];
  confirmed?: TicketGroup[];
  wholesale_slots?: WholesaleSlotRow[];
};

type TicketGroup = {
  raffle?: { id?: number; title?: string; status?: string };
  numbers?: number[];
  order?: { id?: number };
};

type HistoryTimelineStatus = "reserved" | "pending_review" | "confirmed" | "bonus_5plus1" | "bonus_5plus2";

type HistoryTimelineEntry = {
  at?: number;
  status?: HistoryTimelineStatus;
  numbers?: number[];
};

type HistoryPayload = {
  raffles?: Array<{
    raffle?: { title?: string; status?: string };
    timeline?: HistoryTimelineEntry[];
    numbers?: {
      reserved?: number[];
      pending_review?: number[];
      confirmed?: number[];
      bonus_confirmed?: number[];
      bonus_5plus1_confirmed?: number[];
      bonus_5plus2_confirmed?: number[];
    };
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

function BlogNavIcon() {
  return <HandHeart size={22} strokeWidth={2} aria-hidden="true" />;
}

function BlogNavIconWithBadge({ unread }: { unread: number }) {
  return (
    <span className="bottom-nav-btn__icon">
      <BlogNavIcon />
      <span className="bottom-nav-btn__badge" hidden={unread <= 0}>
        {unread > 99 ? "99+" : String(unread)}
      </span>
    </span>
  );
}

function blurIfFocusInsideModalRoot(rootId: string) {
  if (typeof document === "undefined") return;
  const root = document.getElementById(rootId);
  const ae = document.activeElement;
  if (root && ae instanceof HTMLElement && root.contains(ae)) {
    try {
      ae.blur();
    } catch {
      /* ignore */
    }
  }
}

function formatHistoryWhen(ms?: number) {
  const t = Math.floor(Number(ms) || 0);
  if (!Number.isFinite(t) || t < 1) return "—";
  try {
    return new Date(t).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function historyTimelineStatusLabel(status?: HistoryTimelineStatus) {
  if (status === "reserved") return "В брони";
  if (status === "pending_review") return "На проверке";
  if (status === "confirmed") return "Закреплено";
  if (status === "bonus_5plus1") return "Бонус 5+1";
  if (status === "bonus_5plus2") return "Бонус 5+2";
  return "Участие";
}

function historyTimelineRowClass(status?: HistoryTimelineStatus) {
  if (status === "pending_review") return "history-row--pending";
  if (status === "confirmed") return "history-row--confirmed";
  if (status === "bonus_5plus1" || status === "bonus_5plus2") return "history-row--bonus";
  return "";
}

function historyNumbersRow(label: ReactNode, nums?: number[], rowClass = "") {
  const arr = Array.isArray(nums)
    ? nums.map((n) => Math.floor(Number(n))).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (!arr.length) return null;
  const text = arr.map((n) => `№${String(n)}`).join(", ");
  return (
    <p className={"history-row" + (rowClass ? ` ${rowClass}` : "")}>
      <strong className="history-row__label">{label}</strong>{" "}
      <span className="history-row__nums">{text}</span>
    </p>
  );
}

function historyTimelineEntryRow(entry: HistoryTimelineEntry, key: string) {
  const nums = Array.isArray(entry.numbers)
    ? entry.numbers.map((n) => Math.floor(Number(n))).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (!nums.length) return null;
  const status = entry.status;
  const label = historyTimelineStatusLabel(status);
  const rowClass = historyTimelineRowClass(status);
  const icon =
    status === "reserved" ? (
      <Clock3 size={14} strokeWidth={2.2} aria-hidden="true" />
    ) : status === "pending_review" ? (
      <Hourglass size={14} strokeWidth={2.2} aria-hidden="true" />
    ) : status === "confirmed" ? (
      <BadgeCheck size={14} strokeWidth={2.2} aria-hidden="true" />
    ) : status === "bonus_5plus1" || status === "bonus_5plus2" ? (
      <Gift size={14} strokeWidth={2.2} aria-hidden="true" />
    ) : null;
  return (
    <div className="history-entry" key={key}>
      <p className="history-entry__when">{formatHistoryWhen(entry.at)}</p>
      {historyNumbersRow(
        <>
          {icon}
          <span>{label}:</span>
        </>,
        nums,
        rowClass,
      )}
    </div>
  );
}

function historyCardBody(it: NonNullable<HistoryPayload["raffles"]>[number], idx: number) {
  const timeline = Array.isArray(it.timeline) ? it.timeline : [];
  if (timeline.length) {
    return timeline.map((entry, eidx) => historyTimelineEntryRow(entry, `h_${String(idx)}_t_${String(eidx)}`));
  }
  const bonusNums = Array.from(
    new Set(
      [
        ...(it.numbers?.bonus_5plus1_confirmed || []),
        ...(it.numbers?.bonus_5plus2_confirmed || []),
        ...(it.numbers?.bonus_confirmed || []),
      ]
        .map((n) => Math.floor(Number(n)))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ).sort((a, b) => a - b);
  return (
    <>
      {historyNumbersRow(
        <>
          <Clock3 size={14} strokeWidth={2.2} aria-hidden="true" />
          <span>В брони:</span>
        </>,
        it.numbers?.reserved,
      )}
      {historyNumbersRow(
        <>
          <Hourglass size={14} strokeWidth={2.2} aria-hidden="true" />
          <span>На проверке:</span>
        </>,
        it.numbers?.pending_review,
        "history-row--pending",
      )}
      {historyNumbersRow(
        <>
          <BadgeCheck size={14} strokeWidth={2.2} aria-hidden="true" />
          <span>Закреплено:</span>
        </>,
        it.numbers?.confirmed,
        "history-row--confirmed",
      )}
      {historyNumbersRow(
        <>
          <Gift size={14} strokeWidth={2.2} aria-hidden="true" />
          <span>Бонус:</span>
        </>,
        bonusNums,
        "history-row--bonus",
      )}
    </>
  );
}

function mergeTicketGroupsByRaffle(groups: TicketGroup[]): TicketGroup[] {
  const map = new Map<string, TicketGroup>();
  for (const g of groups) {
    const rid = Math.floor(Number(g?.raffle?.id) || 0);
    const title = String(g?.raffle?.title || "").trim();
    const status = String(g?.raffle?.status || "").trim();
    const key = rid > 0 ? `id:${rid}` : `title:${title || "Акция"}`;
    const prev = map.get(key);
    const incoming = Array.isArray(g?.numbers)
      ? g.numbers
          .map((x) => Math.floor(Number(x)))
          .filter((x) => Number.isFinite(x) && x > 0)
      : [];
    if (!prev) {
      const uniq = Array.from(new Set(incoming)).sort((a, b) => a - b);
      map.set(key, {
        raffle: { id: rid > 0 ? rid : undefined, title: title || "Акция", status },
        numbers: uniq,
      });
      continue;
    }
    const mergedNums = Array.from(
      new Set([...(Array.isArray(prev.numbers) ? prev.numbers : []), ...incoming]),
    ).sort((a, b) => a - b);
    prev.numbers = mergedNums;
    if (!prev.raffle?.title && title) {
      prev.raffle = { ...(prev.raffle || {}), title };
    }
    if (!prev.raffle?.status && status) {
      prev.raffle = { ...(prev.raffle || {}), status };
    }
  }
  return Array.from(map.values()).filter((x) => Array.isArray(x.numbers) && x.numbers.length > 0);
}

function collectUserRaffleIds(
  reserved: TicketGroup[],
  pending: TicketGroup[],
  confirmed: TicketGroup[],
  wholesaleSlots: WholesaleSlotRow[],
): Set<number> {
  const ids = new Set<number>();
  const ingest = (groups: TicketGroup[]) => {
    for (const g of groups) {
      const id = Math.floor(Number(g?.raffle?.id) || 0);
      if (id > 0) ids.add(id);
    }
  };
  ingest(reserved);
  ingest(pending);
  ingest(confirmed);
  for (const s of wholesaleSlots) {
    const id = Math.floor(Number(s?.raffle_id) || 0);
    if (id > 0) ids.add(id);
  }
  return ids;
}

/** Акция для блока «Мои билеты»: бронь → участие пользователя → последняя видимая. */
function resolveProfileRaffleId(
  latestVisibleId: number,
  reservedRaffleId: number | null,
  reserved: TicketGroup[],
  pending: TicketGroup[],
  confirmed: TicketGroup[],
  wholesaleSlots: WholesaleSlotRow[],
): number {
  const reservedId = Math.floor(Number(reservedRaffleId) || 0);
  if (reservedId > 0) return reservedId;
  const userIds = collectUserRaffleIds(reserved, pending, confirmed, wholesaleSlots);
  const latest = Math.floor(Number(latestVisibleId) || 0);
  if (latest > 0 && userIds.has(latest)) return latest;
  if (userIds.size > 0) return Math.max(...Array.from(userIds));
  return latest > 0 ? latest : 0;
}

function filterTicketGroupsForProfile(
  groups: TicketGroup[],
  profileRaffleId: number,
  allGroups: TicketGroup[],
): TicketGroup[] {
  if (profileRaffleId <= 0) return groups;
  const filtered = groups.filter((it) => Math.floor(Number(it?.raffle?.id) || 0) === profileRaffleId);
  const hasAnyTickets = allGroups.some((g) => Array.isArray(g?.numbers) && g.numbers!.length > 0);
  if (!filtered.length && hasAnyTickets) return groups;
  return filtered;
}

export default function AppBottomNav({
  show,
  profileLetter,
  onChat,
  onChatBlocked,
  authVerified,
  showSearchSheet,
  onSearchSheet,
  hideChat: hideChatProp,
  showBlog = false,
  blogEnabled = false,
}: Props) {
  const { session } = useAbSession();
  const pathname = usePathname() || "";
  const router = useRouter();
  const hideChat =
    hideChatProp ??
    (pathname === "/home/raffle" || pathname.startsWith("/raffle/") || pathname.includes("/home/raffle/"));
  const [mounted, setMounted] = useState(false);
  const [blogOpen, setBlogOpen] = useState(false);
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
  const [blogUnread, setBlogUnread] = useState(0);
  const [hasLatestVisibleRaffle, setHasLatestVisibleRaffle] = useState(false);
  const [latestVisibleRaffleId, setLatestVisibleRaffleId] = useState(0);
  const [reservedRaffleIdSummary, setReservedRaffleIdSummary] = useState<number | null>(null);
  const historyOpenRef = useRef(false);
  historyOpenRef.current = historyOpen;

  const closeProfileModal = useCallback(() => {
    blurIfFocusInsideModalRoot("modal-profile");
    setProfileOpen(false);
  }, []);

  const closeHistoryModal = useCallback(() => {
    blurIfFocusInsideModalRoot("modal-participation-history");
    setHistoryOpen(false);
  }, []);

  const openHistoryFromProfile = useCallback(() => {
    blurIfFocusInsideModalRoot("modal-profile");
    setProfileOpen(false);
    setHistoryOpen(true);
  }, []);
  const isHome = pathname === "/home";
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
        const [data, summaryRes] = await Promise.all([
          getAbMyTicketsCached({ force: withLoading }),
          fetch("/api/raffles/my-tickets?mode=summary", { cache: "no-store", headers: abAuthHeaders() }).catch(
            () => null,
          ),
        ]);
        const next: TicketsPayload = {
          reserved: Array.isArray(data.reserved) ? data.reserved : [],
          pending_review: Array.isArray(data.pending_review) ? data.pending_review : [],
          confirmed: Array.isArray(data.confirmed) ? data.confirmed : [],
          wholesale_slots: Array.isArray(data.wholesale_slots) ? data.wholesale_slots : [],
        };
        setTickets(next);
        if (summaryRes?.ok) {
          const summary = (await summaryRes.json().catch(() => ({}))) as { reserved_raffle_id?: number | null };
          const rid = Math.floor(Number(summary.reserved_raffle_id ?? 0));
          setReservedRaffleIdSummary(Number.isFinite(rid) && rid > 0 ? rid : null);
        }
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

  const refreshBlogUnread = useCallback(async () => {
    const cur = loadAbSession();
    if (!cur?.token || !authVerified || !showBlog) {
      setBlogUnread(0);
      return;
    }
    if (!blogEnabled && String(cur.role || session?.role || "") !== "admin") {
      setBlogUnread(0);
      return;
    }
    try {
      const unread = await getAbBlogUnreadCached();
      setBlogUnread(unread);
    } catch {
      /* ignore */
    }
  }, [authVerified, showBlog, blogEnabled, session?.role]);

  const refreshLatestVisibleRaffle = useCallback(async () => {
    const cur = loadAbSession();
    if (!cur?.token || !authVerified) {
      setHasLatestVisibleRaffle(false);
      setLatestVisibleRaffleId(0);
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
        setLatestVisibleRaffleId(0);
        return;
      }
      const id = Math.floor(Number(data?.raffle?.id) || 0);
      const cnt = Math.floor(Number(data?.raffle?.ticket_count) || 0);
      const ok = Number.isFinite(id) && id > 0 && Number.isFinite(cnt) && cnt > 0;
      setHasLatestVisibleRaffle(ok);
      setLatestVisibleRaffleId(ok ? id : 0);
    } catch {
      setHasLatestVisibleRaffle(false);
      setLatestVisibleRaffleId(0);
    }
  }, [authVerified]);

  useEffect(() => {
    if (!profileOpen) return;
    void Promise.all([refreshMyTickets(true), refreshLatestVisibleRaffle()]);
  }, [profileOpen, refreshMyTickets, refreshLatestVisibleRaffle]);

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
    void refreshBlogUnread();
  }, [refreshBlogUnread]);

  useEffect(() => {
    if (!authVerified) {
      setReservedRaffleIdSummary(null);
      return;
    }
    void refreshLatestVisibleRaffle();
  }, [authVerified, refreshLatestVisibleRaffle]);

  useEffect(() => {
    blurIfFocusInsideModalRoot("modal-profile");
    blurIfFocusInsideModalRoot("modal-participation-history");
    setProfileOpen(false);
    setHistoryOpen(false);
  }, [pathname]);

  const refreshMyTicketsRef = useRef(refreshMyTickets);
  refreshMyTicketsRef.current = refreshMyTickets;
  const refreshHistoryRef = useRef(refreshHistory);
  refreshHistoryRef.current = refreshHistory;
  const refreshHistorySummaryRef = useRef(refreshHistorySummary);
  refreshHistorySummaryRef.current = refreshHistorySummary;
  const refreshChatUnreadRef = useRef(refreshChatUnread);
  refreshChatUnreadRef.current = refreshChatUnread;
  const refreshBlogUnreadRef = useRef(refreshBlogUnread);
  refreshBlogUnreadRef.current = refreshBlogUnread;
  const refreshLatestVisibleRaffleRef = useRef(refreshLatestVisibleRaffle);
  refreshLatestVisibleRaffleRef.current = refreshLatestVisibleRaffle;

  useEffect(() => {
    const cur = loadAbSession();
    if (!cur?.token || !authVerified) return;
    const onUserWs = (ev: Event) => {
      const d = (ev as CustomEvent<{ type?: string }>).detail;
      if (!d || typeof d !== "object") return;
      if (d.type === "raffle_tickets_updated") {
        invalidateAbParticipationHistoryCache();
        invalidateAbMyTicketsCache();
        void refreshMyTicketsRef.current(true);
        void refreshHistorySummaryRef.current();
        void refreshLatestVisibleRaffleRef.current();
        if (historyOpenRef.current) void refreshHistoryRef.current(true);
      }
      if (d.type === "raffles_feed_updated" || d.type === "raffle_grid_updated") {
        void refreshLatestVisibleRaffleRef.current();
      }
      if (d.type === "chat_message") {
        invalidateAbChatUnreadCache();
        void refreshChatUnreadRef.current();
      }
      if (d.type === "blog_posts_updated" || d.type === "site_blog_enabled_updated") {
        invalidateAbBlogUnreadCache();
        void refreshBlogUnreadRef.current();
      }
    };
    window.addEventListener(AB_USER_WS_EVENT, onUserWs as EventListener);
    return () => window.removeEventListener(AB_USER_WS_EVENT, onUserWs as EventListener);
  }, [authVerified]);

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

  useEffect(() => {
    if (!showBlog || !authVerified) return;
    void refreshBlogUnread();
    const t = window.setInterval(() => {
      void refreshBlogUnread();
    }, 45_000);
    return () => window.clearInterval(t);
  }, [pathname, showBlog, authVerified, refreshBlogUnread]);

  const isAdmin = mounted && String(session?.role || "") === "admin";
  const isBlogRoute = pathname === "/home/blog" || pathname.startsWith("/home/blog/");
  const showBlogUnreadBadge = showBlog && (blogEnabled || isAdmin) && blogUnread > 0;
  const reserved = Array.isArray(tickets.reserved) ? tickets.reserved : [];
  const pending = Array.isArray(tickets.pending_review) ? tickets.pending_review : [];
  const confirmed = Array.isArray(tickets.confirmed) ? tickets.confirmed : [];
  const wholesaleSlotsAll = Array.isArray(tickets.wholesale_slots) ? tickets.wholesale_slots : [];
  const profileRaffleId = useMemo(
    () =>
      resolveProfileRaffleId(
        latestVisibleRaffleId,
        reservedRaffleIdSummary,
        reserved,
        pending,
        confirmed,
        wholesaleSlotsAll,
      ),
    [latestVisibleRaffleId, reservedRaffleIdSummary, reserved, pending, confirmed, wholesaleSlotsAll],
  );
  const allProfileTicketGroups = useMemo(() => [...reserved, ...pending, ...confirmed], [reserved, pending, confirmed]);
  const wholesaleSlots =
    profileRaffleId > 0
      ? wholesaleSlotsAll.filter((s) => Math.floor(Number(s?.raffle_id) || 0) === profileRaffleId)
      : wholesaleSlotsAll;
  const profileReservedRaw = filterTicketGroupsForProfile(reserved, profileRaffleId, allProfileTicketGroups);
  const profilePendingRaw = filterTicketGroupsForProfile(pending, profileRaffleId, allProfileTicketGroups);
  const profileConfirmedRaw = filterTicketGroupsForProfile(confirmed, profileRaffleId, allProfileTicketGroups);
  const profileReserved = useMemo(() => mergeTicketGroupsByRaffle(profileReservedRaw), [profileReservedRaw]);
  const profilePending = useMemo(() => mergeTicketGroupsByRaffle(profilePendingRaw), [profilePendingRaw]);
  const profileConfirmed = useMemo(() => mergeTicketGroupsByRaffle(profileConfirmedRaw), [profileConfirmedRaw]);
  const hasWholesaleNumbers = wholesaleSlots.some(
    (s) => Array.isArray(s?.wholesale_numbers) && s.wholesale_numbers.length > 0,
  );
  const raffleTitleById = useMemo(() => {
    const m = new Map<number, string>();
    const ingest = (groups: TicketGroup[]) => {
      for (const g of groups) {
        const id = Math.floor(Number(g?.raffle?.id) || 0);
        const t = String(g?.raffle?.title || "").trim();
        if (id > 0 && t) m.set(id, t);
      }
    };
    ingest(reserved);
    ingest(pending);
    ingest(confirmed);
    return m;
  }, [reserved, pending, confirmed]);
  const profilePhone = mounted ? formatPhoneRu(session?.phone) : "";
  const profileLocality = mounted ? (session?.locality?.trim() || "Не указано") : "Не указано";
  const profileUserId =
    mounted && session?.id != null && Number(session.id) > 0 ? String(Math.floor(Number(session.id))) : "";
  const profileUserIdDisplay = profileUserId || (mounted ? "—" : "");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!blogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBlogOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [blogOpen]);

  const navSlotCount =
    1 + (showSearchSheet ? 1 : 0) + (showBlog ? 1 : 0) + (!hideChat ? 1 : 0) + 1;
  const navInnerClass =
    "bottom-nav__inner bottom-nav__inner--" + String(Math.min(4, Math.max(3, navSlotCount)));

  return (
    <>
      {showBlog ? <HomeBlogStubModal open={blogOpen} onClose={() => setBlogOpen(false)} /> : null}
      <nav className={"bottom-nav" + (show ? "" : " bottom-nav--hidden")} id="bottom-nav" aria-label="Разделы приложения">
        <button type="button" className="bottom-nav-scrolltop" id="tab-scroll-top" aria-label="Наверх" title="Наверх" hidden />
        <div className={navInnerClass}>
          <Link href="/home" className={"bottom-nav-btn" + (isHome ? " bottom-nav-btn--active" : "")} id="tab-home" aria-label="Главная">
            <span className="bottom-nav-btn__icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </span>
            <span className="bottom-nav-btn__label">Главная</span>
          </Link>
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
          {showBlog ? (
            blogEnabled || isAdmin ? (
              <Link
                href="/home/blog"
                className={
                  "bottom-nav-btn" +
                  (isBlogRoute ? " bottom-nav-btn--active" : "") +
                  (showBlogUnreadBadge ? " bottom-nav-btn--blog-unread" : "")
                }
                id="tab-blog"
                aria-label={blogUnread > 0 ? `Блог, ${blogUnread} новых постов` : "Блог"}
                aria-current={isBlogRoute ? "page" : undefined}
              >
                <BlogNavIconWithBadge unread={blogUnread} />
                <span className="bottom-nav-btn__label">Блог</span>
              </Link>
            ) : (
              <button
                type="button"
                className={"bottom-nav-btn" + (blogOpen ? " bottom-nav-btn--active" : "")}
                id="tab-blog"
                aria-label="Блог"
                aria-expanded={blogOpen}
                onClick={() => setBlogOpen(true)}
              >
                <BlogNavIconWithBadge unread={0} />
                <span className="bottom-nav-btn__label">Блог</span>
              </button>
            )
          ) : null}
          {!hideChat ? (
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
          ) : null}
          <button
            type="button"
            className={"bottom-nav-btn" + (isProfile ? " bottom-nav-btn--active" : "")}
            id="tab-profile"
            aria-label="Профиль"
            onClick={() => {
              blurIfFocusInsideModalRoot("modal-participation-history");
              setHistoryOpen(false);
              setProfileOpen(true);
              void Promise.all([refreshMyTickets(true), refreshLatestVisibleRaffle()]);
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
          if (e.target === e.currentTarget) closeProfileModal();
        }}
      >
        <div className="profile-modal">
          <div className="profile-modal__sheet-handle" aria-hidden="true">
            <div className="cart-sheet__grabber"></div>
          </div>
          <button type="button" className="profile-modal__close" id="profile-modal-close" aria-label="Закрыть" onClick={closeProfileModal}>
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
                  onClick={openHistoryFromProfile}
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
                ) : !profileReserved.length && !profilePending.length && !profileConfirmed.length && !hasWholesaleNumbers ? (
                  <div className="profile-tickets-empty" role="status">
                    <p className="profile-tickets-empty__title">Билетов пока нет</p>
                    <p className="profile-tickets-empty__sub">Участвуйте в акциях!</p>
                  </div>
                ) : (
                  <>
                    {hasWholesaleNumbers ? (
                      <section className="tickets-section tickets-section--wholesale">
                        <h3 className="tickets-section__title">
                          <Hash className="tickets-section__title-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
                          <span>Оптовик</span>
                        </h3>
                        {wholesaleSlots.map((slot, i) => {
                          const nums = Array.isArray(slot?.wholesale_numbers) ? slot.wholesale_numbers : [];
                          if (!nums.length) return null;
                          const rid = Math.floor(Number(slot?.raffle_id) || 0);
                          const title =
                            rid > 0 ? raffleTitleById.get(rid) || `Акция №${rid}` : String(slot?.raffle_id || "Акция");
                          return (
                            <section className="tickets-group tickets-group--wholesale" key={"w_" + String(i) + "_" + String(rid)}>
                              <h3 className="tickets-group__title">{title}</h3>
                              <div className="tickets-group__wholesale">
                                <strong>Номер оптовика</strong>
                                {numChips(nums)}
                              </div>
                            </section>
                          );
                        })}
                      </section>
                    ) : null}
                    {profileReserved.length ? (
                      <section className="tickets-section">
                        <h3 className="tickets-section__title">
                          <Clock3 className="tickets-section__title-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
                          <span>Забронированные</span>
                        </h3>
                        {profileReserved.map((it, i) => (
                          <section className="tickets-group tickets-group--reserved-pending" key={"r_" + String(i)}>
                            <h3 className="tickets-group__title">{String(it.raffle?.title || "Акция")}</h3>
                            {numChips(it.numbers)}
                          </section>
                        ))}
                      </section>
                    ) : null}
                    {profilePending.length ? (
                      <section className="tickets-section tickets-section--pending">
                        <h3 className="tickets-section__title">
                          <Hourglass className="tickets-section__title-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
                          <span>На проверке</span>
                        </h3>
                        {profilePending.map((it, i) => (
                          <section className="tickets-group tickets-group--reserved-pending" key={"p_" + String(i)}>
                            <h3 className="tickets-group__title">{String(it.raffle?.title || "Акция")}</h3>
                            {numChips(it.numbers)}
                          </section>
                        ))}
                      </section>
                    ) : null}
                    {profileConfirmed.length ? (
                      <section className="tickets-section tickets-section--confirmed">
                        <h3 className="tickets-section__title">
                          <BadgeCheck className="tickets-section__title-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
                          <span>Закрепленные</span>
                        </h3>
                        {profileConfirmed.map((it, i) => (
                          <section className="tickets-group tickets-group--confirmed" key={"c_" + String(i)}>
                            <h3 className="tickets-group__title">{String(it.raffle?.title || "Акция")}</h3>
                            {numChips(it.numbers, false)}
                          </section>
                        ))}
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
                  onClick={closeProfileModal}
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
                  closeProfileModal();
                  router.push("/home/settings");
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
              <button type="button" className="profile-modal__btn-back profile-modal__btn-back--row" id="profile-modal-dismiss" onClick={closeProfileModal}>
                Вернуться
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        id="modal-participation-history"
        className={"modal-overlay history-modal" + (historyOpen ? " is-open" : "")}
        aria-hidden={historyOpen ? "false" : "true"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-participation-history-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeHistoryModal();
        }}
      >
        <div className="history-modal__dialog" role="document">
          <button
            type="button"
            className="history-modal__close"
            id="modal-participation-history-close"
            aria-label="Закрыть"
            onClick={closeHistoryModal}
          >
            ✕
          </button>
          <div className="history-modal__inner">
            <div className="history-modal__head">
              <button type="button" className="history-modal__back" aria-label="Назад" onClick={closeHistoryModal}>
                <ArrowLeft size={20} strokeWidth={2} aria-hidden="true" />
              </button>
              <h2 id="modal-participation-history-title" className="history-modal__title">
                История участий
              </h2>
            </div>
            <div className="history-modal__body custom-scrollbar" id="modal-participation-history-body">
              {historyLoading ? (
                <p className="history-modal__status">Загрузка…</p>
              ) : historyError ? (
                <p className="history-modal__status history-modal__status--error">{historyError}</p>
              ) : !history.raffles?.length ? (
                <div className="history-modal__empty">
                  <div className="history-modal__empty-icon" aria-hidden="true">
                    <Ticket size={24} strokeWidth={2} />
                  </div>
                  <p className="history-modal__empty-title">История участия пока пуста</p>
                  <p className="history-modal__empty-text">Здесь появятся ваши номерки по акциям — с датой брони, проверки и закрепления</p>
                </div>
              ) : (
                history.raffles.map((it, idx) => (
                  <article className="history-card" key={"h_" + String(idx)}>
                    <div className="history-card__head">
                      <h3 className="history-card__title">{String(it.raffle?.title || "Акция")}</h3>
                    </div>
                    <div className="history-card__timeline">{historyCardBody(it, idx)}</div>
                  </article>
                ))
              )}
            </div>
            <button type="button" className="history-modal__btn-back" onClick={closeHistoryModal}>
              Назад
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
