import { useMemo } from "react";
import { Link } from "react-router-dom";
import { createColumnHelper } from "@tanstack/react-table";
import { ArrowUpRight } from "lucide-react";
import type { FalseApprovalCase } from "@/contracts";
import { useReferrals } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Code } from "@/components/Code";
import { Confidence } from "@/components/Confidence";
import { EmptyState } from "@/components/States";
import { DataTable } from "@/features/graph/DataTable";

type Row = FalseApprovalCase & { referralId: string | null };
const col = createColumnHelper<Row>();

const show = (v: unknown) => (v === null || v === undefined ? "null" : typeof v === "string" ? v : JSON.stringify(v));

const columns = [
  col.accessor("file", {
    header: "File",
    meta: { className: "w-px whitespace-nowrap align-top py-2" },
    cell: (c) => (
      <div className="space-y-0.5">
        <Code>{c.getValue()}</Code>
        {c.row.original.referralId && (
          <Link
            to={`/referrals/${c.row.original.referralId}`}
            className="flex items-center gap-0.5 text-xs text-accent hover:underline"
          >
            Open referral <ArrowUpRight className="size-3" />
          </Link>
        )}
      </div>
    ),
  }),
  col.accessor("field", {
    header: "Field",
    meta: { className: "w-px whitespace-nowrap align-top py-2" },
    cell: (c) => <Code>{c.getValue()}</Code>,
  }),
  col.accessor("predicted", {
    header: "Predicted",
    meta: { className: "w-px align-top py-2" },
    cell: (c) => <Code className="rounded-sm bg-surface-2 px-1">{show(c.getValue())}</Code>,
  }),
  col.accessor("truth", {
    header: "Truth",
    meta: { className: "w-px align-top py-2" },
    cell: (c) => <Code className="rounded-sm bg-surface-2 px-1">{show(c.getValue())}</Code>,
  }),
  col.accessor("confidence", {
    header: "Confidence",
    meta: { className: "w-px whitespace-nowrap align-top py-2" },
    cell: (c) => <Confidence value={c.getValue()} />,
  }),
  col.accessor("pipelines", {
    header: "Pipelines",
    meta: { className: "w-px whitespace-nowrap align-top py-2" },
    cell: (c) => (
      <span className="flex gap-1">
        {c.getValue().map((p) => (
          <Badge key={p} tone="outline" className="font-mono">
            {p}
          </Badge>
        ))}
      </span>
    ),
  }),
  col.accessor("explanation", {
    header: "Why it slipped through",
    meta: { className: "min-w-80 align-top py-2 text-fg-muted" },
  }),
];

/** Each auto-approval that had a critical field wrong, with the benchmark's explanation. */
export function FalseApprovals({ cases }: { cases: FalseApprovalCase[] }) {
  const referrals = useReferrals();
  const rows = useMemo<Row[]>(() => {
    const byFile = new Map((referrals.data ?? []).map((r) => [r.source_name, r.id]));
    return cases.map((c) => ({ ...c, referralId: byFile.get(c.file) ?? null }));
  }, [cases, referrals.data]);
  if (!cases.length) return <EmptyState title="No false approvals in this run" hint="Nothing was auto-approved with a critical field wrong." />;
  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r, i) => `${r.file}-${r.field}-${i}`}
      rowProps={(row) => ({ "data-file": row.original.file })}
      stickyHeader={false}
      className="rounded-md border border-border"
    />
  );
}
