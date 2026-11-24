import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import type { ExtractionEval } from "@/contracts";
import { Code } from "@/components/Code";
import { fmtMs, fmtUsd, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DataTable } from "@/features/graph/DataTable";
import { pct } from "./parts";

type Row = { field: string; correct: number; total: number; accuracy: number };
const col = createColumnHelper<Row>();

const columns = [
  col.accessor("field", {
    header: "Field",
    cell: (c) => (
      <span className="flex items-baseline gap-2">
        <span>{humanize(c.getValue())}</span>
        <Code className="text-xs text-fg-faint">{c.getValue()}</Code>
      </span>
    ),
  }),
  col.accessor("correct", { header: "Correct", meta: { align: "right", className: "w-24" } }),
  col.accessor("total", { header: "Total", meta: { align: "right", className: "w-24" } }),
  col.accessor((r) => r.total - r.correct, { id: "wrong", header: "Wrong", meta: { align: "right", className: "w-24" } }),
  col.accessor("accuracy", {
    header: "Accuracy",
    meta: { align: "right", className: "w-28" },
    cell: (c) => <span className={cn(c.getValue() < 1 && "font-semibold")}>{pct(c.getValue())}</span>,
  }),
];

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** Per-field extraction accuracy from evals/extraction_eval.json, worst field first. */
export function FieldAccuracy({ data }: { data: ExtractionEval }) {
  const s = data.summary;
  const rows = useMemo<Row[]>(
    () =>
      Object.entries(s.per_field)
        .map(([field, v]) => ({ field, ...v }))
        .sort((a, b) => a.accuracy - b.accuracy || a.field.localeCompare(b.field)),
    [s.per_field],
  );
  return (
    <div className="space-y-3">
      <dl className="flex flex-wrap gap-x-10 gap-y-3">
        <Stat label="Overall accuracy">
          {pct(s.overall_accuracy)}{" "}
          <span className="font-normal text-fg-muted">
            {s.fields_correct}/{s.fields_total} fields
          </span>
        </Stat>
        <Stat label="Faxes">{s.n_files}</Stat>
        <Stat label="Engine · model">
          <Code>{s.engine}</Code>
          {s.model ? (
            <>
              {" · "}
              <Code>{s.model}</Code>
            </>
          ) : (
            <span className="font-normal text-fg-faint"> · model not recorded</span>
          )}
        </Stat>
        <Stat label="Cost">
          {fmtUsd(s.cost.total_dollars)} <span className="font-normal text-fg-muted">· {fmtUsd(s.cost.dollars_per_referral)} per referral</span>
        </Stat>
        <Stat label="Tokens">
          {s.cost.input_tokens.toLocaleString("en-US")} in / {s.cost.output_tokens.toLocaleString("en-US")} out
        </Stat>
        <Stat label="Latency p50 / p95">
          {fmtMs(s.latency_ms.p50)} / {fmtMs(s.latency_ms.p95)}
        </Stat>
      </dl>
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(r) => r.field}
        rowProps={(row) => ({ "data-field": row.original.field })}
        stickyHeader={false}
        className="max-w-3xl rounded-md border border-border"
      />
      {s.pricing_note && <p className="max-w-3xl text-xs text-fg-muted">{s.pricing_note}</p>}
    </div>
  );
}
