import { useEffect, useRef } from "react";
import { Check, CircleX, Pencil, RotateCw, X } from "lucide-react";
import type { ReferralRecord } from "@/contracts";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { fieldMeta } from "./fields";
import { MOD_KEY, plural } from "./format";
import type { FieldEditor } from "./useFieldEditor";
import type { ReviewActions } from "./useReviewActions";

type Props = {
  record: ReferralRecord;
  editor: FieldEditor;
  actions: ReviewActions;
  onReject: () => void;
  onFixField: (field: string) => void;
};

function Hint({ k, children }: { k: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {k}
      <span>{children}</span>
    </span>
  );
}

const RESTING: Partial<Record<ReferralRecord["status"], string>> = {
  processing: "The pipeline is still running. Review actions unlock when it pauses.",
  approved: "Approved. Sending the order to the RIS…",
  auto_approved: "Auto-approved by the gate. Sending the order to the RIS…",
  sent_to_ris: "Sent to RIS. No review actions left.",
  rejected: "Rejected. No review actions left.",
  failed: "The pipeline failed on this fax. Upload it again to retry.",
};

/** The sticky review bar at the bottom of the detail column. */
export function ActionsBar({ record, editor, actions, onReject, onFixField }: Props) {
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editor.editing);

  // Leaving edit mode returns focus to the Edit button.
  useEffect(() => {
    if (wasEditing.current && !editor.editing) editButton.current?.focus();
    wasEditing.current = editor.editing;
  }, [editor.editing]);

  return (
    <div className="shrink-0 border-t border-border bg-bg">
      {actions.blocking.length > 0 && !editor.editing && (
        <div className="border-b border-bad-border bg-bad-bg px-4 py-2" role="alert">
          <div className="flex items-center gap-2 text-sm font-medium text-bad">
            <CircleX className="size-4" aria-hidden />
            Approve blocked by {plural(actions.blocking.length, "validation error")}
            <Button variant="ghost" size="icon" className="ml-auto size-6" aria-label="Dismiss" onClick={actions.clearBlocking}>
              <X />
            </Button>
          </div>
          <ul className="mt-1 flex flex-col gap-0.5 pl-6 text-sm">
            {actions.blocking.map((f, i) => (
              <li key={i}>
                <button type="button" className="text-left text-fg hover:underline" onClick={() => onFixField(f.field)}>
                  <span className="font-medium">{fieldMeta(f.field).label}</span>
                  <span className="text-fg-muted">: {f.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex min-h-12 items-center gap-3 px-4 py-2">
        {editor.editing ? (
          <>
            <div className="flex min-w-0 items-center gap-3 overflow-hidden text-xs text-fg-muted">
              <span className="truncate font-medium text-fg">
                {editor.changed.length ? plural(editor.changed.length, "unsaved change") : "No changes yet"}
              </span>
              <Hint k={<><Kbd>{MOD_KEY}</Kbd><Kbd>↵</Kbd></>}>save</Hint>
              <Hint k={<Kbd>esc</Kbd>}>cancel</Hint>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Button variant="secondary" data-testid="btn-cancel" onClick={editor.cancel} disabled={editor.saving}>
                Cancel
              </Button>
              <Button variant="primary" data-testid="btn-save" onClick={editor.save} disabled={editor.saving}>
                <Check aria-hidden />
                {editor.saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </>
        ) : actions.canApprove ? (
          <>
            <div className="flex min-w-0 items-center gap-3 overflow-hidden text-xs text-fg-muted">
              <Hint k={<Kbd>a</Kbd>}>approve</Hint>
              <Hint k={<Kbd>e</Kbd>}>edit</Hint>
              <Hint k={<Kbd>r</Kbd>}>reject</Hint>
              <Hint k={<Kbd>esc</Kbd>}>back</Hint>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Button variant="danger" data-testid="btn-reject" onClick={onReject} disabled={actions.busy}>
                Reject
              </Button>
              <Button ref={editButton} variant="secondary" data-testid="btn-edit" onClick={editor.start} disabled={actions.busy}>
                <Pencil aria-hidden />
                Edit
              </Button>
              <Button variant="primary" data-testid="btn-approve" onClick={actions.approve} disabled={actions.busy}>
                <Check aria-hidden />
                {actions.approving ? "Approving…" : "Approve"}
              </Button>
            </div>
          </>
        ) : actions.canRetry ? (
          <>
            <div className="flex min-w-0 items-center gap-3 overflow-hidden text-xs text-fg-muted">
              <span className="truncate">Order not delivered · attempt {record.order.attempts}</span>
              <Hint k={<Kbd>r</Kbd>}>reject</Hint>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Button variant="danger" data-testid="btn-reject" onClick={onReject} disabled={actions.busy}>
                Reject
              </Button>
              <Button variant="primary" data-testid="btn-retry-send" onClick={actions.retry} disabled={actions.busy}>
                <RotateCw aria-hidden />
                {actions.retrying ? "Sending…" : "Retry send"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-fg-muted" role="status">
            {RESTING[record.status] ?? "No review actions available."}
          </p>
        )}
      </div>
    </div>
  );
}
