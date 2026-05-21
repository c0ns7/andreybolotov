"use client";

import { ChevronLeft, ChevronRight, Film, ImageIcon, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import { prefetchMediaList, prefetchMediaUrl } from "../../../lib/ab-media-cache";
import type { BlogMediaItem } from "../../../lib/ab-blog-types";

type Variant = "card" | "hero";

function isVideoItem(item: BlogMediaItem) {
  return String(item.mime || "").startsWith("video/");
}

function MediaSlide({ item, variant }: { item: BlogMediaItem; variant: Variant }) {
  const cls = variant === "card" ? "blog-media-gallery__slide" : "blog-media-gallery__slide blog-media-gallery__slide--hero";
  if (isVideoItem(item)) {
    return (
      <video
        className={cls}
        src={item.url}
        muted={variant === "card"}
        playsInline
        loop={variant === "card"}
        controls={variant === "hero"}
      />
    );
  }
  return <img className={cls} src={item.url} alt="" />;
}

export function BlogMediaCarousel({
  media,
  variant = "card",
  onOpen,
}: {
  media: BlogMediaItem[];
  variant?: Variant;
  onOpen?: (index: number) => void;
}) {
  const items = media.filter((m) => m.url);
  const [index, setIndex] = useState(0);
  const count = items.length;

  useEffect(() => {
    setIndex(0);
  }, [items.map((m) => m.url).join("|")]);

  useEffect(() => {
    if (!count) return;
    const cur = items[index]?.url;
    if (cur) prefetchMediaUrl(cur);
    const next = items[(index + 1) % count]?.url;
    if (next) prefetchMediaUrl(next);
  }, [index, count, items]);

  const go = useCallback(
    (delta: number) => {
      if (count < 2) return;
      setIndex((i) => (i + delta + count) % count);
    },
    [count],
  );

  if (!count) {
    return (
      <div className={"blog-media-gallery blog-media-gallery--empty blog-media-gallery--" + variant}>
        <span className="blog-media-gallery__empty-label">Без медиа</span>
      </div>
    );
  }

  const wrapCls =
    "blog-media-gallery blog-media-gallery--" + variant + (count > 1 ? " blog-media-gallery--multi" : "");

  return (
    <div className={wrapCls}>
      <button
        type="button"
        className="blog-media-gallery__viewport"
        onClick={(e) => {
          e.stopPropagation();
          onOpen?.(index);
        }}
        aria-label="Открыть галерею"
      >
        <MediaSlide item={items[index]!} variant={variant} />
      </button>
      {count > 1 ? (
        <>
          <button
            type="button"
            className="blog-media-gallery__nav blog-media-gallery__nav--prev"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            aria-label="Предыдущее"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            className="blog-media-gallery__nav blog-media-gallery__nav--next"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label="Следующее"
          >
            <ChevronRight size={22} />
          </button>
          <div className="blog-media-gallery__dots" role="tablist" aria-label="Слайды">
            {items.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                className={"blog-media-gallery__dot" + (i === index ? " is-active" : "")}
                onClick={(e) => {
                  e.stopPropagation();
                  setIndex(i);
                }}
              />
            ))}
          </div>
          <span className="blog-media-gallery__counter">
            {index + 1} / {count}
          </span>
        </>
      ) : null}
    </div>
  );
}

