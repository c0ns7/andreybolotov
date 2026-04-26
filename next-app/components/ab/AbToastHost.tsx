"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Kind = "success" | "error" | "warning" | "info" | "neutral";
const TOAST_LIFETIME_MS = 5000;
const TOAST_EXIT_MS = 360;

function ToastIcon({ kind }: { kind: Kind }) {
  if (kind === "success") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M8 12.5 10.8 15 16 9.5"></path>
      </svg>
    );
  }
  if (kind === "error") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="m15 9-6 6M9 9l6 6"></path>
      </svg>
    );
  }
  if (kind === "warning") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3 2 20h20L12 3Z"></path>
        <path d="M12 9v5"></path>
        <path d="M12 17h.01"></path>
      </svg>
    );
  }
  if (kind === "info") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M12 10v6"></path>
        <path d="M12 7h.01"></path>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M8 12h8"></path>
    </svg>
  );
}

export default function AbToastHost() {
  const [toast, setToast] = useState<{ message: string; kind: Kind } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [remainingMs, setRemainingMs] = useState(TOAST_LIFETIME_MS);
  const tickerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const lastTickRef = useRef(0);

  const stopTicker = useCallback(() => {
    if (tickerRef.current != null) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    runningRef.current = false;
  }, []);

  const beginExit = useCallback(() => {
    stopTicker();
    if (exitTimerRef.current != null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    setIsExiting(true);
    exitTimerRef.current = window.setTimeout(() => {
      setIsVisible(false);
      setIsExiting(false);
      setToast(null);
    }, TOAST_EXIT_MS);
  }, [stopTicker]);

  const startTicker = useCallback(() => {
    if (runningRef.current || !toast) return;
    runningRef.current = true;
    lastTickRef.current = Date.now();
    tickerRef.current = window.setInterval(() => {
      const now = Date.now();
      const dt = Math.max(0, now - lastTickRef.current);
      lastTickRef.current = now;
      setRemainingMs((prev) => {
        const next = Math.max(0, prev - dt);
        if (next <= 0) {
          beginExit();
          return 0;
        }
        return next;
      });
    }, 50);
  }, [toast, beginExit]);

  useEffect(() => {
    const onToast = (ev: Event) => {
      const ce = ev as CustomEvent<{ message?: string; kind?: Kind }>;
      const message = String(ce.detail?.message || "").trim();
      if (!message) return;
      const kind = ce.detail?.kind || "neutral";
      if (exitTimerRef.current != null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      stopTicker();
      setToast({ message, kind });
      setRemainingMs(TOAST_LIFETIME_MS);
      setIsExiting(false);
      setIsVisible(true);
    };
    window.addEventListener("ab-toast", onToast as EventListener);
    return () => {
      window.removeEventListener("ab-toast", onToast as EventListener);
      stopTicker();
      if (exitTimerRef.current != null) window.clearTimeout(exitTimerRef.current);
    };
  }, [stopTicker]);

  useEffect(() => {
    if (!toast || !isVisible || isExiting) return;
    startTicker();
  }, [toast, isVisible, isExiting, startTicker]);

  if (!toast || !isVisible) return null;
  const progress = Math.max(0, Math.min(100, (remainingMs / TOAST_LIFETIME_MS) * 100));
  return (
    <div
      className={"toast toast--" + toast.kind + " is-visible" + (isExiting ? " is-exiting" : "")}
      role="status"
      onClick={beginExit}
      onMouseEnter={stopTicker}
      onMouseLeave={startTicker}
      onTouchStart={stopTicker}
      onTouchEnd={startTicker}
    >
      <div className="toast__icon">
        <ToastIcon kind={toast.kind} />
      </div>
      <div className="toast__text">{toast.message}</div>
      <div className="toast__progress" aria-hidden="true">
        <span className="toast__progress-bar" style={{ width: `${progress}%` }}></span>
      </div>
    </div>
  );
}
