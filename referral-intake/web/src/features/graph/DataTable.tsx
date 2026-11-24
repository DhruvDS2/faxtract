/**
 * TanStack Table v8 rendered into the shared Table* primitives. Used by the
 * graph timeline, the evals tables and the RIS orders table (Lane E).
 */
import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "right";
    className?: string;
    headClassName?: string;
  }
}

export type DataTableProps<T> = {
  data: T[];
  // eslint-style `any`: TanStack's ColumnDef is invariant in its value type.
  columns: ColumnDef<T, any>[];
  testId?: string;
  getRowId?: (row: T, index: number) => string;
  rowProps?: (row: Row<T>) => React.HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, string | undefined>;
  initialSorting?: SortingState;
  sortable?: boolean;
  className?: string;
  /** Shown in place of the body when there are no rows. */
  empty?: React.ReactNode;
  stickyHeader?: boolean;
};

export function DataTable<T>({
  data,
  columns,
  testId,
  getRowId,
  rowProps,
  initialSorting = [],
  sortable = false,
  className,
  empty,
  stickyHeader = true,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { sorting },
    onSortingChange: setSorting,
    enableSorting: sortable,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const rows = table.getRowModel().rows;

  return (
    <div className={className}>
      <Table data-testid={testId}>
        <TableHeader className={cn(!stickyHeader && "static")}>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="hover:bg-transparent">
              {hg.headers.map((h) => {
                const meta = h.column.columnDef.meta;
                const sorted = h.column.getIsSorted();
                const canSort = h.column.getCanSort();
                return (
                  <TableHead
                    key={h.id}
                    className={cn(meta?.align === "right" && "text-right", meta?.headClassName)}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                  >
                    {h.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm hover:text-fg",
                          meta?.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3" />
                        ) : null}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} {...rowProps?.(row)}>
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta;
                return (
                  <TableCell
                    key={cell.id}
                    className={cn(meta?.align === "right" && "text-right tabular-nums", meta?.className)}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 && empty}
    </div>
  );
}
