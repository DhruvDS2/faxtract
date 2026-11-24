import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { Navigate, RouterProvider, createBrowserRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "./AppShell";
import { QueuePage } from "@/features/queue/QueuePage";
import { ReferralPage } from "@/features/referral/ReferralPage";
import { GraphPage } from "@/features/graph/GraphPage";
import { EvalsPage } from "@/features/evals/EvalsPage";
import { OrdersPage } from "@/features/orders/OrdersPage";

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
const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/queue" replace /> },
      { path: "queue", element: <QueuePage /> },
      { path: "referrals/:id", element: <ReferralPage /> },
      { path: "graph", element: <GraphPage /> },
      { path: "evals", element: <EvalsPage /> },
      { path: "orders", element: <OrdersPage /> },
      { path: "*", element: <Navigate to="/queue" replace /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
