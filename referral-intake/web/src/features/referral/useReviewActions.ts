import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { keys, useApprove, useReject, useRetrySend } from "@/api/queries";
import { REJECTABLE, RETRYABLE, REVIEWABLE, type Flag, type ReferralRecord } from "@/contracts";
import { notify } from "./notify";
import { STATUS } from "@/lib/status";
import { plural } from "./format";

export type ReviewActions = ReturnType<typeof useReviewActions>;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Approve / reject / retry-send with the toasts and 409 handling the detail screen needs. */
export function useReviewActions(record: ReferralRecord) {
  const id = record.id;
  const qc = useQueryClient();
  const approveM = useApprove(id);
  const rejectM = useReject(id);
  const retryM = useRetrySend(id);
  /** Error-severity flags the server said block approval (409). */
  const [blocking, setBlocking] = useState<Flag[]>([]);

  const refetch = () => void qc.invalidateQueries({ queryKey: keys.referral(id) });

  const canApprove = REVIEWABLE.includes(record.status);
  const canEdit = REVIEWABLE.includes(record.status);
  const canReject = REJECTABLE.includes(record.status);
  const canRetry = RETRYABLE.includes(record.status);
  const busy = approveM.isPending || rejectM.isPending || retryM.isPending;

  const approve = () => {
    if (!canApprove || busy) return;
    setBlocking([]);
    approveM.mutate(
      {},
      {
        onSuccess: (rec) => {
          if (rec.status === "sent_to_ris")
            notify.success("Approved and sent to RIS", { description: `RIS acknowledged the order (${rec.order.ack_code ?? "no ACK code"}).` });
          else if (rec.status === "ris_error")
            notify.error("Approved, but the RIS did not take the order", { description: rec.order.last_error ?? undefined });
          else notify.success(`Approved · ${STATUS[rec.status].label}`);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            const flags = err.body?.flags ?? [];
            setBlocking(flags);
            notify.error("Approve blocked", {
              description: flags.length ? `${plural(flags.length, "validation error")} must be fixed first.` : err.message,
            });
            refetch();
          } else notify.error("Approve failed", { description: message(err) });
        },
      },
    );
  };

  /** Resolves to an error message for the dialog to show, or null on success. */
  const reject = async (reason: string): Promise<string | null> => {
    try {
      const rec = await rejectM.mutateAsync({ reason });
      setBlocking([]);
      notify.success("Referral rejected", { description: rec.reviews.at(-1)?.note ?? reason });
      return null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) return err.body?.errors[0]?.message ?? err.message;
      if (err instanceof ApiError && err.status === 409) {
        notify.error("Can't reject", { description: err.message });
        refetch();
        return err.message;
      }
      return message(err);
    }
  };

  const retry = () => {
    if (!canRetry || busy) return;
    retryM.mutate(undefined, {
      onSuccess: (rec) => {
        if (rec.status === "sent_to_ris")
          notify.success("Order sent", { description: `RIS acknowledged it (${rec.order.ack_code ?? "no ACK code"}) on attempt ${rec.order.attempts}.` });
        else notify.error("Retry failed", { description: rec.order.last_error ?? STATUS[rec.status].label });
      },
      onError: (err) => {
        notify.error("Retry failed", { description: message(err) });
        if (err instanceof ApiError && err.status === 409) refetch();
      },
    });
  };

  return {
    approve,
    reject,
    retry,
    blocking,
    clearBlocking: () => setBlocking([]),
    canApprove,
    canEdit,
    canReject,
    canRetry,
    approving: approveM.isPending,
    rejecting: rejectM.isPending,
    retrying: retryM.isPending,
    busy,
  };
}
