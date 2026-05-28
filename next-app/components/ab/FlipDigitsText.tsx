"use client";

import { useEffect, useState } from "react";

type Props = {
  text: string;
  className?: string;
};

function isDigit(ch: string): boolean {
  return /^\d$/.test(ch);
}

function FlipChar({ ch }: { ch: string }) {
  const [current, setCurrent] = useState(ch);
  const [prev, setPrev] = useState(ch);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (ch === current) return;
    const canAnimate = isDigit(ch) && isDigit(current);
    if (!canAnimate) {
      setCurrent(ch);
      setPrev(ch);
      setAnimating(false);
      return;
    }
    setPrev(current);
    setCurrent(ch);
    setAnimating(true);
    const t = window.setTimeout(() => setAnimating(false), 220);
    return () => window.clearTimeout(t);
  }, [ch, current]);

  if (!isDigit(ch)) {
    return <span className="flip-digit flip-digit--static">{ch}</span>;
  }

  return (
    <span className={"flip-digit" + (animating ? " is-animating" : "")} aria-hidden="true">
      <span className="flip-digit__track">
        <span className="flip-digit__item flip-digit__item--from">{prev}</span>
        <span className="flip-digit__item flip-digit__item--to">{current}</span>
      </span>
    </span>
  );
}

export default function FlipDigitsText({ text, className }: Props) {
  const value = String(text || "");
  return (
    <span className={className} aria-label={value}>
      {value.split("").map((ch, idx) => (
        <FlipChar key={`f_${String(idx)}`} ch={ch} />
      ))}
    </span>
  );
}
