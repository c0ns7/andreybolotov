"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { BlogMediaItem } from "../../../lib/ab-blog-types";

type Variant = "card" | "hero";

function MediaSlide({ item, variant }: { item: BlogMediaItem; variant: Variant }) {
  const cls = variant === "card" ? "blog-media-gallery__slide" : "blog-media-gallery__slide blog-media-gallery__slide--hero";
  if (item.mime?.startsWith("video/")) {
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
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), Math.max(0, items.length - 1)));
  const count = items.length;

  const go = useCallback(
    (delta: number) => {
      if (count < 2) return;
      setIndex((i) => (i + delta + count) % count);
    },
    [count],
  );

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

  if (!count) return null;
  const item = items[index]!;

  return (
    <div className="blog-media-lightbox" role="dialog" aria-modal="true" aria-label="Галерея">
      <button type="button" className="blog-media-lightbox__backdrop" onClick={onClose} aria-label="Закрыть" />
      <button type="button" className="blog-media-lightbox__close" onClick={onClose} aria-label="Закрыть">
        <X size={28} />
      </button>
      <div className="blog-media-lightbox__stage">
        {item.mime?.startsWith("video/") ? (
          <video className="blog-media-lightbox__media" src={item.url} controls autoPlay playsInline />
        ) : (
          <img className="blog-media-lightbox__media" src={item.url} alt="" />
        )}
      </div>
      {count > 1 ? (
        <>
          <button type="button" className="blog-media-lightbox__nav blog-media-lightbox__nav--prev" onClick={() => go(-1)} aria-label="Предыдущее">
            <ChevronLeft size={32} />
          </button>
          <button type="button" className="blog-media-lightbox__nav blog-media-lightbox__nav--next" onClick={() => go(1)} aria-label="Следующее">
            <ChevronRight size={32} />
          </button>
          <p className="blog-media-lightbox__counter">
            {index + 1} / {count}
          </p>
        </>
      ) : null}
    </div>
  );
}
