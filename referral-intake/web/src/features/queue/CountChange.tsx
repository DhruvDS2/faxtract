import { useLayoutEffect, useRef } from "react";
import { cubicBezier } from "motion/react";
import { DURATION_MS, EASE, beginTransition } from "@/lib/motion";

const ease = cubicBezier(...EASE.enter);
const show = (n: number) => String(Math.round(n));

/**
 * A count that moves through its changes (Lassie, 200 ms) and is still on first
 * paint. `from` is the value shown last time (e.g. before opening a referral), so
 * coming back after approving one counts 31 → 30 instead of 0 → 30.
 *
 * Local stand-in for <CountThrough>, which always reveals 0 → value on mount
 * (change request: CountThrough `initial={false}` / `from`).
 */
export function CountChange({ value, from }: { value: number; from?: number | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number>(from ?? value);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = shown.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || start === value) {
      shown.current = value;
      el.textContent = show(value);
      return;
    }
    const end = beginTransition();
    const t0 = performance.now();
    let raf = 0;
    el.textContent = show(start);
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / DURATION_MS.state);
      const v = p >= 1 ? value : start + (value - start) * ease(p);
      shown.current = v;
      el.textContent = show(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else end();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      end();
    };
  }, [value]);

  return (
    <span className="tabular-nums">
      <span ref={ref} aria-hidden>
        {show(from ?? value)}
      </span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
