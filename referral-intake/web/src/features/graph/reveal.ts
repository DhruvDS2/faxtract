/**
 * The Decimals step reveal (decimals-d10992): on first load of a referral the
 * steps along the path it took light up in sequence, once per referral per
 * session (never on a refetch). Plain CSS transitions on opacity and colour,
 * delayed per step: 80 ms apart, compressed so the whole reveal stays within
 * the 600 ms reveal token. Under reduced motion there is no stagger, only one
 * short fade.
 *
 * Driven by state, not by `m` `initial`, so a parent AnimatePresence with
 * initial={false} can't suppress it. Live updates after the reveal light each
 * step as its trace event arrives (the same transitions, without delay).
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { DURATION, STAGGER, beginTransition, useMotionPrefs } from "@/lib/motion";

const revealed = new Set<string>();

export type Reveal = {
  /** True while the steps in `order` are drawn unlit, waiting for their turn. */
  pending: boolean;
  /** Step id → its place in the sequence. */
  order: Map<string, number>;
  /** Seconds between steps. */
  step: number;
};

type Phase = "pending" | "running" | "done";
const DONE: Reveal & { phase: Phase; key?: string } = { phase: "done", pending: false, order: new Map(), step: 0 };

/** Seconds from the start of the reveal until step `i` starts lighting. */
export const revealDelay = (r: Reveal, i: number | undefined) => (i === undefined ? 0 : i * r.step);

/**
 * `sequence` is null until the trace has loaded; `mapReady` is true once the map
 * has been laid out and painted (so the lighting is actually seen).
 */
export function useStepReveal(key: string | undefined, sequence: string[] | null, mapReady: boolean): Reveal {
  const { reduce } = useMotionPrefs();
  const [state, setState] = useState(DONE);
  const ready = !!key && sequence !== null;

  // Stage 1, before paint: draw this referral's path unlit (or skip if it was revealed already).
  useLayoutEffect(() => {
    if (!key || !sequence) return;
    if (revealed.has(key) || sequence.length === 0) {
      revealed.add(key);
      setState({ ...DONE, key });
      return;
    }
    const n = sequence.length;
    const step = reduce ? 0 : Math.min(STAGGER.step, (DURATION.reveal - DURATION.state) / Math.max(1, n - 1));
    setState({ key, phase: "pending", pending: true, order: new Map(sequence.map((id, i) => [id, i])), step });
    // The sequence is read once, when the trace first arrives: refetches don't replay it.
  }, [key, ready]);

  // Stage 2, once the map is on screen (two frames, so the unlit look has painted): start.
  const waiting = state.phase === "pending" && state.key === key;
  useEffect(() => {
    if (!waiting || !mapReady || !key) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        revealed.add(key);
        setState((s) => ({ ...s, phase: "running", pending: false }));
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [waiting, mapReady, key]);

  // Stage 3: the steps light over at most 600 ms; then delays are dropped for live updates.
  const running = state.phase === "running" && state.key === key;
  const total = ((state.order.size - 1) * state.step + DURATION.state) * 1000;
  useEffect(() => {
    if (!running) return;
    const end = beginTransition();
    const timer = window.setTimeout(() => setState((s) => ({ ...s, phase: "done", step: 0 })), total);
    return () => {
      window.clearTimeout(timer);
      end();
    };
  }, [running, total]);

  if (state.key !== key) return DONE;
  return state;
}
