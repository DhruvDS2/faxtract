import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, ChevronDown, Info, Pause, RotateCw } from "lucide-react";
import { ReactFlowProvider } from "@xyflow/react";
import type { GraphStructure, ReferralRecord, TraceEvent } from "@/contracts";
import { useGraphStructure, useReferral, useRetrySend, useTrace } from "@/api/queries";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { EmptyState, ErrorState, LoadingRows } from "@/components/States";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Code } from "@/components/Code";
import { fmtMs, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GraphCanvas } from "./GraphCanvas";
import { NodePanel } from "./NodePanel";
import { ReferralPicker } from "./ReferralPicker";
import { RunTimeline } from "./RunTimeline";
import { deriveRun, executions, isSettling, type GraphRun } from "./trace";

/** Screen 3: the served LangGraph, coloured by what it did for one referral. */
export function GraphPage() {
  const [params, setParams] = useSearchParams();
  const referralId = params.get("referral") ?? undefined;
  const selected = params.get("node");

  const structure = useGraphStructure();
  const record = useReferral(referralId);

  // Poll the trace while the referral is settling or any node is still running.
  const [anyRunning, setAnyRunning] = useState(false);
  const trace = useTrace(referralId, { live: isSettling(record.data?.status) || anyRunning });
  useEffect(() => setAnyRunning(executions(trace.data ?? []).some((e) => e.status === "running")), [trace.data]);

  const isV1 = record.data?.pipeline === "v1";
  const run = useMemo<GraphRun | null>(() => {
    if (!structure.data || !referralId || isV1) return null;
    return deriveRun(structure.data, trace.data, record.data?.status);
  }, [structure.data, referralId, isV1, trace.data, record.data?.status]);

  const setQuery = (patch: Record<string, string | undefined>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );
  const selectNode = (node: string | null) => setQuery({ node: node ?? undefined });
  const [timelineOpen, setTimelineOpen] = useState(true);

  return (
    <ReactFlowProvider>
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader
          title="Pipeline graph"
          meta={<HeaderMeta structure={structure.data} record={record.data} run={run} events={trace.data} />}
          actions={
            <>
              {record.data && <StatusBadge status={record.data.status} />}
              {referralId && !record.isError && (
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/referrals/${referralId}`}>
                    Open referral <ArrowUpRight />
                  </Link>
                </Button>
              )}
              <ReferralPicker
                value={referralId}
                record={record.data}
                onChange={(id) => setQuery({ referral: id, node: undefined })}
              />
            </>
          }
        />

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {referralId && record.isError && <MissingReferral id={referralId} error={record.error} onClear={() => setQuery({ referral: undefined, node: undefined })} />}
            {record.data && <Banner record={record.data} run={run} structure={structure.data} />}

            <div className="relative min-h-0 flex-1">
              {structure.isPending ? (
                <GraphSkeleton />
              ) : structure.isError ? (
                <ErrorState error={structure.error} onRetry={() => void structure.refetch()} />
              ) : structure.data.nodes.length === 0 ? (
                <EmptyState title="The API returned an empty graph" hint="GET /graph/structure has no nodes. Check graph.service.structure()." />
              ) : (
                <>
                  <GraphCanvas
                    structure={structure.data}
                    run={run}
                    selected={selected}
                    onSelect={selectNode}
                    dimmed={isV1}
                  />
                  {!referralId && (
                    <div className="pointer-events-none absolute top-3 left-3 max-w-xs rounded-md border border-border bg-bg px-3 py-2 text-xs text-fg-muted">
                      <span className="font-medium text-fg">Pick a referral</span> to see the path it took through the graph. Click
                      a node for its attempts and state diff.
                    </div>
                  )}
                </>
              )}
            </div>

            {referralId && !record.isError && (
              <section
                className={cn("flex shrink-0 flex-col border-t border-border", timelineOpen ? "h-44" : "h-9")}
                aria-label={isV1 ? "v1 stage events" : "Run timeline"}
              >
                <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface px-2">
                  <button
                    type="button"
                    onClick={() => setTimelineOpen((o) => !o)}
                    aria-expanded={timelineOpen}
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-semibold hover:bg-surface-2"
                  >
                    <ChevronDown className={cn("size-3.5 text-fg-faint transition-transform duration-150", !timelineOpen && "-rotate-90")} />
                    {isV1 ? "v1 stage events" : "Run timeline"}
                  </button>
                  {trace.data && <span className="text-xs text-fg-muted tabular-nums">{trace.data.length} events</span>}
                  {run?.live && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-accent">
                      <span className="size-1.5 rounded-full bg-accent" aria-hidden /> Live
                    </span>
                  )}
                  {!isV1 && <Legend />}
                </div>
                <div className={cn("min-h-0 flex-1 overflow-auto", !timelineOpen && "hidden")}>
                  {trace.isPending ? (
                    <LoadingRows rows={4} />
                  ) : trace.isError ? (
                    <ErrorState error={trace.error} onRetry={() => void trace.refetch()} />
                  ) : trace.data.length === 0 ? (
                    isV1 && record.data ? (
                      <V1Stages record={record.data} />
                    ) : (
                      <EmptyState title="No trace events yet" hint="Events appear here as each node starts and finishes." />
                    )
                  ) : (
                    <RunTimeline
                      events={trace.data}
                      selected={selected}
                      onSelect={isV1 ? undefined : (n) => selectNode(n)}
                      nodeHeader={isV1 ? "Stage" : "Node"}
                    />
                  )}
                </div>
              </section>
            )}
          </div>

          {selected && structure.data && !isV1 && (
            <NodePanel nodeId={selected} structure={structure.data} run={run} onClose={() => selectNode(null)} />
          )}
        </div>
      </div>
    </ReactFlowProvider>
  );
}

function HeaderMeta({
  structure,
  record,
  run,
  events,
}: {
  structure: GraphStructure | undefined;
  record: ReferralRecord | undefined;
  run: GraphRun | null;
  events: TraceEvent[] | undefined;
}) {
  if (record) {
    const closed = (events ?? []).filter((e) => e.status !== "running");
    const ms = closed.reduce((s, e) => s + e.duration_ms, 0);
    const cost = closed.reduce((s, e) => s + e.cost_usd, 0);
    const name = record.referral.patient_last_name
      ? `${record.referral.patient_last_name}, ${record.referral.patient_first_name ?? ""}`
      : null;
    return (
      <span className="tabular-nums">
        {record.source_name}
        {name && ` · ${name}`} · pipeline <Code className="text-xs">{record.pipeline}</Code>
        {run && run.runCount > 0 && ` · ${run.runCount} run${run.runCount === 1 ? "" : "s"} · ${fmtMs(ms)} in nodes · ${fmtUsd(cost)}`}
      </span>
    );
  }
  if (!structure) return null;
  const real = structure.nodes.filter((n) => n.kind === "node").length;
  return (
    <span>
      {real} nodes · {structure.edges.length} edges, read from <Code className="text-xs">GET /graph/structure</Code> · serving{" "}
      <Code className="text-xs">{structure.active_pipeline}</Code>
    </span>
  );
}

function Banner({ record, run, structure }: { record: ReferralRecord; run: GraphRun | null; structure: GraphStructure | undefined }) {
  if (record.pipeline === "v1") {
    return (
      <div className="flex min-h-11 items-center gap-2 border-b border-border bg-surface px-4 py-1.5 text-sm">
        <Info className="size-4 shrink-0 text-fg-muted" />
        <div className="flex-1 text-fg-muted">
          <span className="font-medium text-fg">Ran on the v1 baseline</span> (<Code>app/pipeline.py</Code>), which has no graph. The v2
          graph is shown dimmed for reference; the v1 stage events are listed below.
        </div>
        {record.status === "needs_review" && <FixResume id={record.id} />}
      </div>
    );
  }
  if (record.status === "needs_review") {
    const at = run?.pausedAt?.node ?? structure?.nodes.find((n) => n.interrupts)?.id;
    const label = structure?.nodes.find((n) => n.id === at)?.label ?? at ?? "human review";
    return (
      <div className="flex min-h-11 items-center gap-3 border-b border-warn-border bg-warn-bg px-4 py-1.5" role="status">
        <Pause className="size-4 shrink-0 text-warn" />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
          <span className="text-sm font-medium text-warn">Graph paused at {label}</span>
          {record.review_reasons.length ? (
            <ul className="flex flex-wrap gap-x-3 text-xs text-fg-muted" aria-label="Review reasons">
              {record.review_reasons.map((r) => (
                <li key={r} className="before:mr-1.5 before:text-fg-faint before:content-['·'] first:before:hidden">
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-fg-muted">No review reasons recorded</span>
          )}
        </div>
        <FixResume id={record.id} />
      </div>
    );
  }
  if (record.status === "ris_error") return <RisErrorBanner record={record} />;
  if (record.status === "failed") {
    return (
      <div className="flex min-h-11 items-center gap-2 border-b border-bad-border bg-bad-bg px-4 py-1.5 text-sm" role="alert">
        <AlertTriangle className="size-4 shrink-0 text-bad" />
        <div>
          <span className="font-medium text-bad">Pipeline failed</span>
          {record.error && <span className="text-fg-muted">: {record.error}</span>}
        </div>
      </div>
    );
  }
  return null;
}

function FixResume({ id }: { id: string }) {
  return (
    <Button asChild variant="primary" size="sm" data-testid="btn-fix-resume">
      <Link to={`/referrals/${id}?edit=1`}>Fix &amp; resume</Link>
    </Button>
  );
}

function RisErrorBanner({ record }: { record: ReferralRecord }) {
  const retry = useRetrySend(record.id);
  const onRetry = () =>
    retry.mutate(undefined, {
      onSuccess: (r) =>
        r.status === "sent_to_ris"
          ? toast.success(`RIS accepted ${r.order.order_id ?? "the order"} (${r.order.ack_code ?? "AA"})`)
          : toast.error(`RIS still failing: ${r.order.last_error ?? r.status}`),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : String(e)),
    });
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-bad-border bg-bad-bg px-4 py-1.5" role="alert">
      <AlertTriangle className="size-4 shrink-0 text-bad" />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
        <span className="text-sm font-medium text-bad">Order not accepted by the RIS</span>
        <span className="text-xs text-fg-muted">
          {record.order.last_error ?? "No error recorded"} · {record.order.attempts} attempt{record.order.attempts === 1 ? "" : "s"}
        </span>
      </div>
      <Button size="sm" onClick={onRetry} disabled={retry.isPending}>
        <RotateCw /> {retry.isPending ? "Sending" : "Retry send"}
      </Button>
    </div>
  );
}

function MissingReferral({ id, error, onClear }: { id: string; error: unknown; onClear: () => void }) {
  const status = error instanceof ApiError ? error.status : null;
  return (
    <div className="flex items-center gap-2 border-b border-bad-border bg-bad-bg px-4 py-2 text-sm" role="alert">
      <AlertTriangle className="size-4 shrink-0 text-bad" />
      <span className="text-bad">
        {status === 404 ? "Referral " : "Could not load referral "}
        <Code>{id}</Code>
        {status === 404 ? " not found (404)" : `: ${error instanceof Error ? error.message : String(error)}`}
      </span>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

/** v1 has no graph; if its trace is empty, fall back to the record's stage timings. */
function V1Stages({ record }: { record: ReferralRecord }) {
  const stages = Object.entries(record.stage_timings_ms);
  if (!stages.length) return <EmptyState title="No stage events recorded" />;
  return (
    <ul className="divide-y divide-border text-sm">
      {stages.map(([stage, ms]) => (
        <li key={stage} className="flex h-8 items-center px-4">
          <Code>{stage}</Code>
          <span className="ml-auto tabular-nums text-fg-muted">{fmtMs(ms)}</span>
        </li>
      ))}
    </ul>
  );
}

function Legend() {
  const items: { label: string; className: string }[] = [
    { label: "done", className: "border-ok-border" },
    { label: "running", className: "border-accent" },
    { label: "paused", className: "border-warn-border bg-warn-bg" },
    { label: "error", className: "border-bad-border bg-bad-bg" },
    { label: "not reached", className: "border-dashed border-idle-border" },
  ];
  return (
    <div className="ml-auto hidden items-center gap-3 pr-2 text-xs text-fg-muted lg:flex" aria-label="Legend">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2.5 w-4 rounded-md border", i.className)} aria-hidden />
          {i.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded-full bg-accent" aria-hidden />
        path taken
      </span>
    </div>
  );
}

function GraphSkeleton() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6" aria-busy>
      {Array.from({ length: 7 }).map((_, i) => (
        <Skeleton key={i} className={cn("h-10 w-40", i === 0 && "h-7 w-22")} />
      ))}
    </div>
  );
}
