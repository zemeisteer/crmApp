"use client";

import { useEffect, useRef, useState } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * A number that counts up from zero when it first appears (ease-out, ~0.9s),
 * and changes in place afterwards. Screen readers and reduced-motion users get
 * the final value at once; the box keeps its width (tabular figures).
 */
export default function CountUp({ value, format, duration = 900 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || reduced() || !Number.isFinite(value) || value === 0) {
      setShown(value);
      return;
    }
    started.current = true;
    const t0 = performance.now();
    const whole = Number.isInteger(value);
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      const v = value * e;
      setShown(k < 1 ? (whole ? Math.round(v) : v) : value);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    setShown(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  const text = format ? format(shown) : String(shown);
  return (
    <>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{format ? format(value) : String(value)}</span>
    </>
  );
}
