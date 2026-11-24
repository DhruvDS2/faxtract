import { Suspense, lazy } from "react";
import { ExternalLink } from "lucide-react";
import type { Correction, ReferralRecord } from "@/contracts";
import { packetUrl } from "@/api/client";
import { useOrderPreview, usePolicy } from "@/api/queries";
import { Accordion, AccordionItem } from "@/components/Accordion";
import { Code } from "@/components/Code";
import { CodeViewer } from "@/components/CodeViewer";
import { ErrorState } from "@/components/States";
import { AckBadge } from "@/components/StatusBadge";
import { StatusDot } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtConfidence, fmtDateTime } from "@/lib/format";
import type { StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { ComparePanel } from "./ComparePanel";
import { Excerpt } from "./Excerpt";
import { fieldMeta } from "./fields";
import { ACK_MEANING, ELIGIBILITY, fmtMoney, fmtPercent, fmtWhen, listOf, plural, words } from "./format";
import type { PanelId } from "./reasons";
import type { ReviewActions } from "./useReviewActions";

const PdfPreview = lazy(() => import("./PdfPreview"));

export const panelDomId = (p: PanelId) => `panel-${p}`;
export const ACK_ID = "order-ack-block";

type Props = {
  record: ReferralRecord;
  actions: ReviewActions;
  corrections: Correction[] | undefined;
  value: string;
  onValueChange: (v: string) => void;
  compareOpen: boolean;
  onToggleCompare: () => void;
};

function Summary({ tone, children }: { tone?: StatusTone; children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      {tone && <StatusDot tone={tone} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

const pipelineDone = (r: ReferralRecord) => r.status !== "processing" && r.status !== "failed";

/** Detail panels (Calendly): one open at a time, each header with its one-line summary. */
export function Panels({ record, actions, corrections, value, onValueChange, compareOpen, onToggleCompare }: Props) {
  const e = record.eligibility;
  const auth = record.auth;
  const order = record.order;
  const ready = pipelineDone(record);
  const history = record.reviews.length + (corrections?.length ?? 0);

  const policySummary = !auth
    ? "Not checked yet"
    : !auth.required
      ? "Not required"
      : auth.missing_elements.length
        ? `Required · ${words(listOf(auth.missing_elements))} missing`
        : `Required · ${plural(record.citations.length, "citation")}`;

  const orderSummary =
    order.attempts === 0 ? (
      <Summary>Not sent yet</Summary>
    ) : order.ack_code ? (
      <Summary tone={order.ack_code === "AA" ? "ok" : "bad"}>
        ACK {order.ack_code} · {plural(order.attempts, "attempt")}
      </Summary>
    ) : (
      <Summary tone="bad">No ACK · {plural(order.attempts, "attempt")}</Summary>
    );

  return (
    <Accordion value={value} onValueChange={onValueChange}>
      <AccordionItem
        value="eligibility"
        id={panelDomId("eligibility")}
        className="scroll-mt-2"
        title="Eligibility (270/271)"
        summary={e ? <Summary tone={ELIGIBILITY[e.status].tone}>{ELIGIBILITY[e.status].label}</Summary> : <Summary>Not checked yet</Summary>}
      >
        <EligibilityBody record={record} />
      </AccordionItem>
      <AccordionItem
        value="policy"
        id={panelDomId("policy")}
        className="scroll-mt-2"
        title="Prior auth & policy"
        summary={<Summary tone={auth?.required && auth.missing_elements.length ? "warn" : undefined}>{policySummary}</Summary>}
      >
        <PolicyBody record={record} ready={ready} compareOpen={compareOpen} onToggleCompare={onToggleCompare} />
      </AccordionItem>
      <AccordionItem
        value="packet"
        id={panelDomId("packet")}
        className="scroll-mt-2"
        title="Auth packet"
        summary={<Summary>{record.packet_available ? "Ready" : auth?.required ? "Built when opened" : "Not needed"}</Summary>}
      >
        <PacketBody record={record} />
      </AccordionItem>
      <AccordionItem value="order" id={panelDomId("order")} className="scroll-mt-2" title="HL7 order & RIS ACK" summary={orderSummary}>
        <OrderBody record={record} actions={actions} ready={ready} />
      </AccordionItem>
      {history > 0 && (
        <AccordionItem
          value="history"
          id={panelDomId("history")}
          className="scroll-mt-2"
          title="Review history"
          summary={<Summary>{plural(history, "event")}</Summary>}
        >
          <HistoryBody record={record} corrections={corrections} />
        </AccordionItem>
      )}
    </Accordion>
  );
}

// ---------- eligibility ----------

function EligibilityBody({ record }: { record: ReferralRecord }) {
  const e = record.eligibility;
  if (!e)
    return (
      <p className="text-body text-fg-muted">
        {record.status === "processing" ? "The eligibility check hasn't run yet." : "No eligibility result was recorded."}
      </p>
    );
  const payor = e.payor_name ?? record.referral.payor_name ?? "The payor";
  const plan = e.plan_name ? (
    <>
      {" "}
      on <span className="text-fg">{e.plan_name}</span>
    </>
  ) : null;
  const member = record.referral.member_id;
  const sentence =
    e.status === "active_in_network" ? (
      <>
        {payor} reports the member active and in network{plan}.
      </>
    ) : e.status === "active_out_of_network" ? (
      <>
        {payor} reports the member active but out of network{plan}.
      </>
    ) : e.status === "terminated" ? (
      <>{payor} reports this coverage as terminated. Ask the referring office for current insurance before scheduling.</>
    ) : (
      <>
        {payor} couldn't find member {member ? <Code className="text-fg">{member}</Code> : "this member"}. Check the member ID against the card on the fax.
      </>
    );
  const money = [
    fmtMoney(e.deductible_remaining) && `${fmtMoney(e.deductible_remaining)} deductible remaining`,
    fmtPercent(e.coinsurance_percent) && `${fmtPercent(e.coinsurance_percent)} coinsurance`,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-body text-fg">{sentence}</p>
        {money.length > 0 && <p className="mt-1 text-body text-fg-muted tabular-nums">{money.join(" · ")}</p>}
      </div>
      {e.raw_271 ? (
        <CodeViewer code={e.raw_271} format="x12" label="X12 271 · as received from the payor" />
      ) : (
        <p className="text-meta text-fg-faint">No raw 271 was stored.</p>
      )}
    </div>
  );
}

// ---------- prior auth & policy ----------

function PolicyBody({ record, ready, compareOpen, onToggleCompare }: { record: ReferralRecord; ready: boolean; compareOpen: boolean; onToggleCompare: () => void }) {
  const policy = usePolicy(record.id, ready);
  const auth = record.auth;
  const citations = policy.data?.citations ?? record.citations;
  const keywords = policy.data?.keywords ?? record.keywords;

  const sentence = !auth ? (
    "The prior-auth check hasn't run yet."
  ) : !auth.required ? (
    "No prior auth is required for this study."
  ) : (
    <>
      Prior auth is required
      {auth.submission_channel ? `; submit through the ${auth.submission_channel}` : ""}
      {auth.turnaround_days != null ? `, about ${plural(auth.turnaround_days, "day")} turnaround` : ""}.{" "}
      {auth.missing_elements.length > 0 && (
        <span className="text-fg">
          Missing for the packet: {listOf(auth.missing_elements.map(words))}.
        </span>
      )}
    </>
  );

  return (
    <div className="flex flex-col">
      <p className="text-body text-fg-muted">{sentence}</p>

      <div className="mt-4 flex items-baseline gap-4">
        <h4 className="text-meta font-medium text-fg-muted">Policy citations</h4>
        {keywords.length > 0 && <span className="min-w-0 truncate text-meta text-fg-faint">matched on {keywords.join(", ")}</span>}
      </div>
      {!ready ? (
        <p className="mt-1 text-body text-fg-muted">Citations appear once the pipeline has finished.</p>
      ) : policy.isPending && !citations.length ? (
        <div className="mt-2 flex flex-col gap-2" aria-busy>
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-2.5 w-1/2" />
              <Skeleton className="h-2.5 w-4/5" />
            </div>
          ))}
        </div>
      ) : policy.isError && !citations.length ? (
        <ErrorState error={policy.error} title="Couldn't load the policy citations" align="start" className="py-4" onRetry={() => void policy.refetch()} />
      ) : citations.length === 0 ? (
        <p className="mt-1 text-body text-fg-muted">
          {auth && !auth.required ? "No prior auth is required, so no policy was retrieved." : "Retrieval returned no policy chunks."}
        </p>
      ) : (
        <ol className="mt-1 flex flex-col divide-y divide-border">
          {citations.map((c, i) => (
            <li key={i} className="py-2">
              <div className="flex min-w-0 items-baseline gap-3 text-meta text-fg-muted">
                <Code className="min-w-0 truncate text-fg" title={c.source}>
                  {c.source}
                </Code>
                {(c.payor || c.cpt) && (
                  <span className="shrink-0">
                    {c.payor}
                    {c.payor && c.cpt && " · "}
                    {c.cpt && (
                      <>
                        CPT <Code>{c.cpt}</Code>
                      </>
                    )}
                  </span>
                )}
                <span className="ml-auto shrink-0 tabular-nums">score {c.score.toFixed(3)}</span>
              </div>
              <Excerpt text={c.text} lines={2} />
            </li>
          ))}
        </ol>
      )}

      <div className="mt-3">
        <Button
          variant="secondary"
          size="sm"
          data-testid="btn-compare"
          aria-expanded={compareOpen}
          aria-controls="compare"
          onClick={onToggleCompare}
          disabled={!ready}
        >
          {compareOpen ? "Hide the comparison" : "Compare v1 vs v2"}
        </Button>
      </div>
      {compareOpen && <ComparePanel id={record.id} onClose={onToggleCompare} />}
    </div>
  );
}

// ---------- auth packet ----------

function PacketBody({ record }: { record: ReferralRecord }) {
  if (!record.packet_available && !record.auth?.required)
    return <p className="text-body text-fg-muted">No prior auth is required, so there's no packet to send.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-4">
        <p className="text-body text-fg-muted">
          {record.packet_available ? "Built by the pipeline from the fax, the 271 and the cited policy." : "Built from the fax when you open it."}
        </p>
        <Button variant="ghost" size="sm" className="ml-auto" asChild>
          <a href={packetUrl(record.id)} target="_blank" rel="noreferrer">
            Open PDF
            <ExternalLink aria-hidden />
          </a>
        </Button>
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <PdfPreview url={packetUrl(record.id)} title="The auth packet" />
      </Suspense>
    </div>
  );
}

