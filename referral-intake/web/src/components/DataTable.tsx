/**
 * DataTable: TanStack Table v8 rendered into the Table* primitives.
 *
 * - 40px rows on hairlines, sticky header, right-aligned tabular numbers (meta.numeric)
 * - hover: one highlight glides between rows (Linear), subtle surface (ONOERA)
 * - keyboard: j / k move a neutral selection, Enter opens (opt in with `keyboard`)
 * - quick action: one quiet button per row, shown on hover, focus or selection (Terminal)
 * - loading: skeleton rows, then rows resolve top to bottom once (Paradigm)
 * - empty / error states in place of the body, header kept
 * - long text: meta.truncate → one line, ellipsis, full text in the title
 */
import { useEffect, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type OnChangeFn,
  type Row,
  type RowData,
  type SortingState,
  type Table as TanTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useHotkeys } from "@/lib/hotkeys";
import { DURATION_MS, STAGGER, STAGGER_MAX_ITEMS } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ErrorState } from "./States";
import { TravelingHighlight, useTravelingHighlight } from "./TravelingHighlight";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "right";
    className?: string;
    headClassName?: string;
    /** Right-aligned, tabular numerals. */
    numeric?: boolean;
    /**
     * One line with an ellipsis; the full text goes in the title. Without a width in
     * `className` the column takes the remaining width; with one, cap it too ("w-72 max-w-72").
     */
    truncate?: boolean;
    /** Skeleton bar width while loading (Tailwind width class). */
    skeleton?: string;
  }
}

// ---------- building the table ----------

export type UseDataTableOptions<T> = {
  data: T[] | undefined;
  // TanStack's ColumnDef is invariant in its value type, so `any` is the honest type here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  getRowId: (row: T, index: number) => string;
  /** Controlled sorting; omit for internal state seeded by `initialSorting`. */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  initialSorting?: SortingState;
  sortable?: boolean;
  enableMultiSort?: boolean;
  columnFilters?: ColumnFiltersState;
  globalFilter?: string;
  meta?: object;
};

