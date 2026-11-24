import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import type { GraphStructure, ReferralRecord, ReferralSummary } from "@/contracts";
import { ApiError } from "@/api/client";
import { useGraphStructure, useReferral, useReferrals, useRetrySend, useTrace } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { Code } from "@/components/Code";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState, describeError } from "@/components/States";
import { StatusLine } from "@/components/StatusLine";
import { AnimatePresence } from "@/lib/motion";
import { fmtDateTime, fmtMs, fmtUsd } from "@/lib/format";
import { GraphInteractionContext, type GraphInteraction } from "./context";
import { FlowMap } from "./FlowMap";
import { stepLabel } from "./labels";
import { NodePanel } from "./NodePanel";
import { ReferralPicker } from "./ReferralPicker";
import { useStepReveal } from "./reveal";
import { STEP_H, STEP_W } from "./StepNode";
import { TechToggle, useTechDetails } from "./TechToggle";
import { TraceTimeline } from "./TraceTimeline";
import { deriveRun, executions, isSettling, revealSequence, type GraphRun } from "./trace";
import { V1Stages } from "./V1Stages";
import { parseReason } from "@/features/referral/reasons";

/**
 * Pipeline: the served graph as a left-to-right flow map, coloured by what it did
 * for one referral. Structure from GET /graph/structure, states from the trace.
 */