// ---------- HL7 order & RIS ACK ----------

function OrderBody({ record, actions, ready }: { record: ReferralRecord; actions: ReviewActions; ready: boolean }) {
  const order = record.order;
  // The stored message wins; otherwise ask the API what Approve would send.
  const preview = useOrderPreview(!order.message && ready ? record.id : undefined);
  const message = order.message ?? preview.data?.message ?? null;
  const orderId = order.order_id ?? preview.data?.order_id ?? null;
  const sent = order.attempts > 0;
  const label = (
    <>
      ORM^O01{orderId && <> · {orderId}</>} · {order.message ? `as sent${order.sent_at ? ` ${fmtWhen(order.sent_at)}` : ""}` : "preview of what Approve sends"}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <div data-testid="order-message">
        {message ? (
          <CodeViewer code={message} format="hl7" label={label} />
        ) : !ready ? (
          <p className="text-body text-fg-muted">The order is built once the pipeline finishes.</p>
        ) : preview.isPending ? (
          <div className="flex flex-col gap-2 rounded-md bg-surface p-3" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-2.5 w-full" />
            ))}
          </div>
        ) : (
          <p className="text-body text-bad" role="alert">
            Couldn't build the order preview{preview.error instanceof Error ? `: ${preview.error.message}` : "."}
          </p>
        )}
      </div>

      <div data-testid="order-ack" id={ACK_ID} className="scroll-mt-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-body font-medium text-fg">RIS ACK</span>
          {order.ack_code ? (
            <>
              <AckBadge code={order.ack_code} />
              <span className="text-body text-fg-muted">
                The RIS {ACK_MEANING[order.ack_code] === "accepted" ? "accepted the order" : `answered ${ACK_MEANING[order.ack_code]}`}
              </span>
            </>
          ) : (
            <span className="text-body text-fg-muted">{sent ? "No ACK came back" : "Not sent yet. Approve sends this order to the RIS."}</span>
          )}
        </div>
        {order.ack_raw && <CodeViewer code={order.ack_raw} format="hl7" className="mt-2" />}
      </div>

      {record.status === "ris_error" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" role="alert">
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium text-bad">RIS didn't acknowledge. Retry send.</p>
            {order.last_error && <p className="font-mono text-code break-words text-fg-faint">{order.last_error}</p>}
          </div>
          {actions.canRetry && (
            <Button size="sm" variant="secondary" data-testid="order-retry-send" loading={actions.retrying} loadingText="Sending…" onClick={actions.retry} disabled={actions.busy}>
              Retry send
            </Button>
          )}
        </div>
      )}

      {sent && (
        <p className="text-meta text-fg-muted tabular-nums">
          {plural(order.attempts, "attempt")}
          {order.sent_at && ` · last sent ${fmtDateTime(order.sent_at)}`}
        </p>
      )}
    </div>
  );
}

