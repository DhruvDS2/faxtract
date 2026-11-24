import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import type { BenchmarkReport, Count, PipelineBenchmark, Percentiles } from "@/contracts";
import { Code } from "@/components/Code";
import { KeyValue } from "@/components/PageHeader";
import { fmtDateTime, fmtMs, fmtPct, fmtUsd, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DataTable } from "@/features/graph/DataTable";
import { Value } from "./parts";

type Better = "higher" | "lower" | null;
type Metric = {
  id: string;
  label: string;
  hint?: string;
  /** Comparable number per pipeline (null = not reported). */
  value: (p: PipelineBenchmark) => number | null;
  show: (p: PipelineBenchmark) => React.ReactNode;
  better: Better;
};

const rate = (c: Count) => (c.n ? c.hits / c.n : null);
const showCount = (c: Count) => (
  <>
    {c.hits}/{c.n} <span className="text-fg-muted">· {fmtPct(c.hits, c.n)}</span>
  </>
);
const pctl = (p: Percentiles | null, k: "p50" | "p95") => (p ? p[k] : null);

// The rows are definitions over the API's PipelineBenchmark; every number comes from the artifact.
const METRICS: Metric[] = [
  {
    id: "retriever",
    label: "Retriever",
    hint: "policy retrieval implementation",
    value: () => null,
    show: (p) => <Code className="whitespace-normal">{p.retriever}</Code>,
    better: null,
  },
  {
    id: "hit_cpt",
    label: "Retrieval Hit@1, with CPT",
    hint: "top policy chunk is the payor + CPT policy",
    value: (p) => rate(p.retrieval_hit_at_1_with_cpt),
    show: (p) => showCount(p.retrieval_hit_at_1_with_cpt),
    better: "higher",
  },
  {
    id: "hit_nocpt",
    label: "Retrieval Hit@1, without CPT",
    hint: "same, with the CPT code removed from the query",
    value: (p) => rate(p.retrieval_hit_at_1_without_cpt),
    show: (p) => showCount(p.retrieval_hit_at_1_without_cpt),
    better: "higher",
  },
  {
    id: "auto",
    label: "Auto-approved",
    hint: "passed the gate with no human",
    value: (p) => p.auto_approved,
    show: (p) => (
      <>
        {p.auto_approved}
        {p.latency_ms.n ? <span className="text-fg-muted"> of {p.latency_ms.n}</span> : null}
      </>
    ),
    better: "higher",
  },
  {
    id: "false",
    label: "False approvals",
    hint: "auto-approved with a critical field wrong",
    value: (p) => p.false_approvals,
    show: (p) => p.false_approvals,
    better: "lower",
  },
  {
    id: "lat50",
    label: "Latency p50",
    hint: "end to end, no human time",
    value: (p) => p.latency_ms.p50,
    show: (p) => fmtMs(p.latency_ms.p50),
    better: "lower",
  },
  { id: "lat95", label: "Latency p95", value: (p) => p.latency_ms.p95, show: (p) => fmtMs(p.latency_ms.p95), better: "lower" },
  {
    id: "ext50",
    label: "Extraction latency p50",
    hint: "recorded in the extraction artifact",
    value: (p) => pctl(p.extraction_latency_ms, "p50"),
    show: (p) => fmtMs(pctl(p.extraction_latency_ms, "p50")),
    better: "lower",
  },
  {
    id: "ext95",
    label: "Extraction latency p95",
    value: (p) => pctl(p.extraction_latency_ms, "p95"),
    show: (p) => fmtMs(pctl(p.extraction_latency_ms, "p95")),
    better: "lower",
  },
  {
    id: "cost",
    label: "Cost per referral",
    hint: "recorded tokens × price",
    value: (p) => p.cost_per_referral_usd,
    show: (p) => fmtUsd(p.cost_per_referral_usd),
    better: "lower",
  },
];

type Row = { metric: Metric; v1: PipelineBenchmark; v2: PipelineBenchmark };
const col = createColumnHelper<Row>();

/** Which side wins a row, if either: decided from the numbers, shown with weight only. */
function winner(m: Metric, a: PipelineBenchmark, b: PipelineBenchmark): "v1" | "v2" | null {
  const x = m.value(a);
  const y = m.value(b);
  if (m.better === null || x == null || y == null || x === y) return null;
  return (m.better === "higher" ? x > y : x < y) ? "v1" : "v2";
}

