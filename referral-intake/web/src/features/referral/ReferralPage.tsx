import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { REVIEWABLE, type ReferralRecord, type ReferralSummary } from "@/contracts";
import { ApiError, faxUrl } from "@/api/client";
import { useCorrections, useHealth, useReferral, useTrace } from "@/api/queries";
import { SplitPane } from "@/components/SplitPane";
import { EmptyState, ErrorState } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHotkeys } from "@/lib/hotkeys";
import { DURATION_MS, useMotionPrefs } from "@/lib/motion";
import { STATUS } from "@/lib/status";
import { DetailHeader, useBackToQueue } from "./DetailHeader";
import type { FocusRequest } from "./FaxViewer";
import { fieldMeta } from "./fields";
import { FieldsPanel, FieldsSkeleton, rowId } from "./FieldsPanel";
import { notify } from "./notify";
import { ACK_ID, Panels, panelDomId } from "./Panels";
import { blockingReasons, reviewReasons, type ReasonTarget } from "./reasons";
import { RejectDialog } from "./RejectDialog";
import { statusView, summaryView } from "./statusView";
import { useApproveFlow } from "./useApproveFlow";
import { useFieldEditor } from "./useFieldEditor";
import { useReviewActions } from "./useReviewActions";
import { ReadingTheFax, WhyItStopped } from "./WhyItStopped";

// react-pdf + pdf.js are heavy: load them only on this screen.
const FaxViewer = lazy(() => import("./FaxViewer"));

const labelFor = (f: string) => fieldMeta(f).label;

const patientName = (r: ReferralRecord) => {
  const { patient_last_name: last, patient_first_name: first } = r.referral;
  if (last && first) return `${last}, ${first}`;
  return last ?? first ?? null;
};

/** The queue row this referral was opened from, if the queue is cached: the header renders from it at once. */
function useCachedSummary(id: string): ReferralSummary | null {
  const qc = useQueryClient();
  return useMemo(() => {
    for (const [, rows] of qc.getQueriesData<ReferralSummary[]>({ queryKey: ["referrals"] })) {
      const hit = rows?.find((r) => r.id === id);
      if (hit) return hit;
    }
    return null;
  }, [qc, id]);
}

/** Which panel is open until the reviewer picks one: what this status is about. */
const defaultPanel = (r: ReferralRecord | undefined) =>
  !r ? "" : r.status === "needs_review" ? "policy" : ["approved", "auto_approved", "sent_to_ris", "ris_error"].includes(r.status) ? "order" : "";

/** /referrals/:id (?edit=1 opens edit mode, e.g. from the graph's "Fix & resume"). */
export function ReferralPage() {
  const { id = "" } = useParams();
  return <ReferralScreen key={id} id={id} />;
}

function ReferralScreen({ id }: { id: string }) {
  const q = useReferral(id);
  const summary = useCachedSummary(id);
  if (!q.data && q.error instanceof ApiError && q.error.status === 404) return <NotFound />;
  if (!q.data && q.isError)
    return (
      <div className="flex h-full min-h-0 flex-col">
        {summary && <DetailHeader id={id} name={summary.patient_name} status={summaryView(summary)} flow={null} graphLink={false} actions={null} />}
        <div className="flex flex-1 flex-col justify-center">
          <ErrorState error={q.error} title="Couldn't load this referral" onRetry={() => void q.refetch()} />
        </div>
      </div>
    );
  return <ReferralView id={id} record={q.data} summary={summary} />;
}

function NotFound() {
  return (
    <div className="flex h-full flex-col justify-center">
      <EmptyState
        title="This referral doesn't exist any more."
        hint="It may have been removed, or the link is wrong."
        action={
          <Button variant="secondary" asChild>
            <Link to="/queue">Back to the queue</Link>
          </Button>
        }
      />
    </div>
  );
}

type ViewProps = {
  id: string;
  record: ReferralRecord | undefined;
  summary: ReferralSummary | null;
};

/**
 * One stable tree from first paint to loaded: the header (the morph target) renders
 * from the cached queue row while the record loads, then the fax and fields fill in.
 */
