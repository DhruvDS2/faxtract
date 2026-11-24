import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useHealth, useOrders, useReferrals } from "@/api/queries";
import { IS_MOCK } from "@/api/client";
import { StatusDot } from "@/components/StatusPill";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TravelingHighlight, useTravelingHighlight } from "@/components/TravelingHighlight";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { RouteTransition } from "./RouteTransition";

type NavItem = { to: string; label: string; also?: string; count?: number; countLabel?: string };

/** Health as words: "RIS up" is quiet, "RIS down" is red text. */
function Health({ label, up, testId }: { label: string; up: boolean | undefined; testId: string }) {
  const word = up === undefined ? "…" : up ? "up" : "down";
  return (
    <Tip content={`${label} is ${up === undefined ? "being checked" : up ? "reachable" : "not answering"}`}>
      <span data-testid={testId} data-up={up === undefined ? undefined : String(up)} className={cn("text-meta whitespace-nowrap", up === false ? "font-medium text-bad" : "text-fg-faint")}>
        {label} {word}
      </span>
    </Tip>
  );
}

/** How long a first /health check may take before we say the API isn't answering. */
const CHECK_GRACE_MS = 4000;

/**
 * The top bar's health: pipeline, RIS and DB as words once /health answers. Before
 * that, one quiet "Checking the API…"; if it fails or takes longer than the grace
 * period, "API not responding" in red. A failed refetch keeps the last known pipeline.
 */
function HealthWords({ health }: { health: ReturnType<typeof useHealth> }) {
  const [late, setLate] = useState(false);
  const waiting = !health.data && !health.isError;
  useEffect(() => {
    if (!waiting) return;
    const t = window.setTimeout(() => setLate(true), CHECK_GRACE_MS);
    return () => window.clearTimeout(t);
  }, [waiting]);

  const down = (
    <span role="alert" data-testid="health-api" className="text-meta font-medium whitespace-nowrap text-bad">
      API not responding
    </span>
  );
  if (!health.data) {
    if (health.isError || late) return down;
    return (
      <span data-testid="health-api" aria-live="polite" className="inline-flex items-center gap-2 text-meta whitespace-nowrap text-fg-faint">
        <StatusDot tone="idle" running />
        Checking the API…
      </span>
    );
  }
  const h = health.data;
  return (
    <>
      <Tip content="Which pipeline the API is serving (PIPELINE env)">
        <span data-testid="pipeline-badge" className="font-mono text-code text-fg-faint">
          pipeline <span className="text-fg-muted">{h.pipeline}</span>
        </span>
      </Tip>
      {health.isError ? (
        down
      ) : (
        <>
          <Health label="RIS" up={h.ris === "up"} testId="health-ris" />
          <Health label="DB" up={h.db} testId="health-db" />
        </>
      )}
    </>
  );
}

/** Nav counts: work waiting (needs review) and RIS errors, read from the API. */
function useNavCounts() {
  const referrals = useReferrals();
  const orders = useOrders();
  return useMemo(() => {
    const review = referrals.data?.filter((r) => r.status === "needs_review").length;
    const risErrors = orders.data?.filter((o) => o.status === "ris_error").length;
    return { review, risErrors };
  }, [referrals.data, orders.data]);
}

export function AppShell() {
  const health = useHealth();
  const { pathname } = useLocation();
  const { review, risErrors } = useNavCounts();
  const hl = useTravelingHighlight<HTMLElement>();

  const nav: NavItem[] = [
    { to: "/queue", label: "Queue", also: "/referrals", count: review, countLabel: "need review" },
    { to: "/graph", label: "Pipeline" },
    { to: "/evals", label: "Evals" },
    { to: "/orders", label: "RIS orders", count: risErrors, countLabel: "RIS errors" },
  ];

  return (
    <div className="flex h-full bg-bg">
      <aside className="flex w-(--shell-nav-w) shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex h-(--shell-bar-h) shrink-0 items-center px-4">
          <span className="text-body font-semibold text-fg">Referral Intake</span>
        </div>
        <nav ref={hl.container.ref} onPointerLeave={hl.container.onPointerLeave} aria-label="Main" className="relative flex flex-col gap-0.5 px-2 pt-2">
          <TravelingHighlight state={hl.state} className="rounded-md" />
          {nav.map((n) => {
            const active = pathname.startsWith(n.to) || (!!n.also && pathname.startsWith(n.also));
            return (
              <NavLink
                key={n.to}
                to={n.to}
                {...hl.item}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-8 items-center justify-between gap-2 rounded-md px-2 text-body transition-colors duration-fast ease-enter",
                  active ? "bg-selected font-medium text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                <span className="truncate">{n.label}</span>
                {!!n.count && (
                  <span className="text-meta text-fg-muted tabular-nums" aria-label={`${n.count} ${n.countLabel}`}>
                    {n.count}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-auto px-4 py-4 text-meta text-fg-faint">Synthetic data · no PHI</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-(--shell-bar-h) shrink-0 items-center gap-4 border-b border-border px-4">
          {IS_MOCK && <span className="text-meta font-medium text-warn">Mock data</span>}
          <div className="ml-auto flex items-center gap-4">
            <HealthWords health={health} />
            <ThemeToggle />
          </div>
        </header>
        <main className="min-h-0 flex-1">
          <RouteTransition />
        </main>
      </div>
    </div>
  );
}
