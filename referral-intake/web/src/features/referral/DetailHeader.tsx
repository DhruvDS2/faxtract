import { Fragment } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { Morph } from "@/components/Morph";
import { PageHeader } from "@/components/PageHeader";
import { StatusLine } from "@/components/StatusLine";
import { StatusDot } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { referralLayoutId } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { MOD_KEY } from "./format";
import type { StatusView } from "./statusView";
import type { FlowView, PathStep } from "./useApproveFlow";

/** Back to the queue: history back when the queue is where we came from (it keeps its filters). */
export function useBackToQueue() {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/queue");
  };
}

function Shortcut({ label, keys, children }: { label: string; keys: string[]; children: React.ReactElement }) {
  return (
    <Tip
      content={
        <span className="inline-flex items-center gap-2">
          {label}
          <span className="inline-flex gap-1">
            {keys.map((k) => (
              <Kbd key={k} className="h-4 min-w-4 border-fg-muted bg-transparent text-bg">
                {k}
              </Kbd>
            ))}
          </span>
        </span>
      }
    >
      {children}
    </Tip>
  );
}

/** human review ✓ → order ✓ → ACK ✓: the graph resuming after Approve. */
function MiniPath({ steps }: { steps: PathStep[] }) {
  return (
    <span className="inline-flex items-center gap-2 text-meta" aria-label="Pipeline after approval">
      {steps.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && <span aria-hidden className={cn("h-px w-4 transition-colors duration-state", s.state === "pending" ? "bg-border" : "bg-fg-faint")} />}
          <span className="inline-flex items-center gap-1.5" data-step={s.id} data-state={s.state}>
            {s.state === "done" ? (
              <Check aria-hidden className="size-3.5 animate-fade-in text-ok" />
            ) : (
              <StatusDot tone={s.state === "error" ? "bad" : "idle"} running={s.state === "running"} className={s.state === "pending" ? "opacity-60" : undefined} />
            )}
            <span className={cn("transition-colors duration-state", s.state === "pending" ? "text-fg-faint" : s.state === "error" ? "text-bad" : "text-fg-muted")}>
              {s.label}
              <span className="sr-only"> {s.state}</span>
            </span>
          </span>
        </Fragment>
      ))}
    </span>
  );
}

type Actions = {
  editing: boolean;
  saving: boolean;
  canApprove: boolean;
  canEdit: boolean;
  canReject: boolean;
  canRetry: boolean;
  busy: boolean;
  approving: boolean;
  retrying: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRetry: () => void;
};

type Props = {
  id: string;
  name: string | null;
  status: StatusView | null;
  flow: FlowView | null;
  graphLink: boolean;
  actions: Actions | null;
};

/**
 * The detail header: the patient's name as the display line (the ONTO morph target),
 * one quiet status line, and the review actions on the right (one teal primary).
 */
export function DetailHeader({ id, name, status, flow, graphLink, actions }: Props) {
  const back = useBackToQueue();
  const line = flow ?? status;

  return (
    <PageHeader
      className="pt-4"
      eyebrow={
        <Link
          to="/queue"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            back();
          }}
          className="inline-flex items-center gap-1 rounded-sm text-meta text-fg-muted transition-colors duration-fast hover:text-fg"
        >
          <span aria-hidden>←</span> Queue
        </Link>
      }
      title={
        name ? (
          <Morph as="span" layoutId={referralLayoutId(id)} className="max-w-full truncate align-top" title={name}>
            {name}
          </Morph>
        ) : (
          <Skeleton className="inline-block h-5 w-56 align-middle" />
        )
      }
      status={
        line ? (
          <StatusLine
            data-testid="detail-status"
            tone={line.tone}
            running={line.running}
            detail={flow ? <MiniPath steps={flow.path} /> : status?.detail}
            action={
              graphLink ? (
                <Link
                  to={`/graph?referral=${id}`}
                  className="text-fg-muted underline decoration-border-strong underline-offset-4 transition-colors duration-fast hover:text-fg hover:decoration-fg-muted"
                >
                  {flow ? "See it in the graph" : "Pipeline graph"}
                </Link>
              ) : undefined
            }
          >
            <span key={line.text} className="animate-fade-in">
              {line.text}
            </span>
          </StatusLine>
        ) : (
          <div className="flex h-5 items-center gap-2" aria-busy>
            <Skeleton className="h-2.5 w-64" />
          </div>
        )
      }
      actions={actions && <HeaderActions {...actions} />}
    />
  );
}

function HeaderActions(a: Actions) {
  if (a.editing)
    return (
      <>
        <Shortcut label="Discard the changes" keys={["esc"]}>
          <Button variant="secondary" data-testid="btn-cancel" onClick={a.onCancel} disabled={a.saving}>
            Cancel
          </Button>
        </Shortcut>
        <Shortcut label="Save, then re-run validation" keys={[MOD_KEY, "↵"]}>
          <Button variant="primary" data-testid="btn-save" onClick={a.onSave} loading={a.saving} loadingText="Saving…">
            Save changes
          </Button>
        </Shortcut>
      </>
    );
  if (a.canApprove)
    return (
      <>
        <Shortcut label="Reject with a reason" keys={["r"]}>
          <Button variant="danger" data-testid="btn-reject" onClick={a.onReject} disabled={a.busy}>
            Reject
          </Button>
        </Shortcut>
        <Shortcut label="Fix fields inline" keys={["e"]}>
          <Button variant="secondary" data-testid="btn-edit" onClick={a.onEdit} disabled={a.busy || !a.canEdit}>
            Edit
          </Button>
        </Shortcut>
        <Shortcut label="Approve and send the order to the RIS" keys={["a"]}>
          <Button variant="primary" data-testid="btn-approve" onClick={a.onApprove} loading={a.approving} loadingText="Approving…" disabled={a.busy}>
            Approve
          </Button>
        </Shortcut>
      </>
    );
  if (a.canRetry)
    return (
      <>
        <Shortcut label="Reject with a reason" keys={["r"]}>
          <Button variant="danger" data-testid="btn-reject" onClick={a.onReject} disabled={a.busy}>
            Reject
          </Button>
        </Shortcut>
        <Button variant="primary" data-testid="btn-retry-send" onClick={a.onRetry} loading={a.retrying} loadingText="Sending…" disabled={a.busy}>
          Retry send
        </Button>
      </>
    );
  return null;
}
