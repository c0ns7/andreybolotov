"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SOCIAL_LINKS = [
  {
    id: "max",
    href: "https://max.ru/join/Xfy4YvDujQD09ESpzRLrDvoxVXm0LmgdSyEJjD-I3fM",
    label: "MAX",
    className: "home-social-fab__link--max",
    icon: (
      <span className="home-social-fab__letter" aria-hidden="true">
        M
      </span>
    ),
  },
  {
    id: "vk",
    href: "https://vk.com/bolotovandrey80",
    label: "ВКонтакте",
    className: "home-social-fab__link--vk",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M15.684 0H8.316C1.592 0 0 1.592 0 8.316v7.368C0 22.408 1.592 24 8.316 24h7.368C22.408 24 24 22.408 24 15.684V8.316C24 1.592 22.408 0 15.684 0zm3.692 17.123h-1.744c-.66 0-.862-.525-2.05-1.727-1.033-1-1.49-1.135-1.744-1.135-.356 0-.458.102-.458.593v1.575c0 .424-.135.678-1.253.678-1.846 0-3.942-1.186-5.408-3.396-2.102-3.119-2.68-5.475-2.68-5.956 0-.254.102-.491.678-.491h1.744c.508 0 .593.229.762.678.847 2.458 2.34 4.62 2.948 4.62.254 0 .373-.118.373-.779V9.721c-.068-1.186-.695-1.287-.695-1.71 0-.203.17-.407.508-.407h2.744c.423 0 .576.254.576.643v4.267c0 .423.186.576.305.576.254 0 .474-.153.948-.627 1.465-1.643 2.507-4.178 2.507-4.178.145-.305.373-.491.949-.491h1.744c.593 0 .729.305.593.847-.254 1.186-2.56 4.62-2.56 4.62-.406.645-.542.949 0 1.643.406.542 1.736 1.676 1.991 2.102.593.847.678 1.423.678 1.847-.017.508-.423.593-1.016.593z" />
      </svg>
    ),
  },
  {
    id: "tg",
    href: "https://t.me/Andrey_Bolotovv",
    label: "Telegram",
    className: "home-social-fab__link--tg",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
  },
] as const;

type Props = {
  visible?: boolean;
  elevated?: boolean;
};

export default function HomeSocialFab({ visible = true, elevated = false }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const root = rootRef.current;
      if (!root || !(e.target instanceof Node)) return;
      if (!root.contains(e.target)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open, close]);

  if (!visible) return null;

  return (
    <div
      ref={rootRef}
      className={
        "home-social-fab" +
        (open ? " home-social-fab--open" : "") +
        (elevated ? " home-social-fab--elevated" : "")
      }
      aria-label="Соцсети"
    >
      <div className="home-social-fab__glow" aria-hidden="true" />
      <ul className="home-social-fab__menu" aria-hidden={!open}>
        {SOCIAL_LINKS.map((item, i) => (
          <li key={item.id} className="home-social-fab__item" style={{ transitionDelay: open ? `${0.04 + i * 0.05}s` : "0s" }}>
            <a
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className={"home-social-fab__link " + item.className}
              aria-label={item.label}
              tabIndex={open ? 0 : -1}
              onClick={() => close()}
            >
              {item.icon}
            </a>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="home-social-fab__toggle"
        aria-expanded={open}
        aria-label={open ? "Скрыть соцсети" : "Открыть соцсети"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="home-social-fab__droplet" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </span>
        <span className="home-social-fab__ripple" aria-hidden="true" />
      </button>
    </div>
  );
}
