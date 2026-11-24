import { CircleX, RotateCw } from "lucide-react";
import type { ReferralRecord } from "@/contracts";
import { useOrderPreview } from "@/api/queries";
import { Code, CodeBlock } from "@/components/Code";
import { AckBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDateTime } from "@/lib/format";
import { ACK_MEANING, hl7Lines, plural } from "./format";
import { Section } from "./Section";
import type { ReviewActions } from "./useReviewActions";

/** HL7 ORM^O01 (sent, or a preview of what would be sent) and the RIS ACK. */
export function OrderPanel({ record, actions }: { record: ReferralRecord; actions: ReviewActions }) {
  const order = record.order;
  const ready = record.status !== "processing" && record.status !== "failed";
  // The stored message wins; otherwise ask the API what it would send.
  const preview = useOrderPreview(!order.message && ready ? record.id : undefined);
  const message = order.message ?? preview.data?.message ?? null;
  const orderId = order.order_id ?? preview.data?.order_id ?? null;
  const sent = order.attempts > 0;

  return (
    <Section
      id="order"
      title="HL7 order and RIS ACK"
      meta={orderId && <Code>{orderId}</Code>}
      actions={
        <Badge tone={sent ? "outline" : "idle"}>
          {sent ? `${plural(order.attempts, "attempt")}${order.sent_at ? ` · last ${fmtDateTime(order.sent_at)}` : ""}` : "Not sent"}
        </Badge>
      }
    >
      <div className="mb-1 flex items-center gap-2 text-xs text-fg-muted">
        <span className="font-medium text-fg">ORM^O01</span>
        <span>{order.message ? "as sent" : "preview of what approval sends"}</span>
      </div>
      <div data-testid="order-message">
        {message ? (
          <CodeBlock lines={hl7Lines(message)} className="max-h-72 overflow-y-auto" />
        ) : !ready ? (
          <p className="text-sm text-fg-muted">The order is built after the pipeline finishes.</p>
        ) : preview.isPending ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-2 p-2" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-3 w-full bg-border" />
            ))}
          </div>
        ) : (
          <p className="text-sm text-bad" role="alert">
            Could not build the order preview{preview.error instanceof Error ? `: ${preview.error.message}` : "."}
          </p>
        )}
      </div>

      <div className="mt-3" data-testid="order-ack">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">RIS ACK</span>
          {order.ack_code ? (
            <>
              <AckBadge code={order.ack_code} />
              <span className="text-sm text-fg-muted">{ACK_MEANING[order.ack_code]}</span>
            </>
          ) : (
            <span className="text-sm text-fg-muted">{sent ? "No ACK received" : "Not sent yet. Approving sends this order to the RIS."}</span>
          )}
        </div>
        {order.ack_raw && <CodeBlock lines={hl7Lines(order.ack_raw)} className="mt-1" />}
      </div>

      {order.last_error && (
        <div className="mt-3 flex items-start gap-2" role="alert">
          <CircleX className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            <span className="text-bad">{order.last_error}</span>
            <span className="text-fg-muted"> · attempt {order.attempts}</span>
          </div>
          {actions.canRetry && (
            <Button size="sm" data-testid="order-retry-send" onClick={actions.retry} disabled={actions.busy}>
              <RotateCw aria-hidden />
              {actions.retrying ? "Sending…" : "Retry send"}
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}
