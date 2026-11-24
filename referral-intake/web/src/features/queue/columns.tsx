import { useRef } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef, SortingFn, SortingState } from "@tanstack/react-table";
import type { ReferralStatus, ReferralSummary } from "@/contracts";
import { Code } from "@/components/Code";
import { ConfidenceMeter } from "@/components/Confidence";
import { Morph } from "@/components/Morph";
import { ReferralStatusPill } from "@/components/StatusBadge";
import { Tip } from "@/components/ui/tooltip";
import { fmtAge, fmtDateTime } from "@/lib/format";
import { fade, m, referralLayoutId } from "@/lib/motion";
import { STATUS_ORDER, statusText } from "@/lib/status";

/**
 * A queue row. `sortStatus` holds a row in its place while an action on it settles
 * (a retry that turns "RIS error" into "Sent" changes the row, it doesn't move it).
 */
export type QueueRow = ReferralSummary & { sortStatus?: ReferralStatus };

/** Table meta: the clock for relative ages, and what a row click does. */
export type QueueTableMeta = { now: number; onOpen: (id: string) => void };

const statusRank = (s: ReferralStatus) => {
  const i = STATUS_ORDER.indexOf(s);
  return i === -1 ? STATUS_ORDER.length : i;
};
const rowStatus = (r: QueueRow) => r.sortStatus ?? r.status;
/** Work order: the status order from lib/status, then the least confident extraction first. */
const byWork: SortingFn<QueueRow> = (a, b) =>
  statusRank(rowStatus(a.original)) - statusRank(rowStatus(b.original)) ||
  (a.original.min_confidence ?? Infinity) - (b.original.min_confidence ?? Infinity);

/** The default order is one sort (status, with confidence as the tie-break), so the header shows one arrow. */
export const DEFAULT_SORT: SortingState = [{ id: "status", desc: false }];

/** The payor filter value for referrals with no payor read. */
export const NO_PAYOR = "__none__";

const Dash = () => <span className="text-fg-faint">-</span>;

/** A status that changed while on screen fades to its new text (200 ms); first paint is still. */
function StatusCell({ row }: { row: QueueRow }) {
  const label = statusText(row.status, row.ack_code).label;
  const first = useRef(label);
  return (
    <m.span key={label} className="flex min-w-0" variants={fade} initial={label === first.current ? false : "initial"} animate="animate">
      <ReferralStatusPill status={row.status} ack={row.ack_code} />
    </m.span>
  );
}

export const columns: ColumnDef<QueueRow>[] = [
  {
    id: "patient",
    header: "Patient",
    accessorFn: (r) => r.patient_name ?? undefined,
    sortUndefined: "last",
    meta: { truncate: true, className: "w-60", headClassName: "w-60", skeleton: "w-40" },
    cell: ({ row, table }) => {
      const r = row.original;
      const open = (table.options.meta as QueueTableMeta).onOpen;
      return (
        <span className="flex min-w-0 items-baseline gap-2">
          {/* ONTO: the name grows into the referral header (Lane B wraps the target) */}
          <Morph as="span" layoutId={referralLayoutId(r.id)} className="min-w-0 truncate font-medium text-fg">
            <Link to={`/referrals/${r.id}`} onClick={() => open(r.id)} className="hover:underline">
              {r.patient_name ?? <span className="font-normal text-fg-faint">Unknown patient</span>}
            </Link>
          </Morph>
          {r.patient_dob && <span className="shrink-0 text-meta text-fg-faint tabular-nums">{r.patient_dob}</span>}
        </span>
      );
    },
  },
  {
    id: "study",
    header: "Study",
    accessorFn: (r) => r.cpt_code ?? undefined,
    sortUndefined: "last",
    meta: { skeleton: "w-48" },
    cell: ({ row }) => {
      const r = row.original;
      if (!r.cpt_code && !r.requested_study) return <Dash />;
      const title = [r.cpt_code, r.requested_study].filter(Boolean).join(" · ");
      return (
        <span className="flex min-w-0 items-baseline gap-2" title={title}>
          {r.cpt_code ? <Code className="shrink-0 text-fg">{r.cpt_code}</Code> : <Dash />}
          {r.requested_study && <span className="truncate text-fg-muted">{r.requested_study}</span>}
        </span>
      );
    },
  },
  {
    id: "payor",
    header: "Payor",
    accessorFn: (r) => r.payor_name ?? undefined,
    sortUndefined: "last",
    meta: { truncate: true, className: "w-40", headClassName: "w-40", skeleton: "w-24" },
    cell: ({ row }) => row.original.payor_name ?? <Dash />,
  },
  {
    id: "confidence",
    header: "Confidence",
    accessorFn: (r) => r.min_confidence ?? undefined,
    sortUndefined: "last",
    meta: { numeric: true, className: "w-24", headClassName: "w-24", skeleton: "w-8" },
    // a plain number: faint at or above the server's threshold, toned below it
    cell: ({ row }) => (row.original.min_confidence == null ? <Dash /> : <ConfidenceMeter value={row.original.min_confidence} quiet />),
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (r) => rowStatus(r),
    sortingFn: byWork,
    meta: { className: "w-44", headClassName: "w-44", skeleton: "w-24" },
    // the ACK is folded in ("Sent to RIS · AA", "RIS rejected · AE"): no Flags or ACK columns
    cell: ({ row }) => <StatusCell row={row.original} />,
  },
  {
    id: "received",
    header: "Received",
    // ascending = newest first
    accessorFn: (r) => -Date.parse(r.created_at),
    meta: { numeric: true, className: "w-20", headClassName: "w-20", skeleton: "w-12" },
    cell: ({ row, table }) => {
      const now = (table.options.meta as QueueTableMeta).now;
      return (
        <Tip content={`Received ${fmtDateTime(row.original.created_at)}`}>
          <span className="text-fg-muted">{fmtAge(row.original.created_at, now)}</span>
        </Tip>
      );
    },
  },
];
