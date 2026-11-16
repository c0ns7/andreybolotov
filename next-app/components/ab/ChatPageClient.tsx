"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  Gift,
  MessageCircle,
  PartyPopper,
  Sparkles,
  Ticket,
  Trophy,
} from "lucide-react";
import { abApiJson, abAuthHeaders, AbApiError } from "../../lib/ab-api";
import { prefetchMediaUrl } from "../../lib/ab-media-cache";
import { useAbSession } from "./AbSessionContext";

type ChatMsg = {
  id: number;
  is_staff?: boolean;
  body?: string;
  created_at?: number;
  read_by_staff?: boolean;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_mime?: string | null;
};
type ChatListResponse = { messages?: ChatMsg[]; has_more?: boolean };
type ChatActionCard = {
  kind: string;
  title?: string;
  reason?: string;
  subtitle?: string;
  headline?: string;
  eyebrow?: string;
  message?: string;
  variant?: string;
  retry_url?: string;
  claim_url?: string;
  open_url?: string;
  prize_id?: number;
  prize_type?: string;
  cta?: string;
  positions?: number[];
  paid_tickets?: number[];
  bonus_tickets?: number[];
  bonus_promo?: string | null;
  max_join_url?: string;
  max_cta?: string;
};
type ChatTextPart = { type: "text"; value: string } | { type: "max_join"; href: string };
type ChatAttachmentDto = { url: string; name: string; mime: string };

const CHAT_IMAGE_SKIP_COMPRESS_BELOW_BYTES = 1.2 * 1024 * 1024;
const CHAT_IMAGE_MAX_LONG_EDGE = 1920;
const CHAT_IMAGE_JPEG_QUALITY = 0.82;

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      resolve(im);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("IMAGE_DECODE"));
    };
    im.src = url;
  });
}

async function prepareChatUploadFile(file: File): Promise<File> {
  const type = String(file.type || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (!type.startsWith("image/")) return file;
  if (file.size > 0 && file.size < CHAT_IMAGE_SKIP_COMPRESS_BELOW_BYTES) return file;
  let img: HTMLImageElement;
  try {
    img = await loadImageFromFile(file);
  } catch {
    return file;
  }
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (!w || !h) return file;
  const scale = Math.min(1, CHAT_IMAGE_MAX_LONG_EDGE / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/jpeg", CHAT_IMAGE_JPEG_QUALITY);
    } catch {
      resolve(null);
    }
  });
  if (!blob || blob.size <= 0) return file;
  if (blob.size >= file.size * 0.97) return file;
  const base = file.name.replace(/\.[^.\\/]+$/, "").trim() || "chat-image";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

function mergeById(base: ChatMsg[], extra: ChatMsg[]) {
  const map = new Map<number, ChatMsg>();
  for (const it of base) map.set(Number(it.id), it);
  for (const it of extra) map.set(Number(it.id), it);
  return Array.from(map.values()).sort((a, b) => Number(a.id) - Number(b.id));
}

