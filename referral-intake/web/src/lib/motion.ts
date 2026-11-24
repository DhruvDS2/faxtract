/**
 * Motion language (web/DESIGN.md, "Motion"). The only place a duration, easing or
 * travel distance is written in TypeScript; CSS reads the same values from
 * globals.css (--dur-*, --ease-*).
 *
 * - Use `m` (re-exported here), never `motion` from "motion/react": the app runs
 *   inside <LazyMotion strict>, so animation features load after first paint.
 * - Motion explains change. No bounce, no spring overshoot, nothing over 400 ms
 *   except a one-time reveal (600 ms).
 * - prefers-reduced-motion: everything becomes an opacity fade (useMotionPrefs).
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useReducedMotion, type Transition, type Variants } from "motion/react";

export { AnimatePresence, LayoutGroup, m, useInView, useIsPresent } from "motion/react";

/** Milliseconds: CSS-adjacent code (timers, rAF). Mirrors --dur-* in globals.css. */
export const DURATION_MS = { fast: 120, state: 200, panel: 320, reveal: 600, breathe: 1800 } as const;
/** Seconds: motion configs. */
export const DURATION = { fast: 0.12, state: 0.2, panel: 0.32, reveal: 0.6 } as const;
/** Per-item delays for staggered reveals (seconds). */
export const STAGGER = { row: 0.04, field: 0.03, step: 0.08 } as const;
/** Cap on staggered items so a long list never takes long to appear. */
export const STAGGER_MAX_ITEMS = 14;
/** Enter: decelerate into place. Exit: accelerate away. */
export const EASE = {
  enter: [0.2, 0.8, 0.2, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
};
/** Travel distances (px) for slides; small on purpose. */
export const OFFSET = { item: 4, reveal: 8, panel: 16 } as const;
/** How long a confirmation ("Copied") stays before reverting. */
export const FEEDBACK_MS = 1600;

export const transition = {
  fast: { duration: DURATION.fast, ease: EASE.enter },
  state: { duration: DURATION.state, ease: EASE.enter },
  panel: { duration: DURATION.panel, ease: EASE.enter },
  reveal: { duration: DURATION.reveal, ease: EASE.enter },
  exit: { duration: DURATION.fast, ease: EASE.exit },
  exitPanel: { duration: DURATION.state, ease: EASE.exit },
} satisfies Record<string, Transition>;

// ---------- variants (initial / animate / exit) ----------

export const fade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: transition.state },
  exit: { opacity: 0, transition: transition.exit },
};

/** Route-level crossfade (V7): the outgoing page leaves fast, the incoming one settles. */
export const crossfade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: transition.panel },
  exit: { opacity: 0, transition: transition.exit },
};

export type Side = "left" | "right" | "top" | "bottom";
const axis = (side: Side, d: number) =>
  side === "left" ? { x: -d } : side === "right" ? { x: d } : side === "top" ? { y: -d } : { y: d };

/** A side panel / sheet arriving from `side` (320 ms in, 200 ms out). */
export const panelSlide = (side: Side = "right"): Variants => ({
  initial: { opacity: 0, ...axis(side, OFFSET.panel) },
  animate: { opacity: 1, x: 0, y: 0, transition: transition.panel },
  exit: { opacity: 0, ...axis(side, OFFSET.panel / 2), transition: transition.exitPanel },
});

/** Parent of a staggered list; pair with `listItem`. */
export const listStagger = (step: number = STAGGER.row): Variants => ({
  initial: {},
  animate: { transition: { staggerChildren: step } },
});
export const listItem: Variants = {
  initial: { opacity: 0, y: OFFSET.item },
  animate: { opacity: 1, y: 0, transition: transition.state },
};

/** One-time reveal (600 ms): use with whileInView + viewport={{ once: true }}. */
export const revealOnce: Variants = {
  initial: { opacity: 0, y: OFFSET.reveal },
  animate: { opacity: 1, y: 0, transition: transition.reveal },
};

/** The calm "running" breathe (opacity only). CSS twin: `animate-breathe`. */
export const breathe = {
  animate: { opacity: [1, 0.45, 1] },
  transition: { duration: DURATION_MS.breathe / 1000, ease: "easeInOut", repeat: Infinity },
} as const;

const TRANSFORM_KEYS = new Set([
  "x", "y", "z", "scale", "scaleX", "scaleY", "rotate", "rotateX", "rotateY", "rotateZ",
  "skew", "skewX", "skewY", "translateX", "translateY", "transform", "height", "width",
]);

/** Strip every transform (and size) key: what's left is opacity/colour, i.e. a fade. */
export function fadeOnly(v: Variants): Variants {
  const out: Variants = {};
  for (const [name, def] of Object.entries(v)) {
    if (typeof def === "function" || def == null) {
      out[name] = def;
      continue;
    }
    out[name] = Object.fromEntries(Object.entries(def).filter(([k]) => !TRANSFORM_KEYS.has(k)));
  }
  return out;
}

/**
 * Motion preferences: the variants to use right now. Under prefers-reduced-motion
 * every variant is opacity-only and the layout morph is off (MotionConfig
 * reducedMotion="user" also disables transforms globally).
 */
export function useMotionPrefs() {
  const reduce = useReducedMotion() ?? false;
  return useMemo(() => {
    const pick = (v: Variants) => (reduce ? fadeOnly(v) : v);
    return {
      reduce,
      fade,
      crossfade,
      panelSlide: (side?: Side) => pick(panelSlide(side)),
      listStagger: (step?: number) => (reduce ? listStagger(0) : listStagger(step)),
      listItem: pick(listItem),
      revealOnce: pick(revealOnce),
      safe: pick,
      transition,
    };
  }, [reduce]);
}

// ---------- shared element: queue row → referral detail (ONTO, 320 ms) ----------

/** The one layoutId for a referral's identity block (row name ↔ detail header). */
export const referralLayoutId = (id: string) => `referral-${id}`;

// ---------- transition window marker (QA: long tasks are measured inside it) ----------

let active = 0;
const SAFETY_MS = DURATION_MS.reveal + 400;

/**
 * Marks a transition window: <html data-transitioning="true"> while any is open.
 * Returns the function that closes this window (idempotent; auto-closes after a cap).
 */
export function beginTransition(): () => void {
  if (typeof document === "undefined") return () => {};
  active += 1;
  document.documentElement.dataset.transitioning = "true";
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    window.clearTimeout(timer);
    active = Math.max(0, active - 1);
    if (active === 0) delete document.documentElement.dataset.transitioning;
  };
  const timer = window.setTimeout(close, SAFETY_MS);
  return close;
}

/**
 * Handlers for a motion element whose animations should count as a transition
 * window: spread onto `m.*` (`{...useTransitionMarker()}`) or pick the layout pair.
 */
export function useTransitionMarker() {
  const end = useRef<(() => void) | null>(null);
  const start = useCallback(() => {
    if (!end.current) end.current = beginTransition();
  }, []);
  const stop = useCallback(() => {
    end.current?.();
    end.current = null;
  }, []);
  useEffect(() => stop, [stop]);
  return useMemo(
    () => ({
      onAnimationStart: start,
      onAnimationComplete: stop,
      onLayoutAnimationStart: start,
      onLayoutAnimationComplete: stop,
    }),
    [start, stop],
  );
}