function ReferralView({ id, record, summary }: ViewProps) {
  const [params, setParams] = useSearchParams();
  const { reduce } = useMotionPrefs();
  const back = useBackToQueue();
  const threshold = useHealth().data?.threshold;
  const processing = record?.status === "processing";
  const trace = useTrace(id, { live: processing }).data;
  const corrections = useCorrections(record ? id : undefined).data;

  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [panel, setPanel] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const editor = useFieldEditor(id, record);
  const actions = useReviewActions(id, record);
  const flow = useApproveFlow(id, record, () => {
    // The order went out: open the HL7 panel to the ACK.
    setPanel("order");
    window.setTimeout(
      () => document.getElementById(ACK_ID)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" }),
      DURATION_MS.panel,
    );
  });

  const reasons = useMemo(() => (record ? reviewReasons(record) : []), [record]);
  const blocking = useMemo(() => blockingReasons(actions.blocking), [actions.blocking]);
  const name = record ? (patientName(record) ?? "Unnamed patient") : (summary?.patient_name ?? null);
  const status = record ? statusView(record, reasons.length, trace) : summary ? summaryView(summary) : null;
  const panelValue = panel ?? defaultPanel(record);

  const smooth: ScrollBehavior = reduce ? "auto" : "smooth";
  const select = (field: string | null, scrollRow = false) => {
    setSelected(field);
    if (!field) return;
    setFocus((f) => ({ field, n: (f?.n ?? 0) + 1 }));
    if (scrollRow) document.getElementById(rowId(field))?.scrollIntoView({ block: "nearest", behavior: smooth });
  };

  const go = (t: ReasonTarget) => {
    if (t.kind === "field") {
      select(t.field);
      document.getElementById(rowId(t.field))?.scrollIntoView({ block: "center", behavior: smooth });
      return;
    }
    setPanel(t.panel);
    requestAnimationFrame(() => document.getElementById(panelDomId(t.panel))?.scrollIntoView({ block: "start", behavior: smooth }));
  };

  const approve = async () => {
    if (!actions.canApprove || actions.busy || editor.editing) return;
    flow.start();
    if (!(await actions.approve())) flow.cancel();
  };

  // ?edit=1 (Fix & resume): open edit mode once the referral is reviewable, then drop the flag.
  useEffect(() => {
    if (params.get("edit") !== "1" || !record || record.status === "processing") return;
    const next = new URLSearchParams(params);
    next.delete("edit");
    setParams(next, { replace: true });
    if (REVIEWABLE.includes(record.status)) editor.start();
    else notify.info(`Editing is only possible while a referral needs review. This one is ${STATUS[record.status].label.toLowerCase()}.`);
    // Runs when the flag or the status changes.
  }, [params, record?.status]);

  // Someone else moved it on (or approve went through): leave edit mode.
  useEffect(() => {
    if (editor.editing && record && !REVIEWABLE.includes(record.status)) editor.cancel();
  }, [record?.status]);

  useHotkeys(
    {
      e: () => {
        if (actions.canEdit && !editor.editing && !actions.busy) editor.start();
      },
      a: () => void approve(),
      r: () => {
        if (actions.canReject && !editor.editing && !actions.busy) setRejectOpen(true);
      },
      Escape: (e) => {
        // A select's listbox closes on its own Escape.
        if (e.target instanceof Element && e.target.closest("[role='listbox']")) return;
        if (editor.editing) editor.cancel();
        else if (selected) select(null);
        else back();
      },
      "mod+Enter": () => {
        if (editor.editing) editor.save();
      },
    },
    { allowInInputs: ["Escape", "mod+Enter"] },
  );

  const fax = record ? (
    <Suspense fallback={<FaxFallback />}>
      <FaxViewer
        url={faxUrl(record.id)}
        boxes={record.referral.boxes ?? {}}
        selectedField={selected}
        focus={focus}
        hoveredField={hovered}
        onSelectField={(f) => select(f, true)}
        onHoverField={setHovered}
        labelFor={labelFor}
      />
    </Suspense>
  ) : (
    <FaxFallback />
  );

  const details = !record ? (
    <FieldsSkeleton />
  ) : (
    <>
      {processing ? (
        <ReadingTheFax record={record} trace={trace} />
      ) : (
        <WhyItStopped record={record} reasons={reasons} blocking={blocking} onGo={go} />
      )}
      {processing ? (
        <FieldsSkeleton label="Reading the fax" />
      ) : (
        <FieldsPanel
          record={record}
          editor={editor}
          threshold={threshold}
          selected={selected}
          hovered={hovered}
          onSelect={select}
          onHover={setHovered}
          corrections={corrections}
        />
      )}
      <Panels
        record={record}
        actions={actions}
        corrections={corrections}
        value={panelValue}
        onValueChange={setPanel}
        compareOpen={compareOpen}
        onToggleCompare={() => setCompareOpen((v) => !v)}
      />
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DetailHeader
        id={id}
        name={name}
        status={status}
        flow={flow.view}
        graphLink={!!record}
        actions={
          record
            ? {
                editing: editor.editing,
                saving: editor.saving,
                canApprove: actions.canApprove,
                canEdit: actions.canEdit,
                canReject: actions.canReject,
                canRetry: actions.canRetry,
                busy: actions.busy || flow.active && !flow.finished,
                approving: actions.approving,
                retrying: actions.retrying,
                onEdit: editor.start,
                onCancel: editor.cancel,
                onSave: editor.save,
                onApprove: () => void approve(),
                onReject: () => setRejectOpen(true),
                onRetry: actions.retry,
              }
            : null
        }
      />
      <div className="min-h-0 flex-1">
        <SplitPane
          storageKey="referral.detail.split"
          label="Resize the fax and the details"
          left={fax}
          right={<div className="min-h-0 flex-1 overflow-y-auto">{details}</div>}
        />
      </div>
      {record && (
        <RejectDialog open={rejectOpen} onOpenChange={setRejectOpen} patient={name ?? "This referral"} pending={actions.rejecting} onReject={actions.reject} />
      )}
    </div>
  );
}

function FaxFallback() {
  return (
    <div className="flex h-full flex-col bg-surface-2" data-testid="fax-viewer" aria-busy>
      <div className="h-10 shrink-0 border-b border-border bg-bg" />
      <div className="flex-1 p-4">
        <Skeleton className="h-full w-full rounded-none" />
      </div>
    </div>
  );
}
