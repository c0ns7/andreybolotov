"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const PULL_THRESHOLD = 68;
const PULL_MAX = 108;

type Props = {
  children: ReactNode;
  onRefresh: () => Promise<void> | void;
  disabled?: boolean;
  className?: string;
};

function getScrollTop() {
  return Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
}

export default function PullToRefresh({ children, onRefresh, disabled = false, className = "" }: Props) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const canPullRef = useRef(false);
  const pullingRef = useRef(false);
  const pullRef = useRef(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  pullRef.current = pull;

  const runRefresh = useCallback(async () => {
    setRefreshing(true);
    setPull(PULL_THRESHOLD);
    try {
      await onRefreshRef.current();
    } finally {
      setRefreshing(false);
      setPull(0);
    }
  }, []);

  useEffect(() => {
    if (disabled) {
      canPullRef.current = false;
      pullingRef.current = false;
      setPull(0);
      return;
    }

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing || e.touches.length !== 1) return;
      if (getScrollTop() > 2) return;
      canPullRef.current = true;
      pullingRef.current = false;
      startYRef.current = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!canPullRef.current || refreshing || e.touches.length !== 1) return;
      if (getScrollTop() > 2) {
        canPullRef.current = false;
        pullingRef.current = false;
        setIsDragging(false);
        setPull(0);
        return;
      }
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) {
        pullingRef.current = false;
        setIsDragging(false);
        setPull(0);
        return;
      }
      pullingRef.current = true;
      setIsDragging(true);
      const next = Math.min(PULL_MAX, dy * 0.5);
      setPull(next);
      if (next > 8 && e.cancelable) e.preventDefault();
    };

    const onTouchEnd = () => {
      if (!canPullRef.current) return;
      canPullRef.current = false;
      const shouldRefresh = pullingRef.current && pullRef.current >= PULL_THRESHOLD;
      pullingRef.current = false;
      setIsDragging(false);
      if (!shouldRefresh) {
        setPull(0);
        return;
      }
      void runRefresh();
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchEnd);
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [disabled, refreshing, runRefresh]);

  const hint =
    refreshing ? "Обновляем…" : pull >= PULL_THRESHOLD ? "Отпустите" : "Потяните вниз";

  const showIndicator = pull > 0 || refreshing;

  return (
    <div className={"ptr" + (className ? ` ${className}` : "")}>
      <div
        className={"ptr__indicator" + (showIndicator ? " ptr__indicator--visible" : "")}
        aria-hidden={!showIndicator}
        style={{ height: showIndicator ? Math.max(pull, refreshing ? PULL_THRESHOLD : 0) : 0 }}
      >
        <div className="ptr__indicator-inner">
          <Loader2
            size={20}
            strokeWidth={2.25}
            className={"ptr__spinner" + (refreshing ? " ptr__spinner--spin" : "")}
            style={{
              transform: refreshing ? undefined : `rotate(${Math.min(320, pull * 3)}deg)`,
            }}
            aria-hidden="true"
          />
          <span className="ptr__hint">{hint}</span>
        </div>
      </div>
      <div
        className="ptr__body"
        style={{
          transform: pull > 0 ? `translateY(${pull}px)` : undefined,
          transition: isDragging || refreshing ? "none" : "transform 0.22s ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}
