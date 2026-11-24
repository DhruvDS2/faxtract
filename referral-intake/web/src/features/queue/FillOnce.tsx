import { useEffect, useState } from "react";
import { DURATION_MS, STAGGER, STAGGER_MAX_ITEMS } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** The longest progressive fill: the capped stagger plus one row's fade. */
const REVEAL_WINDOW_MS = STAGGER.row * STAGGER_MAX_ITEMS * 1000 + DURATION_MS.state;

/**
 * The progressive fill (Paradigm) runs once per visit. Once it's over, rows that
 * appear later (a tab switch, a new fax) show at once instead of staggering in again.
 * Only this wrapper re-renders when the window closes: the table passed as children
 * keeps its element, so React doesn't re-render a row (doing that on every row
 * landed as a long task when someone navigated away right after a load).
 */
export function FillOnce({ ready, className, children }: { ready: boolean; className?: string; children: React.ReactNode }) {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (!ready || filled) return;
    const t = window.setTimeout(() => setFilled(true), REVEAL_WINDOW_MS);
    return () => window.clearTimeout(t);
  }, [ready, filled]);
  return <div className={cn(filled && "[&_tbody_tr]:animate-none", className)}>{children}</div>;
}
