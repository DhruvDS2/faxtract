import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RETRYABLE, type ReferralRecord, type RisOrderRow } from "@/contracts";
import { keys, useRetrySend } from "@/api/queries";
import { describeError } from "@/components/States";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

/** Put the record the retry returned into the cached orders at once, so the row changes in place. */
function patchOrders(qc: ReturnType<typeof useQueryClient>, rec: ReferralRecord) {
  qc.setQueryData<RisOrderRow[]>(keys.orders, (rows) =>
    rows?.map((r) =>
      r.referral_id === rec.id
        ? {
            ...r,
            status: rec.status,
            order_id: rec.order.order_id ?? r.order_id,
            ack_code: rec.order.ack_code,
            attempts: rec.order.attempts,
            last_error: rec.order.last_error,
            sent_at: rec.order.sent_at ?? r.sent_at,
            in_ris: rec.status === "sent_to_ris" || r.in_ris,
            retryable: RETRYABLE.includes(rec.status),
          }
        : r,
    ),
  );
}

/**
 * The row's quick action (Terminal Industries): one quiet "Retry send". While it
 * runs the row reads "Sending to RIS"; the answer replaces the row's status in place.
 */
export function RetrySend({ row, onPending }: { row: RisOrderRow; onPending: (row: RisOrderRow, pending: boolean) => void }) {
  const retry = useRetrySend(row.referral_id);
  const qc = useQueryClient();
  const order = row.order_id ?? "the order";
  // the status cell reads "Sending to RIS" while this is in flight (and never after this unmounts)
  const pending = retry.isPending;
  useEffect(() => {
    onPending(row, pending);
    if (pending) return () => onPending(row, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
  return (
    <Button
      variant="quiet"
      size="sm"
      data-testid="btn-retry"
      loading={retry.isPending}
      loadingText="Sending…"
      aria-label={`Retry send for ${row.patient_name ?? order}`}
      onClick={() => {
        retry.mutate(undefined, {
          onSuccess: (rec) => {
            patchOrders(qc, rec);
            if (rec.order.ack_code === "AA") toast.success(`${rec.order.order_id ?? "Order"} sent`, { description: "The RIS acknowledged it (AA)." });
            else
              toast.error(rec.order.ack_code ? `The RIS rejected ${order} (${rec.order.ack_code})` : `The RIS still didn't acknowledge ${order}`, {
                description: rec.order.last_error ?? undefined,
              });
          },
          onError: (err) => toast.error("Couldn't retry the send", { description: describeError(err).cause }),
        });
      }}
    >
      Retry send
    </Button>
  );
}
