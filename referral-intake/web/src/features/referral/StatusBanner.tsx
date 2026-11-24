import { CircleCheck, CircleX, Loader, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReferralRecord } from "@/contracts";
import { fmtDateTime } from "@/lib/format";
import type { Tone } from "@/lib/status";
import { cn } from "@/lib/utils";

const TONE: Record<Tone, string> = {
  ok: "border-ok-border bg-ok-bg",
  warn: "border-warn-border bg-warn-bg",
  bad: "border-bad-border bg-bad-bg",
  idle: "border-idle-border bg-idle-bg",
};
const TITLE: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", idle: "text-idle" };
const ICON = { ok: CircleCheck, warn: TriangleAlert, bad: CircleX, idle: Loader };

function Banner({ tone, title, children, testid }: { tone: Tone; title: React.ReactNode; children?: React.ReactNode; testid?: string }) {
  const Icon = ICON[tone];
  return (
    <div className={cn("mx-4 mt-3 rounded-md border px-3 py-2", TONE[tone])} role={tone === "bad" ? "alert" : "status"} data-testid={testid}>
      <div className={cn("flex items-center gap-2 text-sm font-medium", TITLE[tone])}>
        <Icon className="size-4 shrink-0" aria-hidden />
        {title}
      </div>
      {children && <div className="mt-1 pl-6 text-sm text-fg">{children}</div>}
    </div>
  );
}

/** One line on what is true about this referral right now, and who said so. */
export function StatusBanner({ record }: { record: ReferralRecord }) {
  const graph = record.pipeline === "graph";
  const lastReview = record.reviews.at(-1);

  switch (record.status) {
    case "needs_review":
      return (
        <Banner tone="warn" title={graph ? "Graph paused at human review" : "The v1 pipeline sent this to review"} testid="review-reasons">
          {record.review_reasons.length ? (
            <ul className="flex list-disc flex-col gap-0.5 pl-4 marker:text-fg-faint">
              {record.review_reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : (
            <span className="text-fg-muted">No reasons were recorded. Check the fields and approve or reject.</span>
          )}
        </Banner>
      );
    case "ris_error":
      return (
        <Banner tone="bad" title="The order did not reach the RIS">
          {record.order.last_error ?? "No error message was recorded."}
          <span className="text-fg-muted"> · attempt {record.order.attempts}</span>
        </Banner>
      );
    case "failed":
      return (
        <Banner tone="bad" title="The pipeline failed on this fax">
          {record.error ?? "No error message was recorded."}
        </Banner>
      );
    case "processing":
      return (
        <Banner tone="idle" title={graph ? "The graph is running" : "The v1 pipeline is running"}>
          <span className="text-fg-muted">This page updates as it settles. </span>
          <Link to={`/graph?referral=${record.id}`} className="text-accent hover:underline">
            Watch the nodes
          </Link>
        </Banner>
      );
    case "rejected":
      return (
        <Banner tone="bad" title={`Rejected${lastReview?.action === "reject" && lastReview.reviewer ? ` by ${lastReview.reviewer}` : ""}`}>
          {lastReview?.action === "reject" ? (
            <>
              {lastReview.note ?? "No reason recorded."}
              <span className="text-fg-muted"> · {fmtDateTime(lastReview.at)}</span>
            </>
          ) : (
            "No reason recorded."
          )}
        </Banner>
      );
    case "sent_to_ris":
      return (
        <Banner tone="ok" title={`RIS acknowledged the order${record.order.ack_code ? ` (${record.order.ack_code})` : ""}`}>
          <span className="text-fg-muted">
            Sent {fmtDateTime(record.order.sent_at)} · {record.order.attempts === 1 ? "first attempt" : `attempt ${record.order.attempts}`}
          </span>
        </Banner>
      );
    default:
      return null;
  }
}
