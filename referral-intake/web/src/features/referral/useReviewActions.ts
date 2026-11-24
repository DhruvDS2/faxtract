import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { keys, useApprove, useReject, useRetrySend } from "@/api/queries";
import { REJECTABLE, RETRYABLE, REVIEWABLE, type Flag, type ReferralRecord } from "@/contracts";
import { plural } from "./format";
import { notify } from "./notify";

export type ReviewActions = ReturnType<typeof useReviewActions>;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Approve / reject / retry-send, with 409 handling. Approve's progress is narrated by
 * the header (useApproveFlow), so success here is quiet; failures toast.
 */
export function useReviewActions(id: string, record: ReferralRecord | undefined) {
  const qc = useQueryClient();
  const approveM = useApprove(id);
  const rejectM = useReject(id);
  const retryM = useRetrySend(id);
  /** Error-severity flags the server said block approval (409). */
  const [blocking, setBlocking] = useState<Flag[]>([]);

  const refetch = () => void qc.invalidateQueries({ queryKey: keys.referral(id) });

  const status = record?.status;
  const canApprove = !!status && REVIEWABLE.includes(status);
  const canEdit = canApprove;
  const canReject = !!status && REJECTABLE.includes(status);
  const canRetry = !!status && RETRYABLE.includes(status);
  const busy = approveM.isPending || rejectM.isPending || retryM.isPending;

  /** Resolves true when the server took the approval (whatever the RIS then did). */
  const approve = async (): Promise<boolean> => {
    if (!canApprove || busy) return false;
    setBlocking([]);
    try {
      const rec = await approveM.mutateAsync({});
      if (rec.status === "ris_error") notify.error("Approved, but the RIS didn't acknowledge", { description: rec.order.last_error ?? undefined });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const flags = err.body?.flags ?? [];
        setBlocking(flags);
        if (!flags.length) notify.error("Couldn't approve", { description: err.message });
        refetch();
      } else notify.error("Couldn't approve", { description: message(err) });
      return false;
    }
  };

  /** Resolves to an error message for the dialog to show, or null on success. */
  const reject = async (reason: string): Promise<string | null> => {
    try {
      await rejectM.mutateAsync({ reason });
      setBlocking([]);
      notify.success("Referral rejected", { description: "No order goes to the RIS." });
      return null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) return err.body?.errors[0]?.message ?? err.message;
      if (err instanceof ApiError && err.status === 409) {
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
        else notify.error("RIS still didn't acknowledge", { description: rec.order.last_error ?? undefined });
      },
      onError: (err) => {
        notify.error("Couldn't retry the send", { description: message(err) });
        if (err instanceof ApiError && err.status === 409) refetch();
      },
    });
  };

  return {
    approve,
    reject,
    retry,
    blocking,
    blockingSummary: blocking.length ? `${plural(blocking.length, "validation error")} must be fixed first` : null,
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
