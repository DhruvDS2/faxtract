import type { AckCode, ReferralStatus, TraceStatus } from "@/contracts";

export type Tone = "ok" | "warn" | "bad" | "idle";

/** The one status vocabulary (web/DESIGN.md). */
export const STATUS: Record<ReferralStatus, { label: string; tone: Tone }> = {
  processing: { label: "Processing", tone: "idle" },
  needs_review: { label: "Needs review", tone: "warn" },
  auto_approved: { label: "Auto-approved", tone: "ok" },
  approved: { label: "Approved", tone: "ok" },
  sent_to_ris: { label: "Sent to RIS", tone: "ok" },
  ris_error: { label: "RIS error", tone: "bad" },
  rejected: { label: "Rejected", tone: "bad" },
  failed: { label: "Failed", tone: "bad" },
};

export const STATUS_ORDER: ReferralStatus[] = [
  "needs_review", "ris_error", "processing", "failed", "auto_approved", "approved", "sent_to_ris", "rejected",
];

export const ackTone = (code: AckCode | null): Tone => (code === "AA" ? "ok" : code ? "bad" : "idle");

export const traceTone = (s: TraceStatus): Tone | "accent" =>
  s === "ok" ? "ok" : s === "error" ? "bad" : s === "interrupted" ? "warn" : s === "running" ? "accent" : "idle";

/** Confidence tone given the server's threshold (from /health). */
export const confidenceTone = (value: number | null | undefined, threshold: number): Tone =>
  value == null ? "idle" : value < 0.5 ? "bad" : value < threshold ? "warn" : "idle";

// ---------- the five-state status set (web/DESIGN.md, "Status") ----------

/**
 * What a status dot shows. `rejected` is a terminal human decision (muted);
 * `bad` is an error that needs action; `idle` is pending / processing.
 */
export type StatusTone = Tone | "rejected";

export const statusTone = (s: ReferralStatus): StatusTone => (s === "rejected" ? "rejected" : STATUS[s].tone);

/** Statuses that mean "something is still running" (the dot breathes). */
export const isRunning = (s: ReferralStatus) => s === "processing" || s === "approved" || s === "auto_approved";

/**
 * One status text for a referral, ACK folded in: "Sent to RIS · AA",
 * "RIS rejected · AE", "RIS error · no ACK". Tables show this instead of a
 * separate ACK pill.
 */
export function statusText(s: ReferralStatus, ack?: AckCode | null): { label: string; tone: StatusTone } {
  if (s === "sent_to_ris") return { label: ack ? `Sent to RIS · ${ack}` : "Sent to RIS", tone: ack && ack !== "AA" ? "bad" : "ok" };
  if (s === "ris_error") return { label: ack && ack !== "AA" ? `RIS rejected · ${ack}` : "RIS error · no ACK", tone: "bad" };
  return { label: STATUS[s].label, tone: statusTone(s) };
}
