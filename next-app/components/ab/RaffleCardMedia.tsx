"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { isRaffleCoverAnimVideo, preloadRaffleCoverGif } from "../../lib/ab-raffle-cover-gif-cache";

type Props = {
  raffleId: number;
  coverUrl?: string;
  gifUrl?: string;
  updatedAt?: number;
  loading?: "eager" | "lazy";
  width?: number;
  height?: number;
  /** false — только обложка (без GIF/видео), например при паузе или закрытых продажах */
  animEnabled?: boolean;
  /** false — видео только по кнопке play (на главной без автозапуска) */
  autoPlayVideo?: boolean;
};

function PlayIcon() {
  return (
    <svg className="raffle-card__media-play-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 5.14v13.72c0 .79.87 1.27 1.54.84l10.04-6.86c.6-.41.6-1.27 0-1.68L9.54 4.3C8.87 3.87 8 4.35 8 5.14z"
      />
    </svg>
  );
}

export default function RaffleCardMedia({
  raffleId,
  coverUrl,
  gifUrl,
  updatedAt = 0,
  loading = "lazy",
  width = 480,
  height = 160,
  animEnabled = true,
  autoPlayVideo = true,
}: Props) {
  const staticSrc = String(coverUrl || "").trim();
  const animSrc = animEnabled ? String(gifUrl || "").trim() : "";
  const animIsVideoUrl = Boolean(animSrc && isRaffleCoverAnimVideo(animSrc));

  const [animDisplaySrc, setAnimDisplaySrc] = useState("");
  const [animIsVideo, setAnimIsVideo] = useState(false);
  const [animActive, setAnimActive] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const autoPlayedRef = useRef(false);
  const wasPlayingOnHideRef = useRef(false);

  useEffect(() => {
    setAnimDisplaySrc("");
    setAnimActive(false);
    setAnimIsVideo(false);
    setShowVideo(false);
    autoPlayedRef.current = false;
    wasPlayingOnHideRef.current = false;
    if (!animSrc) return;
    return preloadRaffleCoverGif({
      raffleId,
      gifUrl: animSrc,
      updatedAt,
      onLoaded: (url, isVideo) => {
        setAnimDisplaySrc(url);
        setAnimIsVideo(isVideo);
        if (!isVideo) setAnimActive(true);
      },
    });
  }, [raffleId, staticSrc, animSrc, updatedAt]);

  const startVideo = useCallback(() => {
    if (!animDisplaySrc || !animIsVideo) return;
    setShowVideo(true);
  }, [animDisplaySrc, animIsVideo]);

  useEffect(() => {
    if (!autoPlayVideo || !animIsVideo || !animDisplaySrc || autoPlayedRef.current) return;
    autoPlayedRef.current = true;
    setShowVideo(true);
  }, [autoPlayVideo, animIsVideo, animDisplaySrc]);

  useEffect(() => {
    if (!showVideo) return;
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    const playPromise = v.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        /* autoplay blocked — user can tap play */
        setShowVideo(false);
      });
    }
  }, [showVideo, animDisplaySrc]);

  useEffect(() => {
    if (!showVideo || !animIsVideo) return;

    const resumeAfterVisible = () => {
      const v = videoRef.current;
      if (!v || document.hidden) return;
      if (v.ended) {
        setShowVideo(false);
        return;
      }
      if (!wasPlayingOnHideRef.current) return;
      const src = v.currentSrc || animDisplaySrc;
      if (!src) return;
      const savedTime = v.currentTime;
      v.load();
      const tryPlay = () => {
        if (savedTime > 0 && Number.isFinite(v.duration) && savedTime < v.duration) {
          v.currentTime = savedTime;
        }
        void v.play().catch(() => {});
      };
      if (v.readyState >= 2) tryPlay();
      else v.addEventListener("loadeddata", tryPlay, { once: true });
    };

    const onVisibility = () => {
      const v = videoRef.current;
      if (!v) return;
      if (document.hidden) {
        wasPlayingOnHideRef.current = !v.paused && !v.ended;
        v.pause();
        return;
      }
      resumeAfterVisible();
    };

    const onStalled = () => {
      const v = videoRef.current;
      if (!v || v.ended || document.hidden) return;
      const src = v.currentSrc || animDisplaySrc;
      if (!src) return;
      const t = v.currentTime;
      v.load();
      const onReady = () => {
        if (t > 0 && Number.isFinite(v.duration) && t < v.duration) v.currentTime = t;
        void v.play().catch(() => {});
      };
      if (v.readyState >= 2) onReady();
      else v.addEventListener("loadeddata", onReady, { once: true });
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", resumeAfterVisible);
    const v = videoRef.current;
    v?.addEventListener("stalled", onStalled);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", resumeAfterVisible);
      v?.removeEventListener("stalled", onStalled);
    };
  }, [showVideo, animIsVideo, animDisplaySrc]);

  const onVideoEnded = useCallback(() => {
    setShowVideo(false);
    wasPlayingOnHideRef.current = false;
  }, []);

  const onPlayClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      startVideo();
    },
    [startVideo],
  );

  const showPlayBtn = animEnabled && animIsVideoUrl && !showVideo;

  if (!animEnabled) {
    if (!staticSrc) return null;
    return (
      <img
        className="raffle-card__media-img raffle-card__media-img--cover raffle-card__media-img--static-only"
        src={staticSrc}
        alt=""
        width={width}
        height={height}
        loading={loading}
        decoding="async"
      />
    );
  }

  if (animIsVideo && animDisplaySrc) {
    const coverImg = staticSrc ? (
      <img
        className={
          "raffle-card__media-img raffle-card__media-img--cover" +
          (showVideo ? " raffle-card__media-img--under-video" : "")
        }
        src={staticSrc}
        alt=""
        width={width}
        height={height}
        loading={loading}
        decoding="async"
      />
    ) : null;

    return (
      <>
        {coverImg}
        {showVideo ? (
          <video
            ref={videoRef}
            className="raffle-card__media-img raffle-card__media-img--anim raffle-card__media-img--video"
            src={animDisplaySrc}
            width={width}
            height={height}
            muted
            playsInline
            preload={loading === "eager" ? "auto" : "metadata"}
            poster={staticSrc || undefined}
            aria-hidden="true"
            onEnded={onVideoEnded}
          />
        ) : null}
        {showPlayBtn ? (
          <button
            type="button"
            className="raffle-card__media-play"
            aria-label="Воспроизвести видео"
            onClick={onPlayClick}
          >
            <PlayIcon />
          </button>
        ) : null}
      </>
    );
  }

  const imgSrc = animActive && animDisplaySrc ? animDisplaySrc : staticSrc;
  if (!imgSrc) return null;

  return (
    <img
      className={
        "raffle-card__media-img" + (animActive && animDisplaySrc ? " raffle-card__media-img--anim" : "")
      }
      src={imgSrc}
      alt=""
      width={width}
      height={height}
      loading={loading}
      decoding="async"
    />
  );
}