// ---------- history ----------

const ACTION: Record<ReferralRecord["reviews"][number]["action"], string> = {
  edit: "Edited",
  approve: "Approved",
  reject: "Rejected",
  retry_send: "Retried the send",
};

function HistoryBody({ record, corrections }: { record: ReferralRecord; corrections: Correction[] | undefined }) {
  const fixes = corrections ?? [];
  return (
    <div className="flex flex-col gap-4">
      {record.reviews.length > 0 && (
        <ol className="flex flex-col gap-1">
          {record.reviews.map((r, i) => (
            <li key={i} className="grid grid-cols-[var(--kv-label)_minmax(0,1fr)] items-baseline gap-4">
              <span className="text-meta text-fg-muted tabular-nums">{fmtDateTime(r.at)}</span>
              <span className="min-w-0 text-body">
                <span className="font-medium text-fg">{ACTION[r.action]}</span>
                <span className="text-fg-muted"> by {r.reviewer ?? "an unnamed reviewer"}</span>
                {r.fields.length > 0 && <span className="text-fg-muted"> · {r.fields.map((f) => fieldMeta(f).label).join(", ")}</span>}
                {r.note && <span className="block text-fg-muted wrap-anywhere">{r.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {fixes.length > 0 && (
        <div>
          <h4 className="pb-1 text-meta font-medium text-fg-muted">Corrections</h4>
          <ol className="flex flex-col gap-1">
            {fixes.map((c, i) => (
              <li key={i} className="grid grid-cols-[var(--kv-label)_minmax(0,1fr)] items-baseline gap-4">
                <span className="text-meta text-fg-muted tabular-nums">{fmtDateTime(c.corrected_at)}</span>
                <span className="min-w-0 text-body wrap-anywhere">
                  <span className="font-medium text-fg">{fieldMeta(c.field).label}</span>
                  <span className="text-fg-muted">: </span>
                  <span className={cn("text-fg-muted line-through decoration-fg-faint")}>{c.original_value ?? "empty"}</span>
                  <span className="text-fg-muted"> → </span>
                  <span className="text-fg">{c.corrected_value ?? "empty"}</span>
                  {c.original_confidence != null && <span className="text-meta text-fg-faint"> · was {fmtConfidence(c.original_confidence)}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
