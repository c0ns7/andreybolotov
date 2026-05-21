"use client";

import { useEffect, useState } from "react";
import { isRaffleCoverAnimVideo, preloadRaffleCoverGif } from "../../lib/ab-raffle-cover-gif-cache";

type Props = {
  raffleId: number;
  coverUrl?: string;
  gifUrl?: string;
  updatedAt?: number;
  loading?: "eager" | "lazy";
  width?: number;
  height?: number;
};

export default function RaffleCardMedia({
  raffleId,
  coverUrl,
  gifUrl,
  updatedAt = 0,
  loading = "lazy",
  width = 480,
  height = 160,
}: Props) {
  const staticSrc = String(coverUrl || "").trim();
  const animSrc = String(gifUrl || "").trim();
  const [animDisplaySrc, setAnimDisplaySrc] = useState("");
  const [animActive, setAnimActive] = useState(false);
  const [animIsVideo, setAnimIsVideo] = useState(false);

  useEffect(() => {
    setAnimDisplaySrc("");
    setAnimActive(false);
    setAnimIsVideo(false);
    if (!animSrc) return;
    return preloadRaffleCoverGif({
      raffleId,
      gifUrl: animSrc,
      updatedAt,
      onLoaded: (url, isVideo) => {
        setAnimDisplaySrc(url);
        setAnimIsVideo(isVideo);
        setAnimActive(true);
      },
    });
  }, [raffleId, staticSrc, animSrc, updatedAt]);

  if (animActive && animDisplaySrc && animIsVideo) {
    return (
      <video
        className="raffle-card__media-img raffle-card__media-img--anim raffle-card__media-img--video"
        src={animDisplaySrc}
        width={width}
        height={height}
        muted
        loop
        playsInline
        autoPlay
        preload={loading === "eager" ? "auto" : "metadata"}
        aria-hidden="true"
      />
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
