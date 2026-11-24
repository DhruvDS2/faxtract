import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef, SortingFn, SortingState } from "@tanstack/react-table";
import type { ReferralStatus, ReferralSummary } from "@/contracts";
import { Code } from "@/components/Code";
import { Morph } from "@/components/Morph";
import { ReferralStatusPill } from "@/components/StatusBadge";
import { Tip } from "@/components/ui/tooltip";
import { fmtAge, fmtConfidence, fmtDateTime } from "@/lib/format";
import { referralLayoutId } from "@/lib/motion";
import { STATUS_ORDER, confidenceTone, statusText } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * A queue row. `sortStatus` holds a row in its place while an action on it settles
 * (a retry that turns "RIS error" into "Sent" changes the row, it doesn't move it).
 */
export type QueueRow = ReferralSummary & { sortStatus?: ReferralStatus };

/** Table meta: the clock for relative ages, what a row click does, the keyboard selection, and the server's confidence threshold. */
export type QueueTableMeta = { now: number; onOpen: (id: string) => void; selectedId: string | null; threshold: number | undefined };

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

/**
 * A status that changed while on screen fades to its new text (200 ms, CSS: no
 * motion component per row); first paint is still.
 */
function StatusCell({ row }: { row: QueueRow }) {
  const label = statusText(row.status, row.ack_code).label;
  const first = useRef(label);
  return (
    <span key={label} className={cn("flex min-w-0", label !== first.current && "animate-fade-in")}>
      <ReferralStatusPill status={row.status} ack={row.ack_code} />
    </span>
  );
}

/**
 * True once the cell's row has been pointed at or focused (or `armed`). Per-row
 * extras that only matter under the pointer (the shared element, the tooltip) mount
 * then, not for every row at once: mounting them on all rows made the queue's mount
 * a long task inside the route crossfade.
 */
function useRowTouched(ref: React.RefObject<HTMLElement | null>, armed = false) {
  const [touched, setTouched] = useState(false);
  const live = armed || touched;
  useEffect(() => {
    if (live) return;
    const tr = ref.current?.closest("tr");
    if (!tr) return;
    const arm = () => setTouched(true);
    tr.addEventListener("pointerenter", arm);
    tr.addEventListener("focusin", arm);
    return () => {
      tr.removeEventListener("pointerenter", arm);
      tr.removeEventListener("focusin", arm);
    };
  }, [live, ref]);
  return live;
}

/**
 * The patient name, and the ONTO shared element: it grows into the referral header
 * (Lane B wraps the target). A row carries the <Morph> once it can be opened by hand:
 * pointer over it, focus in it, or keyboard-selected. The link stays mounted, so
 * focus never moves.
 */
function PatientName({ row, armed }: { row: QueueRow; armed: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const live = useRowTouched(ref, armed);
  const name = row.patient_name ?? <span className="font-normal text-fg-faint">Unknown patient</span>;
  const cls = "min-w-0 truncate group-hover/name:underline";
  return live ? (
    <Morph ref={ref} as="span" layoutId={referralLayoutId(row.id)} className={cls}>
      {name}
    </Morph>
  ) : (
    <span ref={ref} className={cls}>
      {name}
    </span>
  );
}

/**
 * Confidence as a plain number: faint at or above the server's threshold, amber below
 * it, red below 0.5. Renders what <ConfidenceMeter quiet> does, with the threshold read
 * once by the page: ConfidenceMeter runs its own /health query per row (one observer
 * and one refetch timer per row), which weighed on the queue's mount.
 */
function Confidence({ value, threshold }: { value: number; threshold: number | undefined }) {
  const tone = threshold == null ? "idle" : confidenceTone(value, threshold);
  const low = tone === "warn" || tone === "bad";
  const label = `Confidence ${fmtConfidence(value)}${threshold == null ? "" : low ? `, below the ${threshold} threshold` : `, at or above the ${threshold} threshold`}`;
  return (
    <span className={cn("tabular-nums", tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-fg-faint")} title={label} aria-label={label} data-tone={tone}>
      {fmtConfidence(value)}
    </span>
  );
}

/** Relative age; the absolute time is in a tooltip, mounted once the row is pointed at. */
function Received({ at, now }: { at: string; now: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const live = useRowTouched(ref);
  const age = (
    <span ref={ref} className="text-fg-muted">
      {fmtAge(at, now)}
    </span>
  );
  return live ? <Tip content={`Received ${fmtDateTime(at)}`}>{age}</Tip> : age;
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
      const { onOpen, selectedId } = table.options.meta as QueueTableMeta;
      return (
        <span className="flex min-w-0 items-baseline gap-2">
          <Link to={`/referrals/${r.id}`} onClick={() => onOpen(r.id)} className="group/name flex min-w-0 font-medium text-fg">
            <PatientName row={r} armed={selectedId === r.id} />
          </Link>
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
    cell: ({ row, table }) =>
      row.original.min_confidence == null ? <Dash /> : <Confidence value={row.original.min_confidence} threshold={(table.options.meta as QueueTableMeta).threshold} />,
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
    cell: ({ row, table }) => <Received at={row.original.created_at} now={(table.options.meta as QueueTableMeta).now} />,
  },
];
