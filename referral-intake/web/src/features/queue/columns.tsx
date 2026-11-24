import type { ColumnDef, FilterFn, SortingFn, SortingState } from "@tanstack/react-table";
import { CircleX, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReferralStatus, ReferralSummary } from "@/contracts";
import { Code } from "@/components/Code";
import { Confidence } from "@/components/Confidence";
import { AckBadge, StatusBadge } from "@/components/StatusBadge";
import { Tip } from "@/components/ui/tooltip";
import { fmtAge, fmtDateTime } from "@/lib/format";
import { STATUS_ORDER } from "@/lib/status";

/** Table meta: the clock used for relative ages, so the column re-renders as time passes. */
export type QueueTableMeta = { now: number };

const statusRank = (s: ReferralStatus) => {
  const i = STATUS_ORDER.indexOf(s);
  return i === -1 ? STATUS_ORDER.length : i;
};

const byStatus: SortingFn<ReferralSummary> = (a, b) => statusRank(a.original.status) - statusRank(b.original.status);

/** Exact match; the sentinel NO_PAYOR matches rows with no payor. */
export const NO_PAYOR = "__none__";
const exact: FilterFn<ReferralSummary> = (row, id, value) =>
  value === NO_PAYOR ? row.getValue(id) === undefined : row.getValue(id) === value;

/** Work first: the status order from lib/status, then the least confident extraction. */
export const DEFAULT_SORT: SortingState = [
  { id: "status", desc: false },
  { id: "confidence", desc: false },
];

const Dash = () => <span className="text-fg-faint">-</span>;

/** Per-column cell/header classes (alignment and widths), keyed by column id. */
export const COLUMN_CLASS: Record<string, string> = {
  patient: "",
  cpt: "",
  payor: "w-40",
  confidence: "w-28 text-right",
  status: "w-36",
  flags: "w-20",
  ack: "w-16",
  age: "w-20 text-right",
};

export const columns: ColumnDef<ReferralSummary>[] = [
  {
    id: "patient",
    header: "Patient",
    accessorFn: (r) => r.patient_name ?? undefined,
    sortUndefined: "last",
    cell: ({ row }) => {
      const r = row.original;
      return (
        <div className="flex min-w-0 items-baseline gap-2">
          <Link
            to={`/referrals/${r.id}`}
            onClick={(e) => e.stopPropagation()}
            className="truncate font-medium text-fg hover:underline"
          >
            {r.patient_name ?? <span className="font-normal text-fg-faint">Unknown patient</span>}
          </Link>
          {r.patient_dob && <span className="shrink-0 text-xs text-fg-faint tabular-nums">{r.patient_dob}</span>}
        </div>
      );
    },
  },
  {
    id: "cpt",
    header: "CPT",
    accessorFn: (r) => r.cpt_code ?? undefined,
    sortUndefined: "last",
    cell: ({ row }) => {
      const r = row.original;
      if (!r.cpt_code) return <Dash />;
      return (
        <div className="flex min-w-0 items-baseline gap-2">
          <Code className="shrink-0">{r.cpt_code}</Code>
          {r.requested_study && <span className="truncate text-fg-muted">{r.requested_study}</span>}
        </div>
      );
    },
  },
  {
    id: "payor",
    header: "Payor",
    accessorFn: (r) => r.payor_name ?? undefined,
    sortUndefined: "last",
    filterFn: exact,
    cell: ({ row }) => (row.original.payor_name ? <span className="block truncate">{row.original.payor_name}</span> : <Dash />),
  },
  {
    id: "confidence",
    header: "Confidence",
    accessorFn: (r) => r.min_confidence ?? undefined,
    sortUndefined: "last",
    cell: ({ row }) =>
      row.original.min_confidence == null ? <Dash /> : <Confidence value={row.original.min_confidence} />,
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (r) => r.status,
    sortingFn: byStatus,
    filterFn: exact,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: "flags",
    header: "Flags",
    accessorFn: (r) => r.error_count * 1000 + r.warning_count,
    sortDescFirst: true,
    cell: ({ row }) => {
      const { error_count: e, warning_count: w } = row.original;
      if (!e && !w) return <Dash />;
      const label = [e && `${e} error${e === 1 ? "" : "s"}`, w && `${w} warning${w === 1 ? "" : "s"}`].filter(Boolean).join(", ");
      return (
        <Tip content={label}>
          <span className="inline-flex items-center gap-2 tabular-nums" aria-label={label}>
            {e > 0 && (
              <span className="inline-flex items-center gap-0.5 text-bad">
                <CircleX className="size-3.5" aria-hidden />
                {e}
              </span>
            )}
            {w > 0 && (
              <span className="inline-flex items-center gap-0.5 text-warn">
                <TriangleAlert className="size-3.5" aria-hidden />
                {w}
              </span>
            )}
          </span>
        </Tip>
      );
    },
  },
  {
    id: "ack",
    header: "ACK",
    accessorFn: (r) => r.ack_code ?? undefined,
    sortUndefined: "last",
    cell: ({ row }) => (row.original.ack_code ? <AckBadge code={row.original.ack_code} /> : <Dash />),
  },
  {
    id: "age",
    header: "Age",
    // Ascending age = newest first.
    accessorFn: (r) => -Date.parse(r.created_at),
    cell: ({ row, table }) => {
      const now = (table.options.meta as QueueTableMeta | undefined)?.now ?? Date.now();
      return (
        <Tip content={`Received ${fmtDateTime(row.original.created_at)}`}>
          <span className="text-fg-muted tabular-nums">{fmtAge(row.original.created_at, now)}</span>
        </Tip>
      );
    },
  },
];
