import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { ReferralRecord, ReferralSummary } from "@/contracts";
import { keys, useRetrySend } from "@/api/queries";
import { describeError } from "@/components/States";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

/**
 * The row's one quiet action (Terminal Industries): "Review" on a referral that
 * needs a person, "Retry send" on one the RIS didn't take. Shown on hover, focus
 * or selection by <DataTable quickAction>.
 */
export function QuickAction({ row, onOpen, onRetryStart }: { row: ReferralSummary; onOpen: (id: string) => void; onRetryStart: (row: ReferralSummary) => void }) {
  if (row.status === "needs_review")
    return (
      <Button asChild variant="quiet" size="sm">
        <Link to={`/referrals/${row.id}`} onClick={() => onOpen(row.id)} aria-label={`Review ${row.patient_name ?? row.source_name}`}>
          Review
        </Link>
      </Button>
    );
  if (row.status === "ris_error") return <RetrySend row={row} onStart={onRetryStart} />;
  return null;
}

/** Put the record the retry returned into the cached queue at once, so the row changes in place. */
function patchQueue(qc: ReturnType<typeof useQueryClient>, rec: ReferralRecord) {
  qc.setQueryData<ReferralSummary[]>(keys.referrals(), (rows) =>
    rows?.map((r) => (r.id === rec.id ? { ...r, status: rec.status, ack_code: rec.order.ack_code, updated_at: rec.updated_at } : r)),
  );
}

function RetrySend({ row, onStart }: { row: ReferralSummary; onStart: (row: ReferralSummary) => void }) {
  const retry = useRetrySend(row.id);
  const qc = useQueryClient();
  const who = row.patient_name ?? row.source_name;
  return (
    <Button
      variant="quiet"
      size="sm"
      loading={retry.isPending}
      loadingText="Sending…"
      aria-label={`Retry send for ${who}`}
      onClick={() => {
        onStart(row);
        retry.mutate(undefined, {
          onSuccess: (rec) => {
            patchQueue(qc, rec);
            if (rec.status === "sent_to_ris") toast.success(`Order sent for ${who}`, { description: `The RIS acknowledged it (${rec.order.ack_code ?? "AA"}).` });
            else toast.error(`The RIS still didn't take the order for ${who}`, { description: rec.order.last_error ?? undefined });
          },
          onError: (err) => toast.error("Couldn't retry the send", { description: describeError(err).cause }),
        });
      }}
    >
      Retry send
    </Button>
  );
}