export function GraphPage() {
  const [params, setParams] = useSearchParams();
  const referralId = params.get("referral") ?? undefined;
  const selected = params.get("node");

  const structure = useGraphStructure();
  const referrals = useReferrals();
  const record = useReferral(referralId);
  const summary = referrals.data?.find((r) => r.id === referralId);
  const [tech, setTech] = useTechDetails();

  // Poll the trace while the referral is settling or a step is still running.
  const [stepRunning, setStepRunning] = useState(false);
  const live = !!referralId && (isSettling(record.data?.status) || stepRunning);
  const trace = useTrace(referralId, { live });
  useEffect(() => setStepRunning(executions(trace.data ?? []).some((e) => e.status === "running")), [trace.data]);

  const isV1 = record.data?.pipeline === "v1";
  // States need both the record (is it still settling?) and the trace; until then the map waits, unlit.
  const run = useMemo<GraphRun | null>(() => {
    if (!structure.data || !referralId || isV1 || record.isError || !trace.data || !record.data) return null;
    return deriveRun(structure.data, trace.data, record.data.status);
  }, [structure.data, referralId, isV1, record.isError, trace.data, record.data]);
  const awaiting = !!referralId && !run && !isV1 && !record.isError && !trace.isError;

  const setQuery = useCallback(
    (patch: Record<string, string | undefined>) =>
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
      ),
    [setParams],
  );
  const select = useCallback((node: string | null) => setQuery({ node: node ?? undefined }), [setQuery]);
  const [hovered, setHovered] = useState<string | null>(null);

  // The Decimals reveal: once the trace has arrived and the map is on screen.
  const [mapReady, setMapReady] = useState(false);
  const onMapReady = useCallback(() => setMapReady(true), []);
  const dataReady = !!run && trace.isSuccess && !!record.data;
  const sequence = useMemo(() => (dataReady && structure.data && run ? revealSequence(structure.data, run) : null), [dataReady, structure.data, run]);
  const reveal = useStepReveal(referralId, sequence, mapReady);

  const interaction = useMemo<GraphInteraction>(
    () => ({ selected, hovered, select, hover: setHovered, reveal }),
    [selected, hovered, select, reveal],
  );

  // The panel covers the right of the map: measure it so the selected step can be kept clear.
  const panelRef = useRef<HTMLElement>(null);
  const [covered, setCovered] = useState(0);
  const panelOpen = !!selected && !!structure.data?.nodes.some((n) => n.id === selected) && !isV1;
  useLayoutEffect(() => setCovered(panelOpen ? (panelRef.current?.offsetWidth ?? 0) : 0), [panelOpen]);

  // Escape closes the panel and puts focus back on its step.
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const id = selected;
      select(null);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-testid="graph-node"][data-node="${CSS.escape(id ?? "")}"]`)?.focus(),
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, selected, select]);

  const missing = !!referralId && record.isError;

  return (
    <GraphInteractionContext.Provider value={interaction}>
      <ReactFlowProvider>
        <div className="flex h-full min-h-0 flex-col">
          <Header
            referralId={referralId}
            record={record.data}
            recordError={record.error}
            summary={summary}
            structure={structure.data}
            run={run}
            items={referrals.data}
            listFailed={referrals.isError}
            structureFailed={structure.isError}
            onPick={(id) => setQuery({ referral: id, node: undefined })}
          />

          <div className="flex h-10 shrink-0 items-center gap-4 px-6">
            {run && !isV1 && <Legend />}
            <TechToggle on={tech} onChange={setTech} className="ml-auto -mr-2" />
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {structure.isPending ? (
              <MapSkeleton />
            ) : structure.isError ? (
              <ErrorState title="Couldn't load the pipeline map" error={structure.error} onRetry={() => void structure.refetch()} />
            ) : structure.data.nodes.length === 0 ? (
              <EmptyState title="The pipeline has no steps" hint="GET /graph/structure returned an empty graph." />
            ) : isV1 && record.data ? (
              <div className="h-full overflow-y-auto">
                <V1Stages record={record.data} events={trace.data} tech={tech} />
              </div>
            ) : (
              <FlowMap
                structure={structure.data}
                run={run}
                awaiting={awaiting}
                tech={tech}
                coveredRight={covered}
                selected={selected}
                onReady={onMapReady}
              />
            )}
            <AnimatePresence>
              {panelOpen && structure.data && selected && (
                <NodePanel
                  key="panel"
                  ref={panelRef}
                  nodeId={selected}
                  structure={structure.data}
                  run={run}
                  tech={tech}
                  onTech={setTech}
                  onClose={() => select(null)}
                />
              )}
            </AnimatePresence>
          </div>

          {referralId && !missing && !isV1 && (
            trace.isError ? (
              <div className="shrink-0 border-t border-border">
                <ErrorState title="Couldn't load the trace" error={trace.error} onRetry={() => void trace.refetch()} align="start" className="py-4" />
              </div>
            ) : trace.isPending || !run ? (
              <div className="flex h-24 shrink-0 flex-col justify-center gap-2 border-t border-border px-6" aria-busy="true">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : (
              <TraceTimeline executions={run.executions} live={live} tech={tech} />
            )
          )}
        </div>
      </ReactFlowProvider>
    </GraphInteractionContext.Provider>
  );
}

// ---------- header ----------

const name = (r: ReferralRecord | undefined, s: ReferralSummary | undefined) => {
  const last = r?.referral.patient_last_name;
  if (last) return `${last}, ${r?.referral.patient_first_name ?? ""}`.trim().replace(/,$/, "");
  return s?.patient_name ?? r?.source_name ?? s?.source_name ?? null;
};

/** Where the run stands, as the second half of the display line. */
function standing(r: ReferralRecord, run: GraphRun | null, structure: GraphStructure | undefined): string {
  const paused = run?.pausedAt?.node ?? structure?.nodes.find((n) => n.interrupts)?.id;
  const failedAt = run ? [...run.states].find(([, s]) => s === "error")?.[0] : undefined;
  switch (r.status) {
    case "processing":
      return "still running";
    case "needs_review":
      return paused ? `paused at ${stepLabel(paused).toLowerCase()}` : "waiting for review";
    case "ris_error":
      return r.order.ack_code && r.order.ack_code !== "AA" ? `RIS rejected the order (${r.order.ack_code})` : "RIS didn't acknowledge";
    case "sent_to_ris":
      return r.order.ack_code ? `sent to RIS · ACK ${r.order.ack_code}` : "sent to RIS";
    case "approved":
    case "auto_approved":
      return "approved, sending to RIS";
    case "rejected":
      return "rejected";
    case "failed":
      return failedAt ? `stopped at ${stepLabel(failedAt).toLowerCase()}` : "failed";
  }
}

/** The pipeline's review reasons in the detail page's words ("Prior auth: prior imaging is missing…"). */
const plainReasons = (raw: string[]) =>
  raw
    .map((x, i) => {
      const p = parseReason(x, i);
      return p.lead ? `${p.lead}: ${p.text}` : p.text;
    })
    .join(" · ");

function StatusFor({ r, run }: { r: ReferralRecord; run: GraphRun | null }) {
  const runningStep = [...(run?.executions ?? [])].reverse().find((e) => e.status === "running")?.node;
  switch (r.status) {
    case "processing":
    case "approved":
    case "auto_approved":
      return (
        <StatusLine tone="idle" running detail="Updates live">
          {runningStep ? `Running: ${stepLabel(runningStep)}` : r.status === "processing" ? "Starting" : "Sending the order to the RIS"}
        </StatusLine>
      );
    case "needs_review":
      return (
        <StatusLine tone="warn" detail={r.review_reasons.length ? plainReasons(r.review_reasons) : undefined}>
          Waiting for a coordinator
        </StatusLine>
      );
    case "ris_error":
      return (
        <StatusLine
          tone="bad"
          detail={[r.order.last_error, `${r.order.attempts} attempt${r.order.attempts === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
        >
          {r.order.ack_code && r.order.ack_code !== "AA" ? `RIS rejected the order (${r.order.ack_code}). Retry send.` : "RIS didn't acknowledge. Retry send."}
        </StatusLine>
      );
    case "sent_to_ris":
      return (
        <StatusLine tone={r.order.ack_code && r.order.ack_code !== "AA" ? "bad" : "ok"} detail={r.order.sent_at ? `sent ${fmtDateTime(r.order.sent_at)}` : undefined}>
          {r.order.order_id ? <>Order <Code>{r.order.order_id}</Code> accepted by the RIS</> : "Accepted by the RIS"}
        </StatusLine>
      );
    case "rejected": {
      const note = [...r.reviews].reverse().find((v) => v.action === "reject")?.note;
      return (
        <StatusLine tone="rejected" detail={note ? <span className="line-clamp-1" title={note}>{note}</span> : undefined}>
          Rejected
        </StatusLine>
      );
    }
    case "failed":
      return (
        <StatusLine tone="bad" detail={r.error ?? undefined}>
          The pipeline stopped
        </StatusLine>
      );
  }
}

