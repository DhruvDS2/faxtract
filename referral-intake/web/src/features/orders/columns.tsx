import { useRef } from "react";
import { Link } from "react-router-dom";
import { createColumnHelper } from "@tanstack/react-table";
import type { ReferralSummary, RisOrderRow } from "@/contracts";
import { Code } from "@/components/Code";
import { Morph } from "@/components/Morph";
import { StatusPill } from "@/components/StatusPill";
import { Tip } from "@/components/ui/tooltip";
import { fmtAge, fmtDateTime } from "@/lib/format";
import { fade, m, referralLayoutId } from "@/lib/motion";
import { orderState, type OrderKind } from "./orderState";

/** An order row; `sortAt` holds a retried row in its place while the page is open. */
export type OrderRow = RisOrderRow & { sortAt?: string | null };

/** Table meta: the clock, the retries in flight, and the queue rows (for DOB and study). */
export type OrdersTableMeta = {
  now: number;
  sending: Record<string, true>;
  referrals: Map<string, ReferralSummary>;
};
const metaOf = (t: { options: { meta?: unknown } }) => t.options.meta as OrdersTableMeta;

const Dash = () => <span className="text-fg-faint">-</span>;

/**
 * One status column with the ACK folded in, the RIS's error muted beneath it.
 * A change on screen (a retry's answer) fades in over 200 ms; first paint is still.
 */
function StatusCell({ row, sending }: { row: RisOrderRow; sending: boolean }) {
  const s = orderState(row, sending);
  const detail = s.kind === "rejected" || s.kind === "no_ack" ? row.last_error : null;
  const key = `${s.label}|${detail ?? ""}`;
  const first = useRef(key);
  return (
    <m.div key={key} className="flex min-w-0 flex-col" variants={fade} initial={key === first.current ? false : "initial"} animate="animate">
      <StatusPill tone={s.tone} running={s.running} data-kind={s.kind}>
        {s.label}
      </StatusPill>
      {detail && (
        // aligned with the label, after the 6 px dot and its gap
        <span className="truncate pl-3.5 font-mono text-meta text-fg-faint" title={detail}>
          {detail}
        </span>
      )}
    </m.div>
  );
}

/** Sorting by status puts what needs a retry first. */
const STATUS_RANK: Record<OrderKind, number> = { no_ack: 0, rejected: 1, sending: 2, sent: 3, acknowledged: 4 };

const col = createColumnHelper<OrderRow>();

export const columns = [
  col.accessor("order_id", {
    header: "Order",
    meta: { className: "w-32", headClassName: "w-32", skeleton: "w-24" },
    cell: (c) => (c.getValue() ? <Code className="text-fg-muted">{c.getValue()}</Code> : <Dash />),
  }),
  col.accessor("patient_name", {
    header: "Patient",
    sortUndefined: "last",
    meta: { truncate: true, className: "w-56", headClassName: "w-56", skeleton: "w-36" },
    cell: (c) => {
      const r = c.row.original;
      const { referrals } = metaOf(c.table);
      const dob = referrals.get(r.referral_id)?.patient_dob;
      return (
        <span className="flex min-w-0 items-baseline gap-2">
          <Morph as="span" layoutId={referralLayoutId(r.referral_id)} className="min-w-0 truncate font-medium text-fg">
            <Link to={`/referrals/${r.referral_id}`} className="hover:underline">
              {r.patient_name ?? <span className="font-normal text-fg-faint">Unknown patient</span>}
            </Link>
          </Morph>
          {dob && <span className="shrink-0 text-meta text-fg-faint tabular-nums">{dob}</span>}
        </span>
      );
    },
  }),
  col.accessor("cpt_code", {
    header: "Study",
    sortUndefined: "last",
    meta: { skeleton: "w-40" },
    cell: (c) => {
      const r = c.row.original;
      const study = metaOf(c.table).referrals.get(r.referral_id)?.requested_study;
      if (!r.cpt_code && !study) return <Dash />;
      return (
        <span className="flex min-w-0 items-baseline gap-2" title={[r.cpt_code, study].filter(Boolean).join(" · ")}>
          {r.cpt_code ? <Code className="shrink-0 text-fg">{r.cpt_code}</Code> : <Dash />}
          {study && <span className="truncate text-fg-muted">{study}</span>}
        </span>
      );
    },
  }),
  col.accessor((r) => STATUS_RANK[orderState(r).kind], {
    id: "status",
    header: "Status",
    meta: { className: "w-72 py-0.5", headClassName: "w-72", skeleton: "w-32" },
    cell: (c) => <StatusCell row={c.row.original} sending={!!metaOf(c.table).sending[c.row.original.referral_id]} />,
  }),
  col.accessor("attempts", {
    header: "Attempts",
    meta: { numeric: true, className: "w-20", headClassName: "w-20", skeleton: "w-6" },
  }),
  col.accessor((r) => r.sortAt ?? r.sent_at ?? "", {
    id: "last_attempt",
    header: "Last attempt",
    sortingFn: "alphanumeric",
    meta: { numeric: true, className: "w-28", headClassName: "w-28", skeleton: "w-12" },
    cell: (c) => {
      const at = c.row.original.sent_at;
      if (!at) return <Dash />;
      return (
        <Tip content={`Last sent ${fmtDateTime(at)}`}>
          <span className="text-fg-muted">{fmtAge(at, metaOf(c.table).now)}</span>
        </Tip>
      );
    },
  }),
];
