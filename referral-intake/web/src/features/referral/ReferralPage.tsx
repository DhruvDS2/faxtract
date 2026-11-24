import { Suspense, lazy, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Waypoints } from "lucide-react";
import { REVIEWABLE, type ReferralRecord } from "@/contracts";
import { ApiError, packetUrl, faxUrl } from "@/api/client";
import { useCorrections, useReferral } from "@/api/queries";
import { Code } from "@/components/Code";
import { EmptyState, ErrorState } from "@/components/States";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "./notify";
import { Tip } from "@/components/ui/tooltip";
import { fmtDateTime } from "@/lib/format";
import { STATUS } from "@/lib/status";
import { queueHref } from "@/features/queue/queueMemory";
import { useHotkeys } from "@/features/queue/useHotkeys";
import { ActionsBar } from "./ActionsBar";
import { ComparePanel } from "./ComparePanel";
import { EligibilityPanel } from "./EligibilityPanel";
import { fieldMeta } from "./fields";
import { FieldsPanel } from "./FieldsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { OrderPanel } from "./OrderPanel";
import { PolicyPanel } from "./PolicyPanel";
import { RejectDialog } from "./RejectDialog";
import { Section } from "./Section";
import { SplitPane } from "./SplitPane";
import { StatusBanner } from "./StatusBanner";
import { useFieldEditor } from "./useFieldEditor";
import { useReviewActions } from "./useReviewActions";

// react-pdf + pdf.js are heavy: load them only on this screen.
const FaxViewer = lazy(() => import("./FaxViewer"));
const PdfPreview = lazy(() => import("./PdfPreview"));

const labelFor = (f: string) => fieldMeta(f).label;

/** /referrals/:id (?edit=1 opens edit mode, e.g. from the graph's "Fix & resume"). */
export function ReferralPage() {
  const { id } = useParams();
  const q = useReferral(id);

  if (q.data) return <ReferralView key={q.data.id} record={q.data} />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404)
      return (
        <EmptyState
          title={`Referral ${id} was not found`}
          hint="It may have been removed, or the link is wrong."
          action={
            <Button size="sm" asChild>
              <Link to="/queue">Back to the queue</Link>
            </Button>
          }
        />
      );
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  }
  return <DetailSkeleton />;
}

