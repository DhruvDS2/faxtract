import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MOD_KEY } from "./format";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: string;
  pending: boolean;
  onReject: (reason: string) => Promise<string | null>;
};

/** Reject needs a reason (the API returns 422 without one). */
export function RejectDialog({ open, onOpenChange, patient, pending, onReject }: Props) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const empty = !reason.trim();

  const change = (next: boolean) => {
    if (!next) {
      setReason("");
      setError(null);
      setTouched(false);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    setTouched(true);
    if (empty || pending) return;
    const err = await onReject(reason.trim());
    if (err) setError(err);
    else change(false);
  };

  const showRequired = touched && empty;
  const describedBy = error || showRequired ? "reject-reason-error" : "reject-reason-hint";

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Reject referral</DialogTitle>
            <DialogDescription>
              {patient} leaves the queue and no order is sent to the RIS. The reason is stored with the review.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              data-testid="reject-reason"
              required
              rows={3}
              value={reason}
              placeholder="e.g. Coverage terminated; patient to bring a new insurance card"
              aria-invalid={!!error || showRequired || undefined}
              aria-describedby={describedBy}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            {error || showRequired ? (
              <p id="reject-reason-error" className="text-xs text-bad" role="alert">
                {error ?? "A reason is required."}
              </p>
            ) : (
              <p id="reject-reason-hint" className="text-xs text-fg-muted">
                Required. <Kbd>{MOD_KEY}</Kbd> <Kbd>↵</Kbd> to reject.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => change(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" data-testid="btn-reject-confirm" disabled={empty || pending}>
              {pending ? "Rejecting…" : "Reject referral"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
