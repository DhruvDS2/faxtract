import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Activity, FlaskConical, Inbox, Send, Waypoints } from "lucide-react";
import { useHealth } from "@/api/queries";
import { IS_MOCK } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/queue", label: "Queue", icon: Inbox },
  { to: "/graph", label: "Pipeline graph", icon: Waypoints },
  { to: "/evals", label: "Evals", icon: FlaskConical },
  { to: "/orders", label: "RIS orders", icon: Send },
];

function HealthDot({ label, up }: { label: string; up: boolean | undefined }) {
  return (
    <Tip content={`${label}: ${up === undefined ? "unknown" : up ? "up" : "down"}`}>
      <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
        <span className={cn("size-1.5 rounded-full", up === undefined ? "bg-fg-faint" : up ? "bg-ok" : "bg-bad")} />
        {label}
      </span>
    </Tip>
  );
}

export function AppShell() {
  const health = useHealth();
  const { pathname } = useLocation();
  const section = NAV.find((n) => pathname.startsWith(n.to))?.label ?? (pathname.startsWith("/referrals") ? "Referral" : "");

  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex h-11 items-center gap-2 border-b border-border px-3">
          <Activity className="size-4 text-accent" />
          <span className="text-sm font-semibold">Referral Intake</span>
        </div>
        <nav className="flex flex-col gap-px p-2" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg",
                  (isActive || (to === "/queue" && pathname.startsWith("/referrals"))) && "bg-accent-subtle font-medium text-accent",
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto p-3">
          <Badge tone="outline" className="w-full justify-center">Synthetic data · no PHI</Badge>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
          <span className="text-sm text-fg-muted">{section}</span>
          <div className="ml-auto flex items-center gap-3">
            {IS_MOCK && <Badge tone="warn">MOCK DATA</Badge>}
            <Tip content="Which pipeline the API is serving (PIPELINE env)">
              <Badge tone="accent" data-testid="pipeline-badge">
                PIPELINE <span className="font-mono">{health.data?.pipeline ?? "…"}</span>
              </Badge>
            </Tip>
            <HealthDot label="DB" up={health.data?.db} />
            <HealthDot label="RIS" up={health.data ? health.data.ris === "up" : undefined} />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
