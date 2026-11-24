import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { SortingState } from "@tanstack/react-table";
import type { ReferralStatus, ReferralSummary } from "@/contracts";
import { isSettling, useHealth, useReferrals } from "@/api/queries";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, describeError } from "@/components/States";
import { StatusLine } from "@/components/StatusLine";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { CountThrough } from "@/components/CountThrough";
import { DEFAULT_SORT, NO_PAYOR, columns, type QueueRow, type QueueTableMeta } from "./columns";
import { QuickAction } from "./QuickAction";
import { queueMemory } from "@/lib/queueMemory";
import { StatusTabs, type StatusTab } from "./StatusTabs";
import { UploadButton } from "./UploadButton";
import { useNow } from "./useNow";

const ALL = "all";
const isStatus = (v: string | null): v is ReferralStatus => !!v && v in STATUS;
const sameSort = (a: SortingState, b: SortingState) =>
  a.length === b.length && a.every((s, i) => s.id === b[i].id && s.desc === b[i].desc);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Status tabs, in work order. "All" is the default (no ?status). */
const TABS: { value: ReferralStatus; label: string }[] = [
  { value: "needs_review", label: "Needs review" },
  { value: "ris_error", label: "RIS errors" },
  { value: "sent_to_ris", label: "Sent" },
  { value: "rejected", label: "Rejected" },
];

/** What an empty tab says. */
const EMPTY_TAB: Partial<Record<ReferralStatus, { title: string; hint: string }>> = {
  needs_review: { title: "Nothing needs review", hint: "Referrals the pipeline can't finish on its own wait here for a person." },
  ris_error: { title: "No RIS errors", hint: "Every approved order reached the RIS." },
  sent_to_ris: { title: "Nothing sent to the RIS yet", hint: "Approved referrals show here once the RIS acknowledges the order." },
  rejected: { title: "Nothing rejected", hint: "Referrals a coordinator rejects show here with the reason." },
};

/**
 * Fixed layout, so columns don't shift between tabs (the header cells carry the widths;
 * Study takes the rest), and the first and last columns line up with the page gutter.
 * The quick-action column is sized for "Retry send".
 */
const TABLE_LAYOUT =
  "[&_table]:table-fixed [&_th:last-child]:w-28 [&_td:first-child]:pl-6 [&_th:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:last-child]:pr-6";


const matchesPayor = (r: ReferralSummary, payor: string) => (payor === NO_PAYOR ? !r.payor_name : r.payor_name === payor);
const clock = (t: number) => new Date(t).toTimeString().slice(0, 5);