/** useReactTable with the sorted + filtered row models wired; pass the result to <DataTableView>. */
export function useDataTable<T>(o: UseDataTableOptions<T>): TanTable<T> {
  const [innerSorting, setInnerSorting] = useState<SortingState>(o.initialSorting ?? []);
  return useReactTable<T>({
    data: o.data ?? EMPTY,
    columns: o.columns,
    getRowId: o.getRowId,
    state: {
      sorting: o.sorting ?? innerSorting,
      ...(o.columnFilters ? { columnFilters: o.columnFilters } : {}),
      ...(o.globalFilter !== undefined ? { globalFilter: o.globalFilter } : {}),
    },
    onSortingChange: o.onSortingChange ?? setInnerSorting,
    enableSorting: o.sortable ?? true,
    enableMultiSort: o.enableMultiSort ?? false,
    enableSortingRemoval: false,
    isMultiSortEvent: (e) => !!(e as React.MouseEvent).shiftKey,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    meta: o.meta,
  });
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EMPTY: any[] = [];

// ---------- rendering ----------

type RowAttrs = React.HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, string | undefined>;

export type DataTableViewProps<T> = {
  table: TanTable<T>;
  testId?: string;
  /** data-testid on every body row (rows also get data-id = row id). */
  rowTestId?: string;
  rowProps?: (row: Row<T>) => RowAttrs;
  /** Accessible name for the table. */
  label?: string;

  loading?: boolean;
  loadingRows?: number;
  error?: unknown;
  onRetry?: () => void;
  /** "Couldn't load referrals". */
  errorTitle?: string;
  /** Shown in place of the body when there are no rows. */
  empty?: React.ReactNode;

  /** Selected row id (controlled); omit to let the table keep it. */
  selectedId?: string | null;
  onSelectedChange?: (id: string | null) => void;
  /** j / k / Enter on the whole page. One keyboard table per page. */
  keyboard?: boolean;
  /** Row click (not on a link or button inside it) and Enter on the selected row. */
  onOpen?: (row: T, e?: React.MouseEvent) => void;

  /** One quiet action per row, visible on hover, focus or selection. */
  quickAction?: (row: T) => React.ReactNode;

  /** Rows resolve top to bottom once after loading (default true). */
  reveal?: boolean;
  /** The traveling hover highlight (default true). */
  highlight?: boolean;
  stickyHeader?: boolean;
  className?: string;
};

export function DataTableView<T>({
  table,
  testId,
  rowTestId,
  rowProps,
  label,
  loading = false,
  loadingRows = 10,
  error,
  onRetry,
  errorTitle,
  empty,
  selectedId,
  onSelectedChange,
  keyboard = false,
  onOpen,
  quickAction,
  reveal = true,
  highlight = true,
  stickyHeader = true,
  className,
}: DataTableViewProps<T>) {
  const rows = table.getRowModel().rows;
  const leafColumns = table.getVisibleLeafColumns();
  const colCount = leafColumns.length + (quickAction ? 1 : 0);
  const hl = useTravelingHighlight<HTMLDivElement>();

  // selection: controlled or internal
  const [innerSelected, setInnerSelected] = useState<string | null>(null);
  const selected = selectedId !== undefined ? selectedId : innerSelected;
  const select = (id: string | null) => {
    if (selectedId === undefined) setInnerSelected(id);
    onSelectedChange?.(id);
    if (id) hl.container.ref.current?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const move = (delta: 1 | -1) => {
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.id === selected);
    const next = i === -1 ? (delta === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, i + delta));
    select(rows[next].id);
  };
  useHotkeys(
    {
      j: () => move(1),
      k: () => move(-1),
      Enter: () => {
        const r = rows.find((x) => x.id === selected);
        if (r) onOpen?.(r.original);
      },
    },
    { enabled: keyboard },
  );

  // progressive fill: only when rows arrive after a loading state, once per mount.
  // Rows keep the stagger class; <FillScope> switches the animation off once the fill
  // has played (rows that appear later show at once), without re-rendering a row.
  const wasLoading = useRef(loading);
  const [revealing, setRevealing] = useState(false);
  useEffect(() => {
    if (wasLoading.current && !loading && reveal) setRevealing(true);
    wasLoading.current = loading;
  }, [loading, reveal]);

  const headCell = (align?: "left" | "right", numeric?: boolean) => cn((align === "right" || numeric) && "text-right");

  let body: React.ReactNode;
  if (loading) {
    body = Array.from({ length: loadingRows }).map((_, i) => (
      <TableRow key={`s${i}`} className="animate-row-in hover:bg-transparent" style={{ "--i": i } as React.CSSProperties} aria-hidden>
        {leafColumns.map((c, j) => {
          const meta = c.columnDef.meta;
          return (
            <TableCell key={c.id} className={meta?.className}>
              <Skeleton className={cn("h-2.5", meta?.skeleton ?? (j === 0 ? "w-36" : "w-20"), (meta?.numeric || meta?.align === "right") && "ml-auto")} />
            </TableCell>
          );
        })}
        {quickAction && <TableCell />}
      </TableRow>
    ));
  } else if (error) {
    body = (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={colCount} className="border-b-0 p-0">
          <ErrorState error={error} onRetry={onRetry} title={errorTitle} />
        </TableCell>
      </TableRow>
    );
  } else if (rows.length === 0) {
    body = (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={colCount} className="border-b-0 p-0">
          {empty}
        </TableCell>
      </TableRow>
    );
  } else {
    body = rows.map((row, i) => {
      const isSel = row.id === selected;
      const extra = rowProps?.(row) ?? {};
      return (
        <TableRow
          key={row.id}
          data-testid={rowTestId}
          data-id={row.id}
          data-state={isSel ? "selected" : undefined}
          aria-selected={keyboard || onSelectedChange ? isSel : undefined}
          {...extra}
          {...(highlight ? hl.item : {})}
          className={cn(
            highlight && "hover:bg-transparent",
            onOpen && "cursor-pointer",
            revealing && "animate-row-in",
            extra.className,
          )}
          style={revealing ? ({ "--i": i, ...extra.style } as React.CSSProperties) : extra.style}
          onClick={(e) => {
            extra.onClick?.(e);
            if (e.defaultPrevented || !onOpen) return;
            if ((e.target as Element).closest("a, button, input, textarea, select, [role='button'], [role='checkbox']")) return;
            onOpen(row.original, e);
          }}
        >
          {row.getVisibleCells().map((cell) => {
            const meta = cell.column.columnDef.meta;
            const value = cell.getValue();
            const content = flexRender(cell.column.columnDef.cell, cell.getContext());
            return (
              <TableCell
                key={cell.id}
                className={cn(
                  (meta?.align === "right" || meta?.numeric) && "text-right",
                  meta?.numeric && "whitespace-nowrap tabular-nums",
                  // a truncating column without its own width takes the remaining width;
                  // one with a width should also cap it (e.g. "w-72 max-w-72")
                  meta?.truncate && !/(^|\s)w-/.test(meta.className ?? "") && "w-full max-w-0",
                  meta?.className,
                )}
              >
                {meta?.truncate ? (
                  <div className="truncate" title={typeof value === "string" || typeof value === "number" ? String(value) : undefined}>
                    {content}
                  </div>
                ) : (
                  content
                )}
              </TableCell>
            );
          })}
          {quickAction && (
            <TableCell className="w-px py-0 pl-2 text-right whitespace-nowrap">
              <div
                className={cn(
                  "inline-flex translate-x-1 items-center justify-end opacity-0 transition-[opacity,translate] duration-fast ease-enter motion-reduce:translate-x-0",
                  "group-hover/row:translate-x-0 group-hover/row:opacity-100 group-focus-within/row:translate-x-0 group-focus-within/row:opacity-100",
                  "group-data-[state=selected]/row:translate-x-0 group-data-[state=selected]/row:opacity-100",
                )}
              >
                {quickAction(row.original)}
              </div>
            </TableCell>
          )}
        </TableRow>
      );
    });
  }

  return (
    <FillScope active={revealing} innerRef={hl.container.ref} onPointerLeave={hl.container.onPointerLeave} className={cn("relative", className)}>
      {highlight && <TravelingHighlight state={hl.state} />}
      <Table data-testid={testId} aria-label={label} aria-busy={loading || undefined} className="relative">
        <TableHeader className={cn(!stickyHeader && "static")}>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="hover:bg-transparent">
              {hg.headers.map((h) => {
                const meta = h.column.columnDef.meta;
                const sorted = h.column.getIsSorted();
                const canSort = h.column.getCanSort();
                const right = meta?.align === "right" || meta?.numeric;
                const multi = table.getState().sorting.length > 1 && sorted;
                return (
                  <TableHead
                    key={h.id}
                    className={cn(headCell(meta?.align, meta?.numeric), meta?.headClassName)}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : canSort ? "none" : undefined}
                  >
                    {h.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className={cn(
                          "group/sort inline-flex h-6 cursor-pointer items-center gap-1 rounded-sm transition-colors duration-fast hover:text-fg",
                          sorted && "text-fg",
                          right && "flex-row-reverse",
                        )}
                        title="Sort (shift-click to add a secondary sort)"
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3 opacity-0 transition-opacity duration-fast group-hover/sort:opacity-40" aria-hidden />
                        )}
                        {multi && <span className="text-fg-faint tabular-nums">{h.column.getSortIndex() + 1}</span>}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </TableHead>
                );
              })}
              {quickAction && (
                <TableHead className="w-px">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>{body}</TableBody>
      </Table>
    </FillScope>
  );
}