function Header({
  referralId,
  record,
  recordError,
  summary,
  structure,
  run,
  items,
  listFailed,
  structureFailed,
  onPick,
}: {
  referralId: string | undefined;
  record: ReferralRecord | undefined;
  recordError: unknown;
  summary: ReferralSummary | undefined;
  structure: GraphStructure | undefined;
  run: GraphRun | null;
  items: ReferralSummary[] | undefined;
  listFailed: boolean;
  structureFailed: boolean;
  onPick: (id: string | undefined) => void;
}) {
  const steps = structure?.nodes.filter((n) => n.kind === "node").length ?? 0;
  const picker = <ReferralPicker value={referralId} items={items} record={record} failed={listFailed} onChange={onPick} />;

  if (!referralId) {
    return (
      <PageHeader
        title="Pick a referral to see the path it took"
        meta={
          steps
            ? `${steps} steps, read from the running pipeline. Click a step to see what it does.`
            : structureFailed
              ? "The pipeline map didn't load."
              : "Reading the pipeline…"
        }
        actions={picker}
      />
    );
  }

  if (recordError) {
    const notFound = recordError instanceof ApiError && recordError.status === 404;
    return (
      <PageHeader
        title={notFound ? "Referral not found" : "Couldn't load this referral"}
        status={
          <StatusLine
            tone="bad"
            detail={notFound ? undefined : describeError(recordError).cause}
            action={
              <Button variant="ghost" size="sm" onClick={() => onPick(undefined)}>
                Clear
              </Button>
            }
          >
            {notFound ? (
              <>
                There's no referral <Code>{referralId}</Code>. Pick another one.
              </>
            ) : (
              <>
                Referral <Code>{referralId}</Code> didn't load.
              </>
            )}
          </StatusLine>
        }
        actions={picker}
      />
    );
  }

  const who = name(record, summary);
  if (!record) {
    return (
      <PageHeader
        title={who ?? <Skeleton className="h-6 w-72" />}
        meta={<Skeleton className="h-3 w-96" />}
        actions={picker}
      />
    );
  }

  const isV1 = record.pipeline === "v1";
  const closed = (run?.executions ?? []).filter((e) => e.close);
  const ran = new Set(run?.executions.map((e) => e.node)).size;
  const ms = closed.reduce((s, e) => s + e.close!.duration_ms, 0);
  const cost = closed.reduce((s, e) => s + e.close!.cost_usd, 0);
  const meta = isV1
    ? `${record.source_name} · the v1 baseline has no graph, so its stages are listed instead`
    : [
        record.source_name,
        run && `${ran} of ${steps} steps ran`,
        run && closed.length > 0 && `${fmtMs(ms)} in steps`,
        run && closed.length > 0 && (cost > 0 ? `${fmtUsd(cost)} model cost` : "no model cost"),
        run && run.runCount > 1 && `${run.runCount} runs`,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <PageHeader
      title={`${who ?? record.source_name} · ${isV1 ? "ran on the v1 baseline" : standing(record, run, structure)}`}
      status={<StatusFor r={record} run={run} />}
      meta={meta}
      actions={
        <>
          <Button asChild variant="ghost" size="sm">
            <Link to={`/referrals/${record.id}`}>Open referral</Link>
          </Button>
          {picker}
          {record.status === "needs_review" && (
            <Button asChild variant="primary" size="sm" data-testid="btn-fix-resume">
              <Link to={`/referrals/${record.id}?edit=1`}>Fix &amp; resume</Link>
            </Button>
          )}
          {record.status === "ris_error" && <RetrySend id={record.id} />}
        </>
      }
    />
  );
}

