"use client";

import { useEffect, useRef, useState } from "react";
import FlipDigitsText from "./FlipDigitsText";

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function formatGrouped(n: number): string {
  return String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

type Props = {
  value: number;
  /** Макс. шагов «перебора» по одному числу; при большем скачке — плавная интерполяция */
  maxStepThrough?: number;
};

export default function AnimatedStatNumber({ value, maxStepThrough = 48 }: Props) {
  const target = Math.max(0, Math.round(Number(value) || 0));
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    const start = displayRef.current;
    if (start === target) return;

    const delta = target - start;
    const absDelta = Math.abs(delta);
    const stepThrough = absDelta > 0 && absDelta <= maxStepThrough;
    const durationMs = stepThrough ? Math.min(1400, 48 * absDelta + 220) : 720;

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);

    const t0 = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs);
      let next: number;
      if (stepThrough) {
        const steps = Math.max(1, absDelta);
        const idx = Math.min(steps, Math.floor(t * steps + 1e-6));
        next = start + Math.sign(delta) * idx;
        if (t >= 1) next = target;
      } else {
        next = Math.round(start + delta * easeOutCubic(t));
        if (t >= 1) next = target;
      }
      setDisplay(next);
      displayRef.current = next;
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(target);
        displayRef.current = target;
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [target, maxStepThrough]);

  return (
    <FlipDigitsText text={formatGrouped(display)} />
  );
}
