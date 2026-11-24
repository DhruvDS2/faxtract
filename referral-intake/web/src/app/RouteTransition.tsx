import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PresenceContext, animate } from "motion/react";
import { UNSAFE_LocationContext, useLocation, useOutlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AnimatePresence, DURATION_MS, crossfade, m, useIsPresent, useMotionPrefs, useTransitionMarker } from "@/lib/motion";

/** Pages are keyed by pathname: query-string changes (filters, ?referral=) don't crossfade. */
export const routeKey = (pathname: string) => pathname.replace(/\/+$/, "") || "/";

/**
 * Route crossfade (V7): the outgoing page fades out (120 ms), then the incoming one
 * fades in (200 ms); the nav never moves. Both pages sit in the same box, so a
 * shared element (<Morph>) can travel from one to the other: when the incoming page
 * mounts a [data-morph] that the outgoing page also has, the incoming page shows at
 * once (data-route-morph) and only its other content fades in.
 * The outgoing page keeps the location it was rendered with, so its hooks don't see
 * the next route while it fades.
 */
export function RouteTransition() {
  const location = useLocation();
  const outlet = useOutlet();
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <AnimatePresence initial={false}>
        <RoutePage key={routeKey(location.pathname)}>{outlet}</RoutePage>
      </AnimatePresence>
    </div>
  );
}

/**
 * While a shared element flies in, its direct parent doesn't clip it: the page
 * header's title truncates (overflow hidden), which hid the name for the whole
 * flight. Once the window ends (data-route-morph goes), the ellipsis is back.
 * Keep morph targets out of scrolling panes: those still clip.
 */
const MORPH_UNCLIP = "data-[route-morph]:[&_:has(>[data-morph])]:overflow-visible";

/** Does this page contain a [data-morph] that a leaving page also contains? */
function sharesMorph(el: HTMLElement) {
  const leaving = [...(el.parentElement?.children ?? [])].filter((c) => c !== el && c.getAttribute("data-present") === null);
  if (!leaving.length) return false;
  return [...el.querySelectorAll<HTMLElement>("[data-morph]")].some((t) =>
    leaving.some((l) => l.querySelector(`[data-morph="${CSS.escape(t.dataset.morph ?? "")}"]`)),
  );
}

/**
 * `<AnimatePresence initial={false}>` skips the first page's own fade on a hard load,
 * but it hands `initial: false` down through PresenceContext to every m.* inside the
 * page too, so one-time reveals (field fill, graph step reveal, bars) never ran on a
 * direct load. The page's content gets the same presence (exit propagation and the
 * shared-element morph are unchanged) without that `initial: false`.
 */
function PagePresence({ children }: { children: React.ReactNode }) {
  const presence = useContext(PresenceContext);
  const value = useMemo(() => (presence && presence.initial === false ? { ...presence, initial: undefined } : presence), [presence]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

function RoutePage({ children }: { children: React.ReactNode }) {
  const present = useIsPresent();
  const ctx = useContext(UNSAFE_LocationContext);
  const frozen = useRef(ctx);
  if (present) frozen.current = ctx;
  const marker = useTransitionMarker();
  const { reduce } = useMotionPrefs();
  const ref = useRef<HTMLDivElement>(null);
  const [morph, setMorph] = useState(false);
  const morphing = useRef(false);

  // before first paint: is a shared element arriving from the page that's leaving?
  useLayoutEffect(() => {
    if (reduce || !ref.current || !sharesMorph(ref.current)) return;
    morphing.current = true;
    setMorph(true);
    const t = window.setTimeout(() => setMorph(false), DURATION_MS.panel + DURATION_MS.state);
    return () => window.clearTimeout(t);
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching the variant to "morph" isn't enough: "animate" and "morph" share the
  // target (opacity 1), so motion keeps the delayed crossfade running and the arriving
  // name sat inside a page at opacity 0 for most of its flight. Jump the page to opaque
  // once motion has started that fade (child effects run first), still before paint.
  useEffect(() => {
    if (morphing.current && ref.current) animate(ref.current, { opacity: 1 }, { type: false });
  }, []);

  return (
    <UNSAFE_LocationContext.Provider value={frozen.current}>
      <m.div
        ref={ref}
        data-testid="route-transition"
        data-present={present ? "" : undefined}
        data-route-morph={morph ? "" : undefined}
        aria-hidden={present ? undefined : true}
        inert={!present}
        className={cn("absolute inset-0 overflow-auto", !present && "pointer-events-none", MORPH_UNCLIP)}
        variants={crossfade}
        initial="initial"
        animate={morph ? "morph" : "animate"}
        exit="exit"
        onAnimationStart={marker.onAnimationStart}
        onAnimationComplete={marker.onAnimationComplete}
      >
        <PagePresence>{children}</PagePresence>
      </m.div>
    </UNSAFE_LocationContext.Provider>
  );
}
