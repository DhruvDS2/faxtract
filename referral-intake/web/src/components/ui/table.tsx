import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Table primitives: 40px rows on hairlines, a sticky header, tabular numbers.
 * Borders sit on cells (border-separate) so the sticky header keeps its rule.
 * A selected row is a neutral fill; there is no coloured left bar.
 */
export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table ref={ref} className={cn("w-full caption-bottom border-separate border-spacing-0 text-body", className)} {...props} />
  ),
);
Table.displayName = "Table";

export const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn("sticky top-0 z-10 bg-bg", className)} {...props} />,
);
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={cn("[&>tr:last-child>td]:border-b-0", className)} {...props} />,
);
TableBody.displayName = "TableBody";

export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "group/row h-10 transition-colors duration-fast ease-enter hover:bg-surface",
        "data-[state=selected]:bg-selected aria-selected:bg-selected",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "h-10 border-b border-border px-3 text-left align-middle text-meta font-medium whitespace-nowrap text-fg-muted",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => <td ref={ref} className={cn("border-b border-border px-3 py-1 align-middle", className)} {...props} />,
);
TableCell.displayName = "TableCell";