function Cell({ row, side }: { row: Row; side: "v1" | "v2" }) {
  const best = winner(row.metric, row.v1, row.v2) === side;
  return (
    <span className={cn("tabular-nums", best && "font-semibold")} data-better={best || undefined}>
      {row.metric.show(row[side])}
    </span>
  );
}

export function BenchmarkTable({ report }: { report: BenchmarkReport }) {
  const rows = useMemo(() => METRICS.map((metric) => ({ metric, v1: report.v1, v2: report.v2 })), [report]);
  const columns = useMemo(
    () => [
      col.display({
        id: "metric",
        header: "Metric",
        cell: ({ row }) => (
          <div className="py-0.5">
            <div>{row.original.metric.label}</div>
            {row.original.metric.hint && <div className="text-xs text-fg-muted">{row.original.metric.hint}</div>}
          </div>
        ),
      }),
      col.display({
        id: "v1",
        header: () => <span>v1 baseline</span>,
        meta: { align: "right", className: "w-56", headClassName: "w-56" },
        cell: ({ row }) => <Cell row={row.original} side="v1" />,
      }),
      col.display({
        id: "v2",
        header: () => <span>v2 graph</span>,
        meta: { align: "right", className: "w-56", headClassName: "w-56" },
        cell: ({ row }) => <Cell row={row.original} side="v2" />,
      }),
    ],
    [],
  );
  return (
    <div>
      <DataTable data={rows} columns={columns} getRowId={(r) => r.metric.id} stickyHeader={false} className="rounded-md border border-border" />
      <div className="mt-1.5 text-xs text-fg-muted">The better value in each row is set in bold.</div>
    </div>
  );
}

type TimingRow = { node: string; t: Percentiles };
const tcol = createColumnHelper<TimingRow>();
const timingColumns = [
  tcol.accessor("node", { header: "Node", cell: (c) => <Code>{c.getValue()}</Code> }),
  tcol.accessor((r) => r.t.p50, { id: "p50", header: "p50", meta: { align: "right" }, cell: (c) => fmtMs(c.getValue()) }),
  tcol.accessor((r) => r.t.p95, { id: "p95", header: "p95", meta: { align: "right" }, cell: (c) => fmtMs(c.getValue()) }),
  tcol.accessor((r) => r.t.mean, { id: "mean", header: "Mean", meta: { align: "right" }, cell: (c) => fmtMs(c.getValue()) }),
  tcol.accessor((r) => r.t.n, {
    id: "n",
    header: "Runs",
    meta: { align: "right" },
    cell: (c) => c.getValue() ?? <span className="text-fg-faint">-</span>,
  }),
];

export function NodeTimings({ report }: { report: BenchmarkReport }) {
  const rows = useMemo(
    () => Object.entries(report.v2.node_timings_ms).map(([node, t]) => ({ node, t })),
    [report],
  );
  if (!rows.length) return <div className="text-xs text-fg-muted">The benchmark recorded no per-node timings.</div>;
  return (
    <DataTable
      data={rows}
      columns={timingColumns}
      getRowId={(r) => r.node}
      stickyHeader={false}
      className="rounded-md border border-border"
    />
  );
}

/** The run's own description of itself: corpus, extraction, threshold, notes. Plain facts. */
export function RunFacts({ report }: { report: BenchmarkReport }) {
  return (
    <div>
      <KeyValue label="Generated">
        <span className="tabular-nums">{fmtDateTime(report.generated_at)}</span>
      </KeyValue>
      <KeyValue label="Git commit">{report.git_commit ? <Code>{report.git_commit}</Code> : <span className="text-fg-faint">-</span>}</KeyValue>
      <KeyValue label="Approval threshold">
        <span className="tabular-nums">{report.threshold}</span>
      </KeyValue>
      {Object.entries(report.corpus).map(([k, v]) => (
        <KeyValue key={`c-${k}`} label={`Corpus ${humanize(k)}`}>
          <Value v={v} />
        </KeyValue>
      ))}
      {Object.entries(report.extraction).map(([k, v]) => (
        <KeyValue key={`e-${k}`} label={`Extraction ${humanize(k)}`}>
          <Value v={v} />
        </KeyValue>
      ))}
      <KeyValue label="Critical fields">
        <span className="flex flex-wrap gap-1">
          {report.critical_fields.map((f) => (
            <Code key={f} className="rounded-md border border-border px-1 text-xs text-fg-muted">
              {f}
            </Code>
          ))}
        </span>
      </KeyValue>
    </div>
  );
}
