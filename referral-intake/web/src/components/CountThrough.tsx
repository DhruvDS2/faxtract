import { useLayoutEffect, useRef } from "react";
import { cubicBezier } from "motion/react";
import { DURATION_MS, EASE, beginTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

const ease = cubicBezier(...EASE.enter);
const defaultFormat = (n: number) => Math.round(n).toLocaleString();

export type CountThroughProps = {
  value: number;
  format?: (n: number) => string;
  className?: string;
};

const inViewport = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
};

/**
 * A number that counts to its value (Lassie): once on first view (600 ms), then
 * through each change (200 ms). Off-screen at mount or under reduced motion it
 * simply shows the value. Screen readers get the final value only.
 */
export function CountThrough({ value, format = defaultFormat, className }: CountThroughProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const fmt = useRef(format);
  fmt.current = format;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const first = shown.current === null;
    const from = first ? 0 : (shown.current as number);
    if (reduce || from === value || (first && !inViewport(el))) {
      shown.current = value;
      el.textContent = fmt.current(value);
      return;
    }
    const dur = first ? DURATION_MS.reveal : DURATION_MS.state;
    const end = beginTransition();
    const t0 = performance.now();
    let raf = 0;
    el.textContent = fmt.current(from);
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const v = p >= 1 ? value : from + (value - from) * ease(p);
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
        {format(value)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