export function BlogMediaLightbox({
  media,
  startIndex,
  onClose,
}: {
  media: BlogMediaItem[];
  startIndex: number;
  onClose: () => void;
}) {
  const items = media.filter((m) => m.url);
  const count = items.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), Math.max(0, count - 1)));
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const go = useCallback(
    (delta: number) => {
      if (count < 2) return;
      setIndex((i) => (i + delta + count) % count);
    },
    [count],
  );

  useEffect(() => {
    setIndex(Math.min(Math.max(0, startIndex), Math.max(0, count - 1)));
  }, [startIndex, count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, go]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    void v.play().catch(() => {});
  }, [index]);

  useEffect(() => {
    if (!count) return;
    prefetchMediaList(items.map((m) => m.url).filter(Boolean));
  }, [count, items]);

  useEffect(() => {
    const cur = items[index]?.url;
    if (cur) prefetchMediaUrl(cur);
  }, [index, items]);

  if (!count) return null;

  const item = items[index]!;
  const isVideo = isVideoItem(item);

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchRef.current = { x: t.clientX, y: t.clientY };
  };

  const onTouchEnd = (e: TouchEvent) => {
    const start = touchRef.current;
    touchRef.current = null;
    const t = e.changedTouches[0];
    if (!start || !t || count < 2) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    go(dx < 0 ? 1 : -1);
  };

  return (
    <div className="blog-media-lightbox" role="dialog" aria-modal="true" aria-label="Просмотр медиа">
      <button type="button" className="blog-media-lightbox__backdrop" onClick={onClose} aria-label="Закрыть" />

      {!isVideo ? (
        <div
          className="blog-media-lightbox__ambient"
          style={{ backgroundImage: `url("${item.url.replace(/"/g, "%22")}")` }}
          aria-hidden="true"
        />
      ) : null}

      <div className="blog-media-lightbox__shell">
        <header className="blog-media-lightbox__top">
          <div className="blog-media-lightbox__meta">
            <span className="blog-media-lightbox__badge">
              {index + 1} / {count}
            </span>
            <span className="blog-media-lightbox__type">
              {isVideo ? (
                <>
                  <Film size={14} aria-hidden="true" />
                  Видео
                </>
              ) : (
                <>
                  <ImageIcon size={14} aria-hidden="true" />
                  Фото
                </>
              )}
            </span>
          </div>
          <button type="button" className="blog-media-lightbox__close" onClick={onClose} aria-label="Закрыть">
            <X size={22} strokeWidth={2.25} />
          </button>
        </header>

        <div
          className="blog-media-lightbox__stage"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {count > 1 ? (
            <button
              type="button"
              className="blog-media-lightbox__nav blog-media-lightbox__nav--prev"
              onClick={() => go(-1)}
              aria-label="Предыдущее"
            >
              <ChevronLeft size={28} strokeWidth={2.25} />
            </button>
          ) : null}

          <figure className={"blog-media-lightbox__frame" + (isVideo ? " blog-media-lightbox__frame--video" : "")}>
            {isVideo ? (
              <video
                ref={videoRef}
                key={item.url}
                className="blog-media-lightbox__media blog-media-lightbox__media--video"
                src={item.url}
                controls
                autoPlay
                playsInline
              />
            ) : (
              <img key={item.url} className="blog-media-lightbox__media" src={item.url} alt="" />
            )}
          </figure>

          {count > 1 ? (
            <button
              type="button"
              className="blog-media-lightbox__nav blog-media-lightbox__nav--next"
              onClick={() => go(1)}
              aria-label="Следующее"
            >
              <ChevronRight size={28} strokeWidth={2.25} />
            </button>
          ) : null}
        </div>

        {count > 1 ? (
          <footer className="blog-media-lightbox__footer">
            <div className="blog-media-lightbox__thumbs" role="tablist" aria-label="Все медиа">
              {items.map((m, i) => {
                const thumbVideo = isVideoItem(m);
                return (
                  <button
                    key={m.id ? `id-${m.id}` : m.url}
                    type="button"
                    role="tab"
                    aria-selected={i === index}
                    className={"blog-media-lightbox__thumb" + (i === index ? " is-active" : "")}
                    onClick={() => setIndex(i)}
                  >
                    {thumbVideo ? (
                      <video src={m.url} muted playsInline preload="metadata" aria-hidden="true" />
                    ) : (
                      <img src={m.url} alt="" />
                    )}
                    {thumbVideo ? <span className="blog-media-lightbox__thumb-play" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
