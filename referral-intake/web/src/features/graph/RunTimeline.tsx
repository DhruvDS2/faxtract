import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import type { TraceEvent } from "@/contracts";
import { Badge } from "@/components/ui/badge";
import { Code } from "@/components/Code";
import { fmtMs, fmtUsd } from "@/lib/format";
import { traceTone } from "@/lib/status";
import { DataTable } from "./DataTable";
import { TRACE_LABEL } from "./trace";

type Row = TraceEvent & { runIndex: number };
const col = createColumnHelper<Row>();
/** Shrink a column to its content; the error column takes the rest. */
const TIGHT = "w-px whitespace-nowrap";

/**
 * The trace as a compact table: closing events, plus the `running` event of any
 * node that hasn't closed yet. Clicking a row selects its node.
 */
export function RunTimeline({
  events,
  selected,
  onSelect,
}: {
  events: TraceEvent[];
  selected: string | null;
  onSelect: (node: string) => void;
}) {
  const rows = useMemo<Row[]>(() => {
    const sorted = [...events].sort((a, b) => a.seq - b.seq);
    const runs = new Map<string, number>();
    const out: Row[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      if (!runs.has(e.run_id)) runs.set(e.run_id, runs.size + 1);
      if (e.status === "running") {
        const closes = sorted.slice(i + 1).some((x) => x.run_id === e.run_id && x.node === e.node && x.status !== "running");
        if (closes) continue;
      }
      out.push({ ...e, runIndex: runs.get(e.run_id)! });
    }
    return out;
  }, [events]);

  const multiRun = new Set(rows.map((r) => r.run_id)).size > 1;
  const columns = useMemo(
    () => [
      col.accessor("seq", { header: "Seq", meta: { align: "right", className: `${TIGHT} text-fg-muted` } }),
      ...(multiRun
        ? [
            col.accessor("runIndex", {
              header: "Run",
              meta: { align: "right" as const, className: `${TIGHT} text-fg-muted` },
              cell: (c) => <span title={c.row.original.run_id}>{c.getValue()}</span>,
            }),
          ]
        : []),
      col.accessor("node", { header: "Node", meta: { className: TIGHT }, cell: (c) => <Code>{c.getValue()}</Code> }),
      col.accessor("status", {
        header: "Status",
        meta: { className: TIGHT },
        cell: (c) => <Badge tone={traceTone(c.getValue())}>{TRACE_LABEL[c.getValue()]}</Badge>,
      }),
      col.accessor("duration_ms", {
        header: "Duration",
        meta: { align: "right", className: TIGHT },
        cell: (c) => (c.row.original.status === "running" ? <span className="text-fg-faint">…</span> : fmtMs(c.getValue())),
      }),
      col.accessor("cost_usd", {
        header: "Cost",
        meta: { align: "right", className: TIGHT },
        cell: (c) => (c.getValue() > 0 ? fmtUsd(c.getValue()) : <span className="text-fg-faint">-</span>),
      }),
      col.accessor("branch", {
        header: "Branch",
        meta: { className: TIGHT },
        cell: (c) => (c.getValue() ? <Code>{c.getValue()}</Code> : <span className="text-fg-faint">-</span>),
      }),
      col.accessor("attempt", { header: "Attempt", meta: { align: "right", className: TIGHT } }),
      col.accessor("error", {
        header: "Error",
        meta: { className: "max-w-0 truncate text-bad" },
        cell: (c) => <span title={c.getValue() ?? undefined}>{c.getValue() ?? ""}</span>,
      }),
    ],
    [multiRun],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      testId="graph-timeline"
      getRowId={(r) => String(r.seq)}
      rowProps={(row) => ({
        onClick: () => onSelect(row.original.node),
        className: "cursor-pointer",
        "data-state": row.original.node === selected ? "selected" : undefined,
      })}
    />
  );
}
