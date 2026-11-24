import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Code } from "@/components/Code";
import { Morph } from "@/components/Morph";
import { ReferralStatusPill } from "@/components/StatusBadge";
import { StatusLine } from "@/components/StatusLine";
import { AnimatePresence, DURATION_MS, fade, m, referralLayoutId, useTransitionMarker } from "@/lib/motion";
import { sharedMorphTargets, tagMorphArrival } from "@/lib/morph";
import { statusText } from "@/lib/status";
import { SAMPLE_REFERRALS } from "./samples";

const LIST = SAMPLE_REFERRALS.slice(0, 4);

/** In-page proof: a list item's name grows into a detail panel header, and back. */
export function MorphDemo() {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = LIST.find((r) => r.id === openId);
  const marker = useTransitionMarker();
  // the arriving view is opaque at once (its morph target must stay visible); the rest
  // of it fades in (lib/morph.ts tags it), as on a route change
  const arrive = { variants: fade, initial: false as const, animate: "animate", exit: "exit", ...marker };
  return (
    <div className="relative h-64 max-w-3xl overflow-hidden rounded-md border border-border" data-testid="morph-demo">
      <AnimatePresence initial={false}>
        {open ? (
          <Arriving key="detail" as="div" className="absolute inset-0 px-6 py-5" {...arrive}>
            <button type="button" onClick={() => setOpenId(null)} className="cursor-pointer text-meta text-fg-muted hover:text-fg" data-testid="morph-back">
              ← Sample list
            </button>
            <Morph layoutId={`sg-inpage-${open.id}`} as="h3" className="mt-1 w-fit text-display text-fg">
              {open.patient}
            </Morph>
            <StatusLine className="mt-1" tone={statusText(open.status, open.ack).tone} detail={`${open.dob} · sample`}>
              {statusText(open.status, open.ack).label}
            </StatusLine>
            <p className="mt-4 max-w-lg text-body text-fg-muted">
              <Code>{open.cpt}</Code> {open.study}
            </p>
          </Arriving>
        ) : (
          <Arriving key="list" as="ul" className="absolute inset-0 py-2" {...arrive}>
            {LIST.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(r.id)}
                  data-testid="morph-item"
                  className="flex h-10 w-full cursor-pointer items-center gap-4 px-6 text-left text-body transition-colors duration-fast hover:bg-surface"
                >
                  <Morph layoutId={`sg-inpage-${r.id}`} as="span" className="min-w-0 truncate font-medium text-fg">
                    {r.patient}
                  </Morph>
                  <span className="ml-auto shrink-0">
                    <ReferralStatusPill status={r.status} ack={r.ack} />
                  </span>
                </button>
              </li>
            ))}
          </Arriving>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A view that tags its arrival around a shared element coming from the view leaving beside it. */
const Arriving = forwardRef<HTMLElement, React.ComponentProps<typeof m.div> & { as: "div" | "ul" }>(({ as, ...props }, _ref) => {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const others = [...(el.parentElement?.children ?? [])].filter((c) => c !== el);
    const targets = sharedMorphTargets(el, others);
    if (!targets.length) return;
    const untag = tagMorphArrival(el, targets);
    const t = window.setTimeout(untag, DURATION_MS.panel + DURATION_MS.state);
    return () => {
      window.clearTimeout(t);
      untag();
    };
  }, []);
  const Tag = (as === "ul" ? m.ul : m.div) as typeof m.div;
  return <Tag ref={ref as React.Ref<HTMLDivElement>} {...props} />;
});
Arriving.displayName = "Arriving";

/** Across routes: the same wrappers Lane A (row) and Lane B (detail header) use. */
export function MorphRouteList() {
  return (
    <ul className="w-full max-w-3xl" data-testid="morph-route-list">
      {LIST.map((r) => (
        <li key={r.id} className="border-b border-border last:border-b-0">
          <Link
            to={`/__styleguide/morph/${r.id}`}
            className="flex h-10 items-center gap-4 px-2 text-body transition-colors duration-fast hover:bg-surface"
            data-testid="morph-route-item"
          >
            <Morph layoutId={referralLayoutId(r.id)} as="span" className="min-w-0 truncate font-medium text-fg">
              {r.patient}
            </Morph>
            <span className="text-meta text-fg-faint tabular-nums">{r.dob}</span>
            <span className="ml-auto shrink-0">
              <ReferralStatusPill status={r.status} ack={r.ack} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