function formatChatTime(ts?: number) {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  try {
    return new Date(n).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function dayKey(ts?: number) {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return "unknown";
  const d = new Date(n);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDayLabel(ts?: number) {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return "Ранее";
  const d = new Date(n);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.floor((today - target) / 86_400_000);
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  try {
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return d.toLocaleDateString("ru-RU");
  }
}

function parseChatActionCards(rawBody?: string): { text: string; cards: ChatActionCard[] } {
  const body = String(rawBody || "");
  const cards: ChatActionCard[] = [];
  const cardRe = /\[\[AB_CARD:([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(body)) !== null) {
    const encoded = String(m[1] || "").trim();
    try {
      const parsed = JSON.parse(decodeURIComponent(encoded)) as ChatActionCard;
      if (parsed && typeof parsed === "object") cards.push(parsed);
    } catch {
      /* ignore malformed card */
    }
  }
  const text = body.replace(/\n?\[\[AB_CARD:[^\]]+\]\]/g, "").trim();
  return { text, cards };
}

function ChatMessageAttachment({
  url,
  name,
  mime,
  onOpenImage,
}: {
  url: string;
  name: string;
  mime: string;
  onOpenImage: (imageUrl: string) => void;
}) {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return null;
  const mimeLower = String(mime || "").toLowerCase();
  const isImage = mimeLower.startsWith("image/");

  if (isImage) {
    return (
      <div className="chat-bubble__attachment chat-bubble__attachment--img">
        <button
          type="button"
          className="chat-attachment-img-btn"
          onClick={() => onOpenImage(safeUrl)}
          aria-label={`Открыть изображение: ${name || "вложение"}`}
        >
          <img src={safeUrl} alt="" loading="lazy" className="chat-attachment-img-btn__img" />
        </button>
      </div>
    );
  }

  return (
    <div className="chat-bubble__attachment chat-bubble__attachment--file">
      <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="chat-attachment-file-link" download>
        📎 {name || "Вложение"}
      </a>
    </div>
  );
}

function ChatImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="chat-image-lightbox" role="dialog" aria-modal="true" aria-label="Просмотр изображения">
      <button type="button" className="chat-image-lightbox__backdrop" onClick={onClose} aria-label="Закрыть" />
      <div className="chat-image-lightbox__panel">
        <button type="button" className="chat-image-lightbox__close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <div className="chat-image-lightbox__body">
          <img src={url} alt="" className="chat-image-lightbox__img" />
        </div>
      </div>
    </div>
  );
}

function splitChatTextParts(text: string): ChatTextPart[] {
  const lines = String(text || "").split(/\n/g);
  const maxJoinRe = /^https:\/\/max\.ru\/join\/[A-Za-z0-9_-]+$/;
  const parts: ChatTextPart[] = [];
  for (const line of lines) {
    if (maxJoinRe.test(line.trim())) parts.push({ type: "max_join", href: line.trim() });
    else parts.push({ type: "text", value: line });
  }
  return parts;
}

function ChatBonusTableActionCard({ card, onOpen }: { card: ChatActionCard; onOpen: (url: string) => void }) {
  const positions = Array.isArray(card.positions) ? card.positions : [];
  const headline =
    String(card.headline || card.title || "").trim() ||
    (card.variant === "manual" ? "Вас добавили в список" : "Вы попали в бонусную таблицу!");
  const eyebrow = String(card.eyebrow || "Бонусная таблица").trim();
  const message = String(card.message || card.reason || "").trim();
  const openUrl = String(card.open_url || "").trim();

  return (
    <div className="chat-action-card chat-action-card--bonus-table">
      <div className="chat-action-card__head">
        <span className="chat-action-card__icon chat-action-card__icon--bonus" aria-hidden="true">
          <Gift size={20} strokeWidth={2.1} />
        </span>
        <div className="chat-action-card__head-text">
          <p className="chat-action-card__eyebrow">{eyebrow}</p>
          <p className="chat-action-card__title">{headline}</p>
        </div>
      </div>
      {card.subtitle ? <p className="chat-action-card__subtitle">{String(card.subtitle)}</p> : null}
      {message ? <p className="chat-action-card__reason">{message}</p> : null}
      {positions.length ? (
        <div className="chat-action-card__chips" aria-label="Место в таблице">
          {positions.map((pos) => (
            <span key={String(pos)} className="chat-action-card__chip chat-action-card__chip--bonus">
              <Trophy size={12} aria-hidden="true" />
              #{pos}
            </span>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="chat-action-card__btn chat-action-card__btn--bonus-table"
        onClick={() => {
          if (openUrl) onOpen(openUrl);
        }}
      >
        <ExternalLink size={16} aria-hidden="true" />
        <span>{String(card.cta || "Открыть бонусную таблицу")}</span>
      </button>
    </div>
  );
}

function ChatReceiptConfirmedActionCard({ card }: { card: ChatActionCard }) {
  const paid = Array.isArray(card.paid_tickets) ? card.paid_tickets : [];
  const bonus = Array.isArray(card.bonus_tickets) ? card.bonus_tickets : [];
  const maxUrl = String(card.max_join_url || "").trim();

  return (
    <div className="chat-action-card chat-action-card--receipt-confirmed">
      <div className="chat-action-card__head">
        <span className="chat-action-card__icon chat-action-card__icon--success" aria-hidden="true">
          <PartyPopper size={20} strokeWidth={2.1} />
        </span>
        <div className="chat-action-card__head-text">
          <p className="chat-action-card__eyebrow">{String(card.eyebrow || "Оплата подтверждена")}</p>
          <p className="chat-action-card__title">{String(card.headline || "Поздравляем!")}</p>
        </div>
      </div>
      {card.subtitle ? <p className="chat-action-card__subtitle">Акция «{String(card.subtitle)}»</p> : null}
      {card.message ? <p className="chat-action-card__reason">{String(card.message)}</p> : null}
      {paid.length ? (
        <div className="chat-action-card__detail-row">
          <Ticket size={15} aria-hidden="true" />
          <div className="chat-action-card__detail-body">
            <span className="chat-action-card__detail-label">Оплаченные номерки</span>
            <div className="chat-action-card__chips">
              {paid.map((num) => (
                <span key={"paid_" + String(num)} className="chat-action-card__chip chat-action-card__chip--ticket">
                  №{num}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {bonus.length ? (
        <div className="chat-action-card__detail-row">
          <Sparkles size={15} aria-hidden="true" />
          <div className="chat-action-card__detail-body">
            <span className="chat-action-card__detail-label">
              Бонусные номерки{card.bonus_promo ? ` · акция ${String(card.bonus_promo)}` : ""}
            </span>
            <div className="chat-action-card__chips">
              {bonus.map((num) => (
                <span key={"bonus_" + String(num)} className="chat-action-card__chip chat-action-card__chip--gift">
                  №{num}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {maxUrl ? (
        <a
          className="chat-action-card__btn chat-action-card__btn--max"
          href={maxUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle size={16} aria-hidden="true" />
          <span>{String(card.max_cta || "Присоединиться к чату в MAX")}</span>
        </a>
      ) : null}
    </div>
  );
}

export default function ChatPageClient() {
  const router = useRouter();
  const { session, authVerified, authCheckInFlight, toast } = useAbSession();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachmentDto | null>(null);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stickToBottomRef = useRef(true);
  const markReadInFlightRef = useRef(false);
  const markReadAtRef = useRef(0);

  const markStaffRead = useCallback(async () => {
    const now = Date.now();
    if (!session?.token || !authVerified) return;
    if (markReadInFlightRef.current) return;
    if (now - markReadAtRef.current < 1500) return;
    markReadInFlightRef.current = true;
    try {
      await fetch("/api/chat/mark-staff-read", { method: "POST", headers: abAuthHeaders(), cache: "no-store" });
      markReadAtRef.current = Date.now();
    } catch {
      /* ignore */
    } finally {
      markReadInFlightRef.current = false;
    }
  }, [session?.token, authVerified]);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const cacheChatAttachments = useCallback((list: ChatMsg[]) => {
    for (const m of list) {
      const url = String(m.attachment_url || "").trim();
      const mime = String(m.attachment_mime || "").toLowerCase();
      if (!url) continue;
      if (mime.startsWith("image/") || mime.startsWith("video/")) prefetchMediaUrl(url);
    }
  }, []);

  const loadLatest = useCallback(async () => {
    if (!session?.token || !authVerified) return;
    const data = await abApiJson<ChatListResponse>("/api/chat/messages?limit=40", { headers: abAuthHeaders(), cache: "no-store" });
    const list = Array.isArray(data.messages) ? data.messages : [];
    setMessages(list);
    cacheChatAttachments(list);
    setHasMore(Boolean(data.has_more));
    void markStaffRead();
  }, [session?.token, authVerified, markStaffRead, cacheChatAttachments]);

  const loadOlder = useCallback(async () => {
    if (!session?.token || !authVerified || loadingOlder || !hasMore) return;
    const oldestId = Number(messages[0]?.id);
    if (!Number.isFinite(oldestId) || oldestId < 1) return;
    const el = listRef.current;
    const prevHeight = el?.scrollHeight || 0;
    setLoadingOlder(true);
    try {
      const data = await abApiJson<ChatListResponse>(`/api/chat/messages?limit=30&before_id=${encodeURIComponent(String(oldestId))}`, {
        headers: abAuthHeaders(),
        cache: "no-store",
      });
      const older = Array.isArray(data.messages) ? data.messages : [];
      if (older.length) {
        cacheChatAttachments(older);
        setMessages((prev) => mergeById(older, prev));
      }
      setHasMore(Boolean(data.has_more));
      requestAnimationFrame(() => {
        const cur = listRef.current;
        if (!cur) return;
        const nextHeight = cur.scrollHeight;
        cur.scrollTop = Math.max(0, nextHeight - prevHeight);
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [session?.token, authVerified, loadingOlder, hasMore, messages, cacheChatAttachments]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const prevRoot = root.style.overflow;
    const prevBody = body.style.overflow;
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      root.style.overflow = prevRoot;
      body.style.overflow = prevBody;
    };
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--chat-kb-offset", `${keyboard}px`);
    };
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    onResize();
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
      document.documentElement.style.removeProperty("--chat-kb-offset");
    };
  }, []);

  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(160, ta.scrollHeight)}px`;
  }, [input]);

  useEffect(() => {
    if (authCheckInFlight) return;
    if (!session?.token) {
      router.replace("/");
      return;
    }
    if (!authVerified) return;
    let cancelled = false;
    setLoadingInitial(true);
    void loadLatest()
      .catch((e) => {
        if (!cancelled) toast(e instanceof AbApiError ? e.message : "Не удалось загрузить чат", "error");
      })
      .finally(() => {
        if (!cancelled) setLoadingInitial(false);
        requestAnimationFrame(() => scrollToBottom());
      });
    return () => {
      cancelled = true;
    };
  }, [session?.token, authVerified, authCheckInFlight, router, toast, loadLatest, scrollToBottom]);

  useEffect(() => {
    if (!session?.token || !authVerified) return;
    const id = window.setInterval(() => {
      void abApiJson<ChatListResponse>("/api/chat/messages?limit=40", { headers: abAuthHeaders(), cache: "no-store" })
        .then((data) => {
          const latest = Array.isArray(data.messages) ? data.messages : [];
          setHasMore(Boolean(data.has_more));
          setMessages((prev) => mergeById(prev, latest));
          void markStaffRead();
          if (stickToBottomRef.current) requestAnimationFrame(() => scrollToBottom());
        })
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(id);
  }, [session?.token, authVerified, scrollToBottom, markStaffRead]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void markStaffRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markStaffRead]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      const bottomGap = el.scrollHeight - (el.scrollTop + el.clientHeight);
      stickToBottomRef.current = bottomGap < 40;
      if (el.scrollTop < 80) void loadOlder();
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [loadOlder]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if ((!text && !pendingAttachment) || sending) return;
    setSending(true);
    try {
      const attachment = pendingAttachment
        ? {
            ...pendingAttachment,
            url: String(pendingAttachment.url || "").split("?")[0] || "",
          }
        : null;
      const data = await abApiJson<ChatListResponse>("/api/chat/messages", {
        method: "POST",
        headers: { ...abAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, attachment }),
      });
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setHasMore(Boolean(data.has_more));
      setInput("");
      setPendingAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      const ta = inputRef.current;
      if (ta) ta.style.height = "auto";
      stickToBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom());
    } catch (err) {
      toast(err instanceof AbApiError ? err.message : "Не удалось отправить", "error");
    } finally {
      setSending(false);
    }
  };

  const chatTimeline = useMemo(() => {
    const out: Array<{ type: "day"; key: string; label: string } | { type: "msg"; msg: ChatMsg }> = [];
    let prevKey = "";
    for (const m of messages) {
      const k = dayKey(m.created_at);
      if (k !== prevKey) {
        prevKey = k;
        out.push({ type: "day", key: k, label: formatDayLabel(m.created_at) });
      }
      out.push({ type: "msg", msg: m });
    }
    return out;
  }, [messages]);

  return (
    <>
      <div className="chat-screen">
        <div className="panel-chat__inner panel-chat__inner--page">
          <header className="panel-chat__head">
            <div className="panel-chat__head-left">
              <button type="button" className="panel-chat__close" aria-label="Назад" onClick={() => router.push("/home")}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <div className="panel-chat__icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
                </svg>
              </div>
              <div>
                <h2 className="panel-chat__title">Поддержка</h2>
                <p className="panel-chat__status">Обычно отвечаем в течение дня</p>
              </div>
            </div>
          </header>
          <div className="panel-chat__hint">Чат защищен сквозным шифрованием (RLS).</div>
          <div id="chat-messages" className="panel-chat__messages custom-scrollbar" ref={listRef}>
            {loadingOlder ? <p className="chat-loading-top">Загружаем более ранние сообщения...</p> : null}
            {loadingInitial ? (
              <div className="chat-loader" role="status" aria-live="polite">
                <div className="chat-loader__orb" aria-hidden="true">
                  <span className="chat-loader__dot"></span>
                  <span className="chat-loader__dot chat-loader__dot--delay"></span>
                </div>
                <div className="chat-loader__text">
                  <strong>Загрузка чата</strong>
                  <span>Подключаем переписку с поддержкой...</span>
                </div>
              </div>
            ) : !messages.length ? (
              <p className="chat-empty">Напишите нам — ответим в порядке очереди.</p>
            ) : (
              chatTimeline.map((item, idx) =>
                item.type === "day" ? (
                  <div key={"d_" + item.key + "_" + String(idx)} className="chat-day-separator" role="separator" aria-label={item.label}>
                    <span className="chat-day-separator__label">{item.label}</span>
                  </div>
                ) : (
                  <div key={item.msg.id} className={"chat-bubble-row " + (item.msg.is_staff ? "chat-bubble-row--in" : "chat-bubble-row--out")}>
                    <div className={"chat-bubble " + (item.msg.is_staff ? "chat-bubble--in" : "chat-bubble--out")}>
                      {(() => {
                        const parsed = parseChatActionCards(item.msg.body);
                        const cards = item.msg.is_staff ? parsed.cards : [];
                        const textParts = splitChatTextParts(parsed.text);
                        return (
                          <>
                            {parsed.text ? (
                              <div className="chat-bubble__text">
                                {textParts.map((part, partIdx) =>
                                  part.type === "max_join" ? (
                                    <a
                                      key={"mx_" + String(partIdx)}
                                      className="chat-max-join-btn"
                                      href={part.href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      Присоединиться к чату в MAX
                                    </a>
                                  ) : (
                                    <span key={"tx_" + String(partIdx)}>
                                      {part.value}
                                      {partIdx < textParts.length - 1 ? <br /> : null}
                                    </span>
                                  ),
                                )}
                              </div>
                            ) : null}
                            {item.msg.attachment_url ? (
                              <ChatMessageAttachment
                                url={String(item.msg.attachment_url)}
                                name={String(item.msg.attachment_name || "Вложение")}
                                mime={String(item.msg.attachment_mime || "")}
                                onOpenImage={setLightboxImageUrl}
                              />
                            ) : null}
                            {cards.map((card, cardIdx) => {
                              if (card?.kind === "receipt_confirmed") {
                                return <ChatReceiptConfirmedActionCard key={"card_rc_" + String(cardIdx)} card={card} />;
                              }
                              if (card?.kind === "prize_claim") {
                                return (
                                  <div key={"card_prize_" + String(cardIdx)} className="chat-action-card chat-action-card--prize">
                                    <p className="chat-action-card__title">{String(card.title || "Получить приз")}</p>
                                    {card.subtitle ? <p className="chat-action-card__reason">{card.subtitle}</p> : null}
                                    <button
                                      type="button"
                                      className="chat-action-card__btn chat-action-card__btn--prize"
                                      onClick={() => {
                                        const url = String(card.claim_url || "").trim();
                                        if (url) router.push(url.replace(/^https?:\/\/[^/]+/i, ""));
                                      }}
                                    >
                                      {String(card.cta || "Получить приз")}
                                    </button>
                                  </div>
                                );
                              }
                              if (card?.kind === "receipt_rejected") {
                                return (
                                  <div key={"card_retry_" + String(cardIdx)} className="chat-action-card chat-action-card--payment-retry">
                                    <p className="chat-action-card__title">Оплата отклонена</p>
                                    {card.reason ? <p className="chat-action-card__reason">{card.reason}</p> : null}
                                    <button
                                      type="button"
                                      className="chat-action-card__btn chat-action-card__btn--payment-retry"
                                      onClick={() => {
                                        const url = String(card.retry_url || "").trim();
                                        if (url) router.push(url.replace(/^https?:\/\/[^/]+/i, ""));
                                      }}
                                    >
                                      {String(card.cta || "Отправить чек")}
                                    </button>
                                  </div>
                                );
                              }
                              if (card?.kind === "bonus_table") {
                                return (
                                  <ChatBonusTableActionCard
                                    key={"card_bonus_" + String(cardIdx)}
                                    card={card}
                                    onOpen={(url) => router.push(url.replace(/^https?:\/\/[^/]+/i, ""))}
                                  />
                                );
                              }
                              return null;
                            })}
                          </>
                        );
                      })()}
                      {item.msg.is_staff ? (
                        <span className="chat-bubble__time">{formatChatTime(item.msg.created_at)}</span>
                      ) : (
                        <div className="chat-bubble__meta--out">
                          <span className="chat-bubble__time">{formatChatTime(item.msg.created_at)}</span>
                          <span
                            className={"chat-bubble__ticks" + (item.msg.read_by_staff ? " chat-bubble__ticks--read" : "")}
                            aria-label={item.msg.read_by_staff ? "Прочитано поддержкой" : "Доставлено"}
                            title={item.msg.read_by_staff ? "Прочитано поддержкой" : "Доставлено"}
                          >
                            {item.msg.read_by_staff ? "✓✓" : "✓"}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ),
              )
            )}
          </div>
          <form className="panel-chat__form panel-chat__form--sticky" onSubmit={send}>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              aria-hidden
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void prepareChatUploadFile(file)
                  .then((prepared) => {
                    const fd = new FormData();
                    fd.append("file", prepared);
                    return fetch("/api/chat/upload", { method: "POST", headers: abAuthHeaders(), body: fd });
                  })
                  .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
                  .then((x) => {
                    if (!x.ok) throw new Error(String(x.d?.error || "Ошибка загрузки файла"));
                    setPendingAttachment({
                      // В БД уйдёт путь без query; для превью оставляем подписанный URL.
                      url: String(x.d?.url || ""),
                      name: String(x.d?.name || "файл"),
                      mime: String(x.d?.mime || "application/octet-stream"),
                    });
                  })
                  .catch((err) => toast(String((err as Error).message || "Ошибка загрузки файла"), "error"));
              }}
            />
            <button
              type="button"
              className="panel-chat__attach"
              id="btn-chat-attach"
              aria-label="Прикрепить файл"
              title="Прикрепить файл"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-8.49 8.49a6 6 0 0 1-8.49-8.49l8.49-8.49a4 4 0 0 1 5.66 5.66L10.1 16.73a2 2 0 0 1-2.83-2.83l7.78-7.78"></path>
              </svg>
            </button>
            {pendingAttachment ? (
              <button
                type="button"
                className="panel-chat__attach"
                aria-label="Убрать вложение"
                title={pendingAttachment.name}
                onClick={() => {
                  setPendingAttachment(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                📎
              </button>
            ) : null}
            <textarea
              ref={inputRef}
              className="panel-chat__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoComplete="off"
              placeholder="Сообщение..."
              maxLength={4000}
              disabled={sending}
              rows={1}
            />
            <button type="submit" className="panel-chat__send" aria-label="Отправить" disabled={sending || (!input.trim() && !pendingAttachment)}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
                <path d="m21.854 2.147-10.94 10.939" />
              </svg>
            </button>
          </form>
        </div>
      </div>
      {lightboxImageUrl ? <ChatImageLightbox url={lightboxImageUrl} onClose={() => setLightboxImageUrl(null)} /> : null}
    </>
  );
}
