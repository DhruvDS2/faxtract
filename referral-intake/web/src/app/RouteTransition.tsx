import { useContext, useRef } from "react";
import { UNSAFE_LocationContext, useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, crossfade, m, useIsPresent, useTransitionMarker } from "@/lib/motion";

/** Pages are keyed by pathname: query-string changes (filters, ?referral=) don't crossfade. */
export const routeKey = (pathname: string) => pathname.replace(/\/+$/, "") || "/";

/**
 * Route crossfade (V7): the outgoing page fades out fast (120 ms, exit curve) while
 * the incoming one settles in (320 ms, enter curve); the nav never moves. Both pages
 * are stacked in the same box, so a shared element (<Morph>) can travel from the
 * outgoing page to the incoming one. The outgoing page keeps the location it was
 * rendered with, so its hooks don't see the next route while it fades.
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

function RoutePage({ children }: { children: React.ReactNode }) {
  const present = useIsPresent();
  const ctx = useContext(UNSAFE_LocationContext);
  const frozen = useRef(ctx);
  if (present) frozen.current = ctx;
  const marker = useTransitionMarker();
  return (
    <UNSAFE_LocationContext.Provider value={frozen.current}>
      <m.div
        data-testid="route-transition"
        data-present={present || undefined}
        aria-hidden={present ? undefined : true}
        inert={!present}
        className={present ? "absolute inset-0 overflow-auto" : "pointer-events-none absolute inset-0 overflow-auto"}
        variants={crossfade}
        initial="initial"
        animate="animate"
        exit="exit"
        onAnimationStart={marker.onAnimationStart}
        onAnimationComplete={marker.onAnimationComplete}
      >
        {children}
      </m.div>
    </UNSAFE_LocationContext.Provider>
  );
}
