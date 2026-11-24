import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ReferralSummary, RisOrderRow } from "@/contracts";
import { useHealth, useOrders, useReferrals } from "@/api/queries";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, describeError } from "@/components/States";
import { StatusLine } from "@/components/StatusLine";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { columns, type OrderRow, type OrdersTableMeta } from "./columns";
import { headline, isUnacknowledged, metaLine } from "./orderState";
import { RetrySend } from "./RetrySend";
import { useNow } from "./useNow";

type View = "all" | "unacknowledged";
const VIEW_PARAM = "show";

/** Fixed layout (header cells carry the widths, Study takes the rest); first and last columns on the page gutter. */
const TABLE_LAYOUT =
  "[&_table]:table-fixed [&_th:last-child]:w-28 [&_td:first-child]:pl-6 [&_th:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:last-child]:pr-6";


const clock = (t: number) => new Date(t).toTimeString().slice(0, 5);

const LineSkeleton = ({ className }: { className: string }) => (
  <span aria-hidden className={cn("inline-block animate-breathe rounded-sm bg-surface-2 align-middle", className)} />
);

/** Screen 5: every order sent to the RIS over HL7, with what the RIS answered and a retry for the ones it didn't take. */
export function OrdersPage() {
  const orders = useOrders();
  const referrals = useReferrals(); // same cache as the queue and the nav: DOB and study for each order
  const health = useHealth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view: View = params.get(VIEW_PARAM) === "unacknowledged" ? "unacknowledged" : "all";
  const now = useNow();

  const [sending, setSending] = useState<Record<string, true>>({});
  // rows retried on this page keep their place and their tab until the view changes
  const [pinned, setPinned] = useState<Record<string, string | null>>({});
  const onPending = useCallback((r: RisOrderRow, pending: boolean) => {
    const id = r.referral_id;
    setSending((s) => {
      if (!!s[id] === pending) return s;
      const next = { ...s };
      if (pending) next[id] = true;
      else delete next[id];
      return next;
    });
    if (pending) setPinned((p) => (id in p ? p : { ...p, [id]: r.sent_at }));
  }, []);

  const all = useMemo(() => orders.data ?? [], [orders.data]);
  const unacked = useMemo(() => all.filter(isUnacknowledged), [all]);
  const rows = useMemo<OrderRow[]>(() => {
    const shown = view === "unacknowledged" ? all.filter((r) => isUnacknowledged(r) || r.referral_id in pinned) : all;
    return shown.map((r) => (r.referral_id in pinned ? { ...r, sortAt: pinned[r.referral_id] } : r));
  }, [all, view, pinned]);


  const byId = useMemo(() => new Map<string, ReferralSummary>((referrals.data ?? []).map((r) => [r.id, r])), [referrals.data]);
  const meta = useMemo<OrdersTableMeta>(() => ({ now, sending, referrals: byId }), [now, sending, byId]);

  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    if (v === "all") next.delete(VIEW_PARAM);
    else next.set(VIEW_PARAM, v);
    setPinned({});
    setParams(next, { replace: true });
  };

  // ---------- header ----------
  const risDown = health.data?.ris === "down";
  const title = orders.data ? (
    headline(all)
  ) : orders.isError ? (
    "Couldn't load RIS orders"
  ) : (
    <>
      <LineSkeleton className="h-4 w-80" />
      <span className="sr-only">Loading RIS orders</span>
    </>
  );
  const metaText = orders.data ? (all.length ? metaLine(all) : null) : orders.isError ? null : <LineSkeleton className="h-2.5 w-96" />;
  const refreshError = orders.isRefetchError && orders.data;
  const status =
    risDown || refreshError ? (
      <>
        {risDown && (
          <StatusLine tone="bad" data-testid="ris-down">
            The RIS isn't answering. New orders will fail until it's back.
          </StatusLine>
        )}
        {refreshError && (
          <StatusLine tone="bad" detail={`${describeError(orders.error).cause} Showing the list from ${clock(orders.dataUpdatedAt)}.`}>
            Couldn't refresh the orders
          </StatusLine>
        )}
      </>
    ) : undefined;

  const empty =
    view === "unacknowledged" && all.length ? (
      <EmptyState
        title="Every order was acknowledged"
        hint={`The RIS answered AA to ${all.length === 1 ? "the one order" : `all ${all.length} orders`}.`}
        action={
          <Button size="sm" onClick={() => setView("all")}>
            Show all orders
          </Button>
        }
      />
    ) : (
      <EmptyState title="Approve a referral to send its first order" hint="Each order shows here with what the RIS answered (its ACK)." />
    );

  return (
    <div className="flex h-full flex-col">
      <PageHeader divider={false} title={title} status={status} meta={metaText} />

      <div className="flex h-10 shrink-0 items-end gap-6 border-b border-border px-6">
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList className="border-b-0" aria-label="Filter orders">
            <TabsTrigger value="all" data-testid="orders-filter-all">
              All {orders.data && <span className="font-normal text-fg-faint tabular-nums">{all.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="unacknowledged" data-testid="orders-filter-errors">
              Not acknowledged {orders.data && <span className="font-normal text-fg-faint tabular-nums">{unacked.length}</span>}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {!!rows.length && (
          <span className="ml-auto inline-flex h-10 items-center gap-1 text-meta text-fg-faint" aria-hidden>
            <Kbd>j</Kbd>
            <Kbd>k</Kbd>
            <span className="ml-1">move</span>
            <Kbd className="ml-2">↵</Kbd>
            <span className="ml-1">open referral</span>
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(r) => r.referral_id}
            initialSorting={[{ id: "last_attempt", desc: true }]}
            meta={meta}
            testId="orders-table"
            rowTestId="order-row"
            label="RIS orders"
            rowProps={(row) => ({ "data-status": row.original.status })}
            loading={orders.isPending}
            loadingRows={8}
            error={orders.isError && !orders.data ? orders.error : undefined}
            onRetry={() => void orders.refetch()}
            empty={empty}
            keyboard
            onOpen={(r, e) => {
              if (e && (e.metaKey || e.ctrlKey)) window.open(`/referrals/${r.referral_id}`, "_blank", "noopener");
              else navigate(`/referrals/${r.referral_id}`);
            }}
            quickAction={(r) => (r.retryable ? <RetrySend row={r} onPending={onPending} /> : null)}
            className={TABLE_LAYOUT}
          />
      </div>
    </div>
  );
}
