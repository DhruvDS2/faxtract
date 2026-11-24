import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, RotateCcw } from "lucide-react";
import type { ReferralStatus, ReferralSummary } from "@/contracts";
import { useReferrals } from "@/api/queries";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STATUS, STATUS_ORDER } from "@/lib/status";
import { cn } from "@/lib/utils";
import { COLUMN_CLASS, DEFAULT_SORT, NO_PAYOR, columns, type QueueTableMeta } from "./columns";
import { UploadButton } from "./UploadButton";
import { useHotkeys } from "./useHotkeys";
import { useNow } from "./useNow";

const ALL = "all";
const isStatus = (v: string | null): v is ReferralStatus => !!v && v in STATUS;
const sameSort = (a: SortingState, b: SortingState) =>
  a.length === b.length && a.every((s, i) => s.id === b[i].id && s.desc === b[i].desc);

// Survives navigating to a referral and back, so j/k picks up where you left off.
let lastSelected: string | null = null;

export function QueuePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const statusFilter = isStatus(params.get("status")) ? (params.get("status") as ReferralStatus) : undefined;
  const payorFilter = params.get("payor") || undefined;

  const query = useReferrals();
  const data = query.data;
  const now = useNow();
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORT);
  const [selectedId, setSelectedId] = useState<string | null>(lastSelected);
  const scroller = useRef<HTMLDivElement>(null);

  const columnFilters = useMemo<ColumnFiltersState>(
    () => [
      ...(statusFilter ? [{ id: "status", value: statusFilter }] : []),
      ...(payorFilter ? [{ id: "payor", value: payorFilter }] : []),
    ],
    [statusFilter, payorFilter],
  );

  const table = useReactTable<ReferralSummary>({
    data: data ?? [],
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableMultiSort: true,
    enableSortingRemoval: false,
    isMultiSortEvent: (e) => !!(e as React.MouseEvent).shiftKey,
    meta: { now } satisfies QueueTableMeta,
  });
  const rows = table.getRowModel().rows;

  const counts = useMemo(() => {
    const c: Partial<Record<ReferralStatus, number>> = {};
    for (const r of data ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [data]);
  const payors = useMemo(() => {
    const names = new Set<string>();
    let none = false;
    for (const r of data ?? []) {
      if (r.payor_name) names.add(r.payor_name);
      else none = true;
    }
    return { names: [...names].sort((a, b) => a.localeCompare(b)), none };
  }, [data]);

  const setFilter = (key: "status" | "payor", value: string) => {
    const next = new URLSearchParams(params);
    if (value === ALL) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const clearFilters = () => setParams(new URLSearchParams(), { replace: true });

  const select = useCallback((id: string | null) => {
    lastSelected = id;
    setSelectedId(id);
    if (id) scroller.current?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, []);
  const open = (id: string) => {
    lastSelected = id;
    navigate(`/referrals/${id}`);
  };

  const move = (delta: 1 | -1) => {
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.id === selectedId);
    const next = i === -1 ? (delta === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, i + delta));
    select(rows[next].id);
  };
  useHotkeys({
    j: () => move(1),
    k: () => move(-1),
    Enter: () => {
      if (selectedId && rows.some((r) => r.id === selectedId)) open(selectedId);
    },
  });

  const needReview = counts.needs_review ?? 0;
  const risErrors = counts.ris_error ?? 0;
  const filtered = columnFilters.length > 0;
  const sortIsDefault = sameSort(sorting, DEFAULT_SORT);

  const meta = data && (
    <span className="tabular-nums">
      {data.length} referral{data.length === 1 ? "" : "s"}
      {needReview > 0 && ` · ${needReview} need${needReview === 1 ? "s" : ""} review`}
      {risErrors > 0 && ` · ${risErrors} RIS error${risErrors === 1 ? "" : "s"}`}
    </span>
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Queue" meta={meta ?? "Loading referrals…"} actions={<UploadButton />} />

      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <Select value={statusFilter ?? ALL} onValueChange={(v) => setFilter("status", v)}>
          <SelectTrigger className="w-44" data-testid="filter-status" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS[s].label}
                {counts[s] ? <span className="ml-2 text-fg-faint tabular-nums">{counts[s]}</span> : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={payorFilter ?? ALL} onValueChange={(v) => setFilter("payor", v)}>
          <SelectTrigger className="w-48" data-testid="filter-payor" aria-label="Filter by payor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All payors</SelectItem>
            {payors.names.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
            {payors.none && <SelectItem value={NO_PAYOR}>No payor</SelectItem>}
          </SelectContent>
        </Select>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
        {data && filtered && (
          <span className="text-xs text-fg-muted tabular-nums">
            {rows.length} of {data.length}
          </span>
        )}
        {query.isRefetchError && data && (
          <span className="text-xs text-bad" role="status">
            Couldn't refresh: {query.error instanceof Error ? query.error.message : "request failed"}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3 text-xs text-fg-muted">
          {!sortIsDefault && (
            <Button variant="ghost" size="sm" onClick={() => setSorting(DEFAULT_SORT)}>
              <RotateCcw aria-hidden />
              Work order
            </Button>
          )}
          <span className="inline-flex items-center gap-1">
            <Kbd>j</Kbd>
            <Kbd>k</Kbd>
            <span className="ml-0.5">move</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>↵</Kbd>
            <span className="ml-0.5">open</span>
          </span>
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        {query.isError && !data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <Table data-testid="queue-table" className="table-fixed" aria-busy={query.isPending}>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="hover:bg-transparent">
                  {hg.headers.map((header) => {
                    const col = header.column;
                    const dir = col.getIsSorted();
                    const multi = sorting.length > 1 && dir;
                    return (
                      <TableHead
                        key={header.id}
                        className={COLUMN_CLASS[col.id]}
                        aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                      >
                        <button
                          type="button"
                          onClick={col.getToggleSortingHandler()}
                          className={cn(
                            "group inline-flex h-6 items-center gap-1 rounded-sm hover:text-fg",
                            dir && "text-fg",
                          )}
                          title="Sort (shift-click to add a secondary sort)"
                        >
                          {flexRender(col.columnDef.header, header.getContext())}
                          {dir === "asc" ? (
                            <ArrowUp className="size-3" aria-hidden />
                          ) : dir === "desc" ? (
                            <ArrowDown className="size-3" aria-hidden />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-0 group-hover:opacity-100" aria-hidden />
                          )}
                          {multi && <span className="text-fg-faint tabular-nums">{col.getSortIndex() + 1}</span>}
                        </button>
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {query.isPending ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    {columns.map((c, j) => (
                      <TableCell key={j} className={COLUMN_CLASS[c.id ?? ""]}>
                        <Skeleton className={cn("h-3", j < 2 ? "w-3/4" : "w-2/3", COLUMN_CLASS[c.id ?? ""]?.includes("text-right") && "ml-auto")} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns.length}>
                    {filtered && data?.length ? (
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
                        title="No referrals yet"
                        hint="Upload a fax PDF to start a referral. It appears here once the pipeline picks it up."
                        action={<UploadButton variant="secondary" size="sm" />}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const r = row.original;
                  const selected = r.id === selectedId;
                  return (
                    <TableRow
                      key={row.id}
                      data-testid="queue-row"
                      data-id={r.id}
                      data-status={r.status}
                      data-state={selected ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey) window.open(`/referrals/${r.id}`, "_blank");
                        else open(r.id);
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className={cn("overflow-hidden", COLUMN_CLASS[cell.column.id])}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
