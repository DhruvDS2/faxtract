import { useContext, useLayoutEffect, useRef, useState } from "react";
import { UNSAFE_LocationContext, useLocation, useOutlet } from "react-router-dom";
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

/** Does this page contain a [data-morph] that a leaving page also contains? */
function sharesMorph(el: HTMLElement) {
  const leaving = [...(el.parentElement?.children ?? [])].filter((c) => c !== el && c.getAttribute("data-present") === null);
  if (!leaving.length) return false;
  return [...el.querySelectorAll<HTMLElement>("[data-morph]")].some((t) =>
    leaving.some((l) => l.querySelector(`[data-morph="${CSS.escape(t.dataset.morph ?? "")}"]`)),
  );
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

  // before first paint: is a shared element arriving from the page that's leaving?
  useLayoutEffect(() => {
    if (reduce || !ref.current || !sharesMorph(ref.current)) return;
    setMorph(true);
    const t = window.setTimeout(() => setMorph(false), DURATION_MS.panel + DURATION_MS.state);
    return () => window.clearTimeout(t);
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        className={present ? "absolute inset-0 overflow-auto" : "pointer-events-none absolute inset-0 overflow-auto"}
        variants={crossfade}
        initial="initial"
        animate={morph ? "morph" : "animate"}
        exit="exit"
        onAnimationStart={marker.onAnimationStart}
        onAnimationComplete={marker.onAnimationComplete}
      >
        {children}
      </m.div>
    </UNSAFE_LocationContext.Provider>
  );
}
