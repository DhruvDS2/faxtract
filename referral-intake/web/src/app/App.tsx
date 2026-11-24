import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LazyMotion, MotionConfig } from "motion/react";
import { ApiError } from "@/api/client";
import { Navigate, RouterProvider, createBrowserRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { transition } from "@/lib/motion";
import "@/lib/theme"; // applies the stored theme to <html> before the first render
import { AppShell } from "./AppShell";
import { QueuePage } from "@/features/queue/QueuePage";
import { ReferralPage } from "@/features/referral/ReferralPage";
import { EvalsPage } from "@/features/evals/EvalsPage";
import { OrdersPage } from "@/features/orders/OrdersPage";

// React Flow is the heaviest dependency: the graph route loads on first visit (offsets
// motion in the initial bundle; Lane E code-splits the remaining routes).
const GraphPage = lazy(() => import("@/features/graph/GraphPage").then((m) => ({ default: m.GraphPage })));
// The styleguide is for the team, not coordinators: loaded only when visited.
const Styleguide = lazy(() => import("@/features/styleguide"));
// Animation features (layout, shared elements, exit) arrive after first paint.
const loadMotionFeatures = () => import("@/lib/motion-features").then((m) => m.default);

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
    children: [
      { index: true, element: <Navigate to="/queue" replace /> },
      { path: "queue", element: <QueuePage /> },
      { path: "referrals/:id", element: <ReferralPage /> },
      { path: "graph", element: <Suspense fallback={null}><GraphPage /></Suspense> },
      { path: "evals", element: <EvalsPage /> },
      { path: "orders", element: <OrdersPage /> },
      { path: "__styleguide/*", element: <Suspense fallback={null}><Styleguide /></Suspense> },
      { path: "*", element: <Navigate to="/queue" replace /> },
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