/** The capped stagger plus one row's fade: how long the progressive fill can take. */
const FILL_WINDOW_MS = STAGGER_MAX_ITEMS * STAGGER.row * 1000 + DURATION_MS.state + DURATION_MS.fast;

/**
 * Turns the rows' fill animation off once it has played. Only this wrapper re-renders
 * when the window closes: the table arrives as `children` (the same element), so no
 * row re-renders (a re-render of every row read as a long task right after a load).
 */
function FillScope({
  active,
  innerRef,
  className,
  onPointerLeave,
  children,
}: {
  active: boolean;
  innerRef: React.Ref<HTMLDivElement>;
  className?: string;
  onPointerLeave?: React.PointerEventHandler<HTMLDivElement>;
  children: React.ReactNode;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!active || done) return;
    const t = window.setTimeout(() => setDone(true), FILL_WINDOW_MS);
    return () => window.clearTimeout(t);
  }, [active, done]);
  return (
    <div ref={innerRef} onPointerLeave={onPointerLeave} className={cn(done && "[&_tbody_tr]:animate-none", className)}>
      {children}
    </div>
  );
}

export type DataTableProps<T> = UseDataTableOptions<T> & Omit<DataTableViewProps<T>, "table">;

/** The common case: build the table from data + columns and render it. */
export function DataTable<T>(props: DataTableProps<T>) {
  const { data, columns, getRowId, sorting, onSortingChange, initialSorting, sortable, enableMultiSort, columnFilters, globalFilter, meta, ...view } = props;
  const table = useDataTable({ data, columns, getRowId, sorting, onSortingChange, initialSorting, sortable, enableMultiSort, columnFilters, globalFilter, meta });
  return <DataTableView table={table} {...view} />;
}
