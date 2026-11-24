import type { Correction, ReviewEvent } from "@/contracts";
import { fmtConfidence, fmtDateTime } from "@/lib/format";
import { fieldMeta } from "./fields";
import { Section } from "./Section";

const ACTION: Record<ReviewEvent["action"], string> = {
  edit: "Edited",
  approve: "Approved",
  reject: "Rejected",
  retry_send: "Retried the send",
};

/** Reviewer actions and field corrections, oldest first. */
export function HistoryPanel({ reviews, corrections }: { reviews: ReviewEvent[]; corrections: Correction[] | undefined }) {
  const fixes = corrections ?? [];
  if (!reviews.length && !fixes.length) return null;
  return (
    <Section id="history" title="Review history">
      {reviews.length > 0 && (
        <ol className="flex flex-col gap-1">
          {reviews.map((r, i) => (
            <li key={i} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 text-sm">
              <span className="text-xs leading-5 text-fg-muted tabular-nums">{fmtDateTime(r.at)}</span>
              <span>
                <span className="font-medium">{ACTION[r.action]}</span>
                <span className="text-fg-muted"> by {r.reviewer ?? "an unnamed reviewer"}</span>
                {r.fields.length > 0 && <span className="text-fg-muted"> · {r.fields.map((f) => fieldMeta(f).label).join(", ")}</span>}
                {r.note && <span className="block text-fg-muted">{r.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {fixes.length > 0 && (
        <>
          <h3 className="mt-3 mb-1 text-sm font-medium">Corrections</h3>
          <ol className="flex flex-col gap-1">
            {fixes.map((c, i) => (
              <li key={i} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 text-sm">
                <span className="text-xs leading-5 text-fg-muted tabular-nums">{fmtDateTime(c.corrected_at)}</span>
                <span className="min-w-0">
                  <span className="font-medium">{fieldMeta(c.field).label}</span>
                  <span className="text-fg-muted">: </span>
                  <span className="text-fg-muted line-through decoration-fg-faint">{c.original_value ?? "empty"}</span>
                  <span className="text-fg-muted"> → </span>
                  <span>{c.corrected_value ?? "empty"}</span>
                  {c.original_confidence != null && (
                    <span className="text-xs text-fg-faint"> · was {fmtConfidence(c.original_confidence)}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Section>
  );
}