function RetrySend({ id }: { id: string }) {
  const retry = useRetrySend(id);
  return (
    <Button
      variant="primary"
      size="sm"
      loading={retry.isPending}
      loadingText="Sending"
      onClick={() =>
        retry.mutate(undefined, {
          onSuccess: (r) =>
            r.status === "sent_to_ris"
              ? toast.success(`RIS accepted ${r.order.order_id ?? "the order"} (ACK ${r.order.ack_code ?? "AA"})`)
              : toast.error(`RIS still didn't accept it: ${r.order.last_error ?? r.status}`),
          onError: (e) => toast.error(`Couldn't retry the send · ${describeError(e).cause}`),
        })
      }
    >
      Retry send
    </Button>
  );
}

// ---------- map furniture ----------

function Legend() {
  return (
    <ul className="flex items-center gap-4 text-meta text-fg-faint" aria-label="Legend">
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-0.5 w-4 rounded-full bg-accent" />
        Path taken
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-px w-4 bg-border-strong" />
        Other routes
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-4 rounded-sm border border-warn-border bg-warn-bg" />
        Paused
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-4 rounded-sm border border-bad-border" />
        Failed
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-4 rounded-sm border border-dashed border-border-strong" />
        Not reached
      </li>
    </ul>
  );
}

/** The spine's shape while the structure loads. */
function MapSkeleton() {
  return (
    <div className="flex h-full items-center justify-center gap-5 px-6" aria-busy="true" aria-label="Loading the pipeline map">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton
          key={i}
          className="shrink-0 rounded-md"
          style={{ width: `${STEP_W / 16}rem`, height: `${STEP_H / 16}rem` }}
        />
      ))}
    </div>
  );
}
