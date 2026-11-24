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

/** Reject needs a reason (the API answers 422 without one). */
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
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Reject this referral?</DialogTitle>
            <DialogDescription>
              {patient} leaves the review queue and no order goes to the RIS. The reason is saved with the review, for the referring office.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              data-testid="reject-reason"
              required
              rows={3}
              value={reason}
              placeholder="e.g. Coverage terminated. Ask the office for the patient's current insurance."
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
              <p id="reject-reason-error" className="text-meta text-bad" role="alert">
                {error ?? "Add a reason to reject."}
              </p>
            ) : (
              <p id="reject-reason-hint" className="flex items-center gap-1 text-meta text-fg-muted">
                Required. <Kbd>{MOD_KEY}</Kbd>
                <Kbd>↵</Kbd> rejects.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => change(false)}>
              Keep it
            </Button>
            <Button type="submit" variant="danger" data-testid="btn-reject-confirm" disabled={empty} loading={pending} loadingText="Rejecting…">
              Reject referral
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
