"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useSiteMusic } from "./SiteMusicProvider";

export default function HomeMusicToggle() {
  const { available, userOff, isPlaying, toggleUserMusic } = useSiteMusic();

  if (!available) return null;

  const active = !userOff && isPlaying;
  const label = userOff ? "Включить фоновую музыку" : "Выключить фоновую музыку";

  return (
    <button
      type="button"
      className={
        "home-music-toggle" +
        (active ? " home-music-toggle--on" : " home-music-toggle--off") +
        (userOff ? " home-music-toggle--muted" : "")
      }
      aria-label={label}
      aria-pressed={!userOff}
      title={label}
      onClick={() => toggleUserMusic()}
    >
      <span className="home-music-toggle__icon" aria-hidden="true">
        {userOff ? <VolumeX size={20} strokeWidth={2.2} /> : <Volume2 size={20} strokeWidth={2.2} />}
      </span>
      {active ? <span className="home-music-toggle__pulse" aria-hidden="true" /> : null}
    </button>
  );
}