function DetailSkeleton() {
  return (
    <div className="flex h-full min-h-0" aria-busy aria-label="Loading referral">
      <div className="flex w-1/2 flex-col border-r border-border">
        <div className="h-10 border-b border-border bg-surface" />
        <div className="flex-1 bg-surface-2 p-4">
          <Skeleton className="h-full w-full bg-border" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-72" />
        <div className="mt-4 flex flex-col gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReferralView({ record }: { record: ReferralRecord }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const editor = useFieldEditor(record);
  const actions = useReviewActions(record);
  const corrections = useCorrections(record.id).data;

  const r = record.referral;
  const patient = r.patient_last_name ? `${r.patient_last_name}, ${r.patient_first_name ?? ""}`.replace(/, $/, "") : "Unknown patient";

  // ?edit=1 (Fix & resume): open edit mode once the referral is reviewable, then drop the flag.
  useEffect(() => {
    if (params.get("edit") !== "1" || record.status === "processing") return;
    const next = new URLSearchParams(params);
    next.delete("edit");
    setParams(next, { replace: true });
    if (REVIEWABLE.includes(record.status)) editor.start();
    else notify.info(`Editing is only possible while a referral needs review. This one is ${STATUS[record.status].label.toLowerCase()}.`);
    // Runs when the flag or the status changes.
  }, [params, record.status]);

  // Someone else moved it on (or approve went through): leave edit mode.
  useEffect(() => {
    if (editor.editing && !REVIEWABLE.includes(record.status)) editor.cancel();
  }, [record.status]);

  const selectFromFax = (field: string | null) => {
    setSelected(field);
    if (field) document.getElementById(`row-${field}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const fixField = (field: string) => {
    setSelected(field);
    if (!editor.editing) editor.start();
    requestAnimationFrame(() => document.getElementById(`input-${field}`)?.focus());
  };

  useHotkeys(
    {
      e: () => {
        if (actions.canEdit && !editor.editing && !actions.busy) editor.start();
      },
      a: () => {
        if (!editor.editing) actions.approve();
      },
      r: () => {
        if (actions.canReject && !editor.editing && !actions.busy) setRejectOpen(true);
      },
      Escape: () => {
        if (editor.editing) editor.cancel();
        else if (selected) setSelected(null);
        else navigate(queueHref());
      },
      "mod+Enter": () => {
        if (editor.editing) editor.save();
      },
    },
    { allowInInputs: ["Escape", "mod+Enter"] },
  );

  const showPacket = record.packet_available || !!record.auth?.required;

  return (
    <>
      <SplitPane
        left={
          <Suspense fallback={<FaxFallback />}>
            <FaxViewer
              url={faxUrl(record.id)}
              boxes={r.boxes ?? {}}
              activeField={hovered ?? selected}
              selectedField={selected}
              onSelectField={selectFromFax}
              onHoverField={setHovered}
              labelFor={labelFor}
            />
          </Suspense>
        }
        right={
          <>
            <header className="shrink-0 border-b border-border px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Tip content="Back to the queue (esc)">
                  <Button variant="ghost" size="icon" className="-ml-1.5 size-7 shrink-0" asChild>
                    <Link to={queueHref()} aria-label="Back to the queue">
                      <ArrowLeft />
                    </Link>
                  </Button>
                </Tip>
                <h1 className="truncate text-lg font-semibold">{patient}</h1>
                <span data-testid="detail-status" className="shrink-0">
                  <StatusBadge status={record.status} />
                </span>
                <Link
                  to={`/graph?referral=${record.id}`}
                  className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-sm text-accent hover:underline"
                >
                  <Waypoints className="size-4" aria-hidden />
                  View pipeline graph
                </Link>
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 pl-7 text-xs text-fg-muted">
                <span className="truncate">{record.source_name}</span>
                <span aria-hidden>·</span>
                <span>
                  Pipeline <Code>{record.pipeline}</Code>
                </span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">Received {fmtDateTime(record.created_at)}</span>
                <span aria-hidden>·</span>
                <span>
                  ID <Code>{record.id}</Code>
                </span>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <StatusBanner record={record} />
              <FieldsPanel
                record={record}
                editor={editor}
                selected={selected}
                hovered={hovered}
                onSelect={setSelected}
                onHover={setHovered}
                corrections={corrections}
              />
              <EligibilityPanel record={record} />
              <PolicyPanel record={record} compareOpen={compareOpen} onToggleCompare={() => setCompareOpen((v) => !v)} />
              {compareOpen && <ComparePanel id={record.id} onClose={() => setCompareOpen(false)} />}
              {showPacket && (
                <Section
                  id="packet"
                  title="Prior-auth packet"
                  meta={record.packet_available ? "Built by the pipeline" : "Built on request"}
                  actions={
                    <Button variant="ghost" size="sm" asChild>
                      <a href={packetUrl(record.id)} target="_blank" rel="noreferrer">
                        Open PDF
                        <ExternalLink aria-hidden />
                      </a>
                    </Button>
                  }
                >
                  <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                    <PdfPreview url={packetUrl(record.id)} title="Prior-auth packet" />
                  </Suspense>
                </Section>
              )}
              <OrderPanel record={record} actions={actions} />
              <HistoryPanel reviews={record.reviews} corrections={corrections} />
            </div>

            <ActionsBar
              record={record}
              editor={editor}
              actions={actions}
              onReject={() => setRejectOpen(true)}
              onFixField={fixField}
            />
          </>
        }
      />
      <RejectDialog open={rejectOpen} onOpenChange={setRejectOpen} patient={patient} pending={actions.rejecting} onReject={actions.reject} />
    </>
  );
}

function FaxFallback() {
  return (
    <div className="flex h-full flex-col" data-testid="fax-viewer" aria-busy>
      <div className="h-10 shrink-0 border-b border-border bg-surface" />
      <div className="flex-1 bg-surface-2 p-4">
        <Skeleton className="h-full w-full bg-border" />
      </div>
    </div>
  );
}
