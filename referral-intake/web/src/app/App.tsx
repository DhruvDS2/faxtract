import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LazyMotion, MotionConfig } from "motion/react";
import { ApiError } from "@/api/client";
import { Navigate, RouterProvider, createBrowserRouter, isRouteErrorResponse, useRouteError } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRows } from "@/components/States";
import { transition } from "@/lib/motion";
import "@/lib/theme"; // applies the stored theme to <html> before the first render
import { AppShell } from "./AppShell";

// ---------- route code-splitting ----------

/**
 * A lazy route that can be preloaded. Once its module has arrived, the page renders
 * directly (no Suspense round-trip), so a preloaded page mounts in the same commit as
 * the navigation: the queue → detail shared element (<Morph>) needs exactly that.
 */
function lazyPage<M>(load: () => Promise<M>, pick: (m: M) => ComponentType) {
  let Loaded: ComponentType | null = null;
  let pending: Promise<void> | null = null;
  const preload = () =>
    (pending ??= load().then(
      (m) => {
        Loaded = pick(m);
      },
      (e) => {
        pending = null; // let a later visit retry (e.g. a deploy replaced the chunk)
        throw e;
      },
    ));
  const Lazy = lazy(() => preload().then(() => ({ default: Loaded as ComponentType })));
  function Page() {
    return Loaded ? <Loaded /> : <Lazy />;
  }
  return { Page, preload };
}

const queue = lazyPage(() => import("@/features/queue/QueuePage"), (m) => m.QueuePage);
const referral = lazyPage(() => import("@/features/referral/ReferralPage"), (m) => m.ReferralPage);
const graph = lazyPage(() => import("@/features/graph/GraphPage"), (m) => m.GraphPage);
const evals = lazyPage(() => import("@/features/evals/EvalsPage"), (m) => m.EvalsPage);
const orders = lazyPage(() => import("@/features/orders/OrdersPage"), (m) => m.OrdersPage);
// The styleguide is for the team, not coordinators.
const styleguide = lazyPage(() => import("@/features/styleguide"), (m) => m.default);
// Animation features (layout, shared elements, exit) arrive after first paint.
const loadMotionFeatures = () => import("@/lib/motion-features").then((m) => m.default);

const onIdle = (fn: () => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 4000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(fn, 1500);
  return () => window.clearTimeout(t);
};

/** The queue is the way into a referral: once it has mounted, fetch the detail page on idle. */
function QueueRoute() {
  useEffect(() => onIdle(() => void referral.preload().catch(() => undefined)), []);
  return <queue.Page />;
}

// ---------- quiet route states ----------

/** While a route's code loads: the page's skeleton, never a spinner. */
function RouteFallback() {
  return (
    <div className="flex h-full flex-col" aria-busy="true" aria-label="Loading page" data-testid="route-fallback">
      <div className="flex flex-col gap-2 border-b border-border px-6 pt-6 pb-4">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-3 w-96" />
      </div>
      <LoadingRows rows={8} />
    </div>
  );
}

const suspended = (node: React.ReactNode) => <Suspense fallback={<RouteFallback />}>{node}</Suspense>;

/** A render error (or a chunk that failed to load) in one page: plain copy, the shell stays. */
function RouteError() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error ?? "");
  return (
    <div role="alert" className="flex flex-col items-start gap-1 px-6 py-16" data-testid="route-error">
      <div className="text-body font-medium text-fg">Something went wrong on this page.</div>
      <div className="max-w-xl text-body text-fg-muted">Reload to try again. The rest of the app still works.</div>
      {detail && <div className="max-w-xl font-mono text-code break-words text-fg-faint">{detail}</div>}
      <Button size="sm" className="mt-3" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}

// ---------- app ----------

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2_000,
      refetchOnWindowFocus: false,
      // a 4xx is an answer, not a blip: show it now instead of retrying
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
    },
  },
});

// Routes are frozen (docs/CONTRACTS.md). /graph takes ?referral=<id>; /referrals/:id takes ?edit=1.
// /__styleguide is the design-system reference (web/DESIGN.md).
const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Navigate to="/queue" replace /> },
          { path: "queue", element: suspended(<QueueRoute />) },
          { path: "referrals/:id", element: suspended(<referral.Page />) },
          { path: "graph", element: suspended(<graph.Page />) },
          { path: "evals", element: suspended(<evals.Page />) },
          { path: "orders", element: suspended(<orders.Page />) },
          { path: "__styleguide/*", element: suspended(<styleguide.Page />) },
          { path: "*", element: <Navigate to="/queue" replace /> },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={loadMotionFeatures} strict>
        {/* reducedMotion="user": with prefers-reduced-motion, transforms and layout morphs are off; opacity stays */}
        <MotionConfig reducedMotion="user" transition={transition.state}>
          <TooltipProvider delayDuration={300}>
            <RouterProvider router={router} />
            <Toaster />
          </TooltipProvider>
        </MotionConfig>
      </LazyMotion>
    </QueryClientProvider>
  );
}
