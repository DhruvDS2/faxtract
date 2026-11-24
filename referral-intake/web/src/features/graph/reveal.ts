/**
 * The Decimals step reveal (decimals-d10992): on first load of a referral the
 * steps along the path it took light up in sequence, once per referral per
 * session (never on a refetch). During a live run each step lights as its trace
 * event arrives; when one poll brings several new steps at once (the steps after
 * extraction take milliseconds), they light in order too.
 *
 * Plain CSS transitions on opacity and colour, delayed per step: 80 ms apart,
 * compressed so a sequence stays within the 600 ms reveal token. Under reduced
 * motion there is no stagger, only one short fade.
 *
 * Driven by state, not by `m` `initial`, so a parent AnimatePresence with
 * initial={false} can't suppress it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DURATION, STAGGER, beginTransition, useMotionPrefs } from "@/lib/motion";

/** Referrals whose first-load reveal has played this session. */
const revealed = new Set<string>();

export type Reveal = {
  /** True while the steps in `order` are drawn unlit, waiting for their turn. */
  pending: boolean;
  /** Step id → its place in the sequence being lit. */
  order: Map<string, number>;
  /** Seconds between steps. */
  step: number;
};

type Phase = "pending" | "running" | "done";
type State = Reveal & { phase: Phase; key?: string };
const DONE: State = { phase: "done", pending: false, order: new Map(), step: 0 };

/** Seconds after the sequence starts until step `i` starts lighting. */
export const revealDelay = (r: Reveal, i: number | undefined) => (i === undefined ? 0 : i * r.step);

/**
 * `sequence`: the steps in the order they first ran (null until the trace has
 * loaded). `mapReady`: the map has been laid out and painted, so the lighting is seen.
 */
export function useStepReveal(key: string | undefined, sequence: string[] | null, mapReady: boolean): Reveal {
  const { reduce } = useMotionPrefs();
  const [state, setState] = useState<State>(DONE);
  const lit = useRef<{ key?: string; ids: Set<string> }>({ ids: new Set() });

  // Before paint: steps that are new since the last render go unlit (if there's a sequence to play).
  useLayoutEffect(() => {
    if (!key || !sequence) return;
    if (lit.current.key !== key) {
      lit.current = { key, ids: new Set() };
      if (revealed.has(key)) {
        // Revealed earlier this session: show it as it is, no replay.
        for (const id of sequence) lit.current.ids.add(id);
        setState({ ...DONE, key });
        return;
      }
    }
    const fresh = sequence.filter((id) => !lit.current.ids.has(id));
    for (const id of fresh) lit.current.ids.add(id);
    const first = !revealed.has(key);
    if (fresh.length === 0 || (!first && fresh.length < 2)) {
      // Nothing to sequence: a single new step lights by its own colour transition.
      if (first && fresh.length === 0) revealed.add(key);
      setState((s) => (s.key === key ? s : { ...DONE, key }));
      return;
    }
    const step = reduce ? 0 : Math.min(STAGGER.step, (DURATION.reveal - DURATION.state) / Math.max(1, fresh.length - 1));
    setState({ key, phase: "pending", pending: true, order: new Map(fresh.map((id, i) => [id, i])), step });
  }, [key, sequence, reduce]);

  // Once the map is on screen (two frames, so the unlit look has painted): start lighting.
  const waiting = state.phase === "pending" && state.key === key;
  const order = state.order;
  useEffect(() => {
    if (!waiting || !mapReady || !key) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        revealed.add(key);
        setState((s) => (s.order === order ? { ...s, phase: "running", pending: false } : s));
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [waiting, mapReady, key, order]);

  // The sequence takes at most 600 ms; then the delays are dropped so later changes are immediate.
  const running = state.phase === "running" && state.key === key;
  const total = ((state.order.size - 1) * state.step + DURATION.state) * 1000;
  useEffect(() => {
    if (!running) return;
    const end = beginTransition();
    const timer = window.setTimeout(() => setState((s) => (s.order === order ? { ...s, phase: "done", step: 0 } : s)), total);
    return () => {
      window.clearTimeout(timer);
      end();
    };
  }, [running, total, order]);

  return state.key === key ? state : DONE;
}
