import { useLayoutEffect, useRef } from "react";
import { cubicBezier } from "motion/react";
import { DURATION_MS, EASE, beginTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

const ease = cubicBezier(...EASE.enter);
const defaultFormat = (n: number) => Math.round(n).toLocaleString();

export type CountThroughProps = {
  value: number;
  format?: (n: number) => string;
  /** `false`: no reveal on mount (show the value), still count through later changes. */
  initial?: boolean;
  /** The value shown before (e.g. before visiting a referral): count from it to `value` (200 ms). */
  from?: number | null;
  className?: string;
};

const inViewport = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
};

/**
 * A number that counts to its value (Lassie): once on first view (600 ms), then
 * through each change (200 ms). Off-screen at mount or under reduced motion it
 * simply shows the value. `initial={false}` skips the mount reveal; `from` counts
 * from a previous value instead of 0. Screen readers get the final value only.
 */
export function CountThrough({ value, format = defaultFormat, initial = true, from = null, className }: CountThroughProps) {
  const ref = useRef<HTMLSpanElement>(null);
  // null = not shown yet (reveal from 0); a number = count through from it
  const shown = useRef<number | null>(from ?? (initial ? null : value));
  const fmt = useRef(format);
  fmt.current = format;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const first = shown.current === null;
    const start = first ? 0 : (shown.current as number);
    if (reduce || start === value || (first && !inViewport(el))) {
      shown.current = value;
      el.textContent = fmt.current(value);
      return;
    }
    // a reveal (from 0) is the one-time 600 ms; a change, including `from` on mount, is 200 ms
    const dur = first ? DURATION_MS.reveal : DURATION_MS.state;
    const end = beginTransition();
    const t0 = performance.now();
    let raf = 0;
    el.textContent = fmt.current(start);
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const v = p >= 1 ? value : start + (value - start) * ease(p);
      shown.current = v;
      el.textContent = fmt.current(v);
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
    <span className={cn("tabular-nums", className)}>
      <span ref={ref} aria-hidden>
        {format(from ?? value)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