/** "57 received today · 20 sent to RIS · 3 RIS errors · 4 rejected": counts that aren't zero, from the API. */
function metaLine(data: ReferralSummary[], counts: Partial<Record<ReferralStatus, number>>, now: number) {
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const today = data.filter((r) => Date.parse(r.created_at) >= midnight).length;
  const received =
    today === data.length && today > 0 ? `${today} received today` : today > 0 ? `${data.length} received, ${today} today` : `${data.length} received`;
  const working = data.filter((r) => isSettling(r.status)).length;
  const parts = [
    received,
    working && `${working} in progress`,
    counts.sent_to_ris && `${counts.sent_to_ris} sent to RIS`,
    counts.ris_error && `${counts.ris_error} ${plural(counts.ris_error, "RIS error", "RIS errors")}`,
    counts.rejected && `${counts.rejected} rejected`,
    counts.failed && `${counts.failed} failed`,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** A skeleton bar the height of a text line (inside a heading, so a span). */
const LineSkeleton = ({ className }: { className: string }) => (
  <span aria-hidden className={cn("inline-block animate-breathe rounded-sm bg-surface-2 align-middle", className)} />
);

/** Screen 1: the work queue. The display line says what needs a person; tabs filter by status. */
export function QueuePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get("status");
  const statusFilter = isStatus(statusParam) ? statusParam : undefined;
  const payorFilter = params.get("payor") || undefined;

  // unfiltered on purpose: the same cache entry feeds the nav counts and the referral header
  const query = useReferrals();
  const data = query.data;
  const now = useNow();
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORT);
  const [selectedId, setSelectedId] = useState<string | null>(queueMemory.selected);
  // rows with an action in flight keep their tab and their place until the filter changes
  const [pinned, setPinned] = useState<Record<string, ReferralStatus>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const [countFrom] = useState(queueMemory.needsReview);

  const search = params.toString();
  useEffect(() => {
    queueMemory.search = search ? `?${search}` : "";
  }, [search]);

  const counts = useMemo(() => {
    const c: Partial<Record<ReferralStatus, number>> = {};
    for (const r of data ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [data]);
  const needsReview = counts.needs_review ?? 0;
  useEffect(() => {
    if (data) queueMemory.needsReview = needsReview;
  }, [data, needsReview]);

  const payors = useMemo(() => {
    const names = new Set<string>();
    let none = false;
    for (const r of data ?? []) {
      if (r.payor_name) names.add(r.payor_name);
      else none = true;
    }
    return { names: [...names].sort((a, b) => a.localeCompare(b)), none };
  }, [data]);

  const rows = useMemo<QueueRow[]>(() => {
    const matches = (r: ReferralSummary) =>
      (!statusFilter || (pinned[r.id] ?? r.status) === statusFilter) && (!payorFilter || matchesPayor(r, payorFilter));
    return (data ?? []).filter(matches).map((r) => (pinned[r.id] ? { ...r, sortStatus: pinned[r.id] } : r));
  }, [data, statusFilter, payorFilter, pinned]);


  const setFilter = (key: "status" | "payor", value: string) => {
    const next = new URLSearchParams(params);
    if (value === ALL) next.delete(key);
    else next.set(key, value);
    setPinned({});
    setParams(next, { replace: true });
  };
  const clearFilters = () => {
    setPinned({});
    setParams(new URLSearchParams(), { replace: true });
  };

  const remember = useCallback((id: string) => {
    queueMemory.selected = id;
  }, []);
  const select = useCallback((id: string | null) => {
    queueMemory.selected = id;
    setSelectedId(id);
  }, []);
  const open = useCallback(
    (id: string) => {
      remember(id);
      navigate(`/referrals/${id}`);
    },
    [navigate, remember],
  );
  const pin = useCallback((r: ReferralSummary) => setPinned((p) => ({ ...p, [r.id]: p[r.id] ?? r.status })), []);

  // coming back from a referral: the row it was opened from is in view, before paint
  // (and before a shared element flying back from the referral header measures it)
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !data) return;
    restored.current = true;
    if (selectedId) scroller.current?.querySelector(`[data-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "center" });
  }, [data, selectedId]);

  const threshold = useHealth().data?.threshold;
  const meta = useMemo<QueueTableMeta>(() => ({ now, onOpen: remember, selectedId, threshold }), [now, remember, selectedId, threshold]);

  const summaryLine = useMemo(() => (data ? metaLine(data, counts, now) : null), [data, counts, now]);

  // ---------- header ----------
  let title: React.ReactNode;
  let metaText: React.ReactNode = null;
  if (data) {
    title =
      needsReview > 0 ? (
        <>
          <CountThrough value={needsReview} from={countFrom} initial={false} /> {plural(needsReview, "referral needs review", "referrals need review")}
        </>
      ) : (
        "Nothing needs review"
      );
    metaText = data.length ? summaryLine : null;
  } else if (query.isError) {
    title = "Couldn't load referrals";
  } else {
    title = (
      <>
        <LineSkeleton className="h-4 w-64" />
        <span className="sr-only">Loading referrals</span>
      </>
    );
    metaText = <LineSkeleton className="h-2.5 w-96" />;
  }
  const refreshError =
    query.isRefetchError && data ? (
      <StatusLine tone="bad" detail={`${describeError(query.error).cause} Showing the list from ${clock(query.dataUpdatedAt)}.`}>
        Couldn't refresh the queue
      </StatusLine>
    ) : undefined;

  // ---------- filters ----------
  // tab counts are within the payor filter, so a tab's count is what it shows
  const inPayor = payorFilter ? (data ?? []).filter((r) => matchesPayor(r, payorFilter)) : (data ?? []);
  const tabCount = (s?: ReferralStatus) => (data ? inPayor.filter((r) => !s || r.status === s).length : undefined);
  const tabs: StatusTab[] = TABS.map((t) => ({ ...t, count: tabCount(t.value) }));
  // a status outside the tabs (failed, or one picked by URL) gets its own tab before "All"
  for (const s of ["failed", statusFilter] as (ReferralStatus | undefined)[]) {
    if (!s || tabs.some((t) => t.value === s)) continue;
    if (s === statusFilter || counts[s]) tabs.push({ value: s, label: STATUS[s].label, count: tabCount(s) });
  }
  tabs.push({ value: ALL, label: "All", count: tabCount() });

  const empty = !data?.length ? (
    <EmptyState title="No referrals yet" hint="Upload a fax to start." />
  ) : payorFilter || !statusFilter || !EMPTY_TAB[statusFilter] ? (
    <EmptyState
      title="No referrals match these filters"
      hint="Clear the filters to see the whole queue."
      action={
        <Button size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      title={EMPTY_TAB[statusFilter]!.title}
      hint={EMPTY_TAB[statusFilter]!.hint}
      action={
        <Button size="sm" onClick={() => setFilter("status", ALL)}>
          Show all referrals
        </Button>
      }
    />
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader divider={false} title={title} status={refreshError} meta={metaText} actions={<UploadButton />} />

      <div className="flex h-10 shrink-0 items-end gap-6 border-b border-border px-6">
        <StatusTabs
          value={statusFilter ?? ALL}
          onChange={(v) => setFilter("status", v)}
          tabs={tabs}
          label="Filter by status"
          testId="filter-status"
        />
        <div className="ml-auto flex h-10 items-center gap-4">
          {!sameSort(sorting, DEFAULT_SORT) && (
            <Button variant="ghost" size="sm" onClick={() => setSorting(DEFAULT_SORT)} title="Back to work order: status, then lowest confidence">
              Reset sort
            </Button>
          )}
          <PayorFilter value={payorFilter ?? ALL} payors={payors} onChange={(v) => setFilter("payor", v)} resultsRef={scroller} />
          {!!data?.length && (
            <span className="inline-flex items-center gap-1 text-meta text-fg-faint" aria-hidden>
              <Kbd>j</Kbd>
              <Kbd>k</Kbd>
              <span className="ml-1">move</span>
              <Kbd className="ml-2">↵</Kbd>
              <span className="ml-1">open</span>
            </span>
          )}
        </div>
      </div>

      <div ref={scroller} tabIndex={-1} aria-label="Referrals" className="min-h-0 flex-1 overflow-auto focus-visible:outline-none">
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(r) => r.id}
            sorting={sorting}
            onSortingChange={setSorting}
            enableMultiSort
            meta={meta}
            testId="queue-table"
            rowTestId="queue-row"
            label="Referrals"
            rowProps={(row) => ({ "data-status": row.original.status })}
            loading={query.isPending}
            loadingRows={12}
            error={query.isError && !data ? query.error : undefined}
            onRetry={() => void query.refetch()}
            empty={empty}
            selectedId={selectedId}
            onSelectedChange={select}
            keyboard
            onOpen={(r, e) => {
              if (e && (e.metaKey || e.ctrlKey)) window.open(`/referrals/${r.id}`, "_blank", "noopener");
              else open(r.id);
            }}
            quickAction={(r) => <QuickAction row={r} onOpen={remember} onRetryStart={pin} />}
            className={TABLE_LAYOUT}
          />
      </div>
    </div>
  );
}

/**
 * Payor filter: a quiet select on the tab row. After a pick, focus moves to the
 * results so j/k work straight away; closing without a change returns it to the trigger.
 */
function PayorFilter({
  value,
  payors,
  onChange,
  resultsRef,
}: {
  value: string;
  payors: { names: string[]; none: boolean };
  onChange: (v: string) => void;
  resultsRef: React.RefObject<HTMLDivElement | null>;
}) {
  const changed = useRef(false);
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        changed.current = true;
        onChange(v);
      }}
    >
      <SelectTrigger
        data-testid="filter-payor"
        aria-label="Filter by payor"
        className="h-7 max-w-56 gap-1.5 border-transparent bg-transparent px-2 text-fg-muted hover:border-border hover:text-fg data-[state=open]:border-border"
      >
        <span className="shrink-0 text-fg-faint">Payor</span>
        <SelectValue>{value === ALL ? "All" : value === NO_PAYOR ? "None" : value}</SelectValue>
      </SelectTrigger>
      <SelectContent
        align="end"
        className="min-w-(--radix-select-trigger-width)"
        onCloseAutoFocus={(e) => {
          if (!changed.current) return;
          changed.current = false;
          e.preventDefault();
          resultsRef.current?.focus({ preventScroll: true });
        }}
      >
        <SelectItem value={ALL}>All payors</SelectItem>
        {payors.names.map((p) => (
          <SelectItem key={p} value={p}>
            {p}
          </SelectItem>
        ))}
        {payors.none && <SelectItem value={NO_PAYOR}>No payor</SelectItem>}
      </SelectContent>
    </Select>
  );
}
