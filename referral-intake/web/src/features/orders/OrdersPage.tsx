import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createColumnHelper } from "@tanstack/react-table";
import { Check, RotateCw, Waypoints } from "lucide-react";
import type { RisOrderRow } from "@/contracts";
import { useOrders, useRetrySend } from "@/api/queries";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { Code } from "@/components/Code";
import { PageHeader } from "@/components/PageHeader";
import { AckBadge, StatusBadge } from "@/components/StatusBadge";
import { EmptyState, ErrorState, LoadingRows } from "@/components/States";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DataTable } from "@/features/graph/DataTable";

type Filter = "all" | "errors";
const isError = (r: RisOrderRow) => r.retryable || r.status === "ris_error" || !!r.last_error || (!!r.ack_code && r.ack_code !== "AA");
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

function RetryButton({ row }: { row: RisOrderRow }) {
  const retry = useRetrySend(row.referral_id);
  return (
    <Button
      size="sm"
      data-testid="btn-retry"
      disabled={retry.isPending}
      onClick={(e) => {
        e.stopPropagation();
        retry.mutate(undefined, {
          onSuccess: (r) =>
            r.status === "sent_to_ris"
              ? toast.success(`RIS accepted ${r.order.order_id ?? "the order"} (${r.order.ack_code ?? "AA"})`)
              : toast.error(`RIS did not accept ${r.order.order_id ?? "the order"}`, { description: r.order.last_error ?? undefined }),
          onError: (err) => toast.error("Retry failed", { description: err instanceof ApiError ? err.message : String(err) }),
        });
      }}
    >
      <RotateCw className={cn(retry.isPending && "animate-spin")} />
      {retry.isPending ? "Sending" : "Retry"}
    </Button>
  );
}

const col = createColumnHelper<RisOrderRow>();
const TIGHT = "w-px whitespace-nowrap";

const columns = [
  col.accessor("order_id", {
    header: "Order ID",
    meta: { className: TIGHT },
    cell: (c) => (
      <Link to={`/referrals/${c.row.original.referral_id}`} onClick={stop} className="hover:underline">
        <Code>{c.getValue() ?? c.row.original.referral_id}</Code>
      </Link>
    ),
  }),
  col.accessor("patient_name", {
    header: "Patient",
    meta: { className: TIGHT },
    cell: (c) => c.getValue() ?? <span className="text-fg-faint">-</span>,
  }),
  col.accessor("cpt_code", {
    header: "CPT",
    meta: { className: TIGHT },
    cell: (c) => (c.getValue() ? <Code>{c.getValue()}</Code> : <span className="text-fg-faint">-</span>),
  }),
  col.accessor("status", { header: "Status", meta: { className: TIGHT }, cell: (c) => <StatusBadge status={c.getValue()} /> }),
  col.accessor("ack_code", { header: "ACK", meta: { className: TIGHT }, cell: (c) => <AckBadge code={c.getValue()} /> }),
  col.accessor("attempts", { header: "Attempts", meta: { align: "right", className: TIGHT } }),
  col.accessor("last_error", {
    header: "Last error",
    enableSorting: false,
    meta: { className: "max-w-0 truncate" },
    cell: (c) =>
      c.getValue() ? (
        <span className="text-bad" title={c.getValue() ?? undefined}>
          {c.getValue()}
        </span>
      ) : (
        <span className="text-fg-faint">-</span>
      ),
  }),
  col.accessor("sent_at", {
    header: "Sent at",
    meta: { className: `${TIGHT} tabular-nums` },
    sortingFn: (a, b) => (a.original.sent_at ?? "").localeCompare(b.original.sent_at ?? ""),
    cell: (c) => fmtDateTime(c.getValue()),
  }),
  col.accessor("in_ris", {
    header: "In RIS",
    meta: { className: `${TIGHT} text-center`, headClassName: "text-center" },
    cell: (c) =>
      c.getValue() ? (
        <Check className="mx-auto size-4 text-ok" aria-label="in RIS" />
      ) : (
        <span className="text-fg-faint" aria-label="not in RIS">
          –
        </span>
      ),
  }),
  col.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    meta: { className: `${TIGHT} text-right` },
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1">
        {row.original.retryable && <RetryButton row={row.original} />}
        <Tip content="Show in pipeline graph">
          <Button asChild variant="ghost" size="icon" className="size-7" aria-label="Show in pipeline graph">
            <Link to={`/graph?referral=${row.original.referral_id}`} onClick={stop}>
              <Waypoints />
            </Link>
          </Button>
        </Tip>
      </span>
    ),
  }),
];

/** Screen 5: every referral with at least one send attempt, with its ACK and a retry for failed sends. */
export function OrdersPage() {
  const orders = useOrders();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const all = orders.data ?? [];
  const errors = useMemo(() => all.filter(isError), [all]);
  const rows = filter === "errors" ? errors : all;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="RIS orders"
        meta={
          orders.data
            ? `${all.length} order${all.length === 1 ? "" : "s"} sent over HL7 · ${all.filter((r) => r.in_ris).length} in the RIS · ${errors.length} with errors`
            : "ORM^O01 messages sent to the RIS and the ACK it returned"
        }
        actions={
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList className="h-8 border-b-0" aria-label="Filter orders">
              <TabsTrigger value="all" className="h-8" data-testid="orders-filter-all">
                All <span className="ml-1 text-fg-muted tabular-nums">{all.length}</span>
              </TabsTrigger>
              <TabsTrigger value="errors" className="h-8" data-testid="orders-filter-errors">
                Errors only <span className="ml-1 text-fg-muted tabular-nums">{errors.length}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {orders.isPending ? (
          <LoadingRows rows={6} />
        ) : orders.isError ? (
          <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            testId="orders-table"
            sortable
            initialSorting={[{ id: "sent_at", desc: true }]}
            getRowId={(r) => r.referral_id}
            rowProps={(row) => ({
              "data-testid": "order-row",
              "data-id": row.original.referral_id,
              "data-status": row.original.status,
              className: "cursor-pointer",
              onClick: () => navigate(`/referrals/${row.original.referral_id}`),
            })}
            empty={
              filter === "errors" && all.length > 0 ? (
                <EmptyState title="No failed sends" hint="Every order the RIS received was accepted." />
              ) : (
                <EmptyState title="No orders sent yet" hint="Approve a referral in the queue to send its ORM to the RIS." />
              )
            }
          />
        )}
      </div>
    </div>
  );
}
