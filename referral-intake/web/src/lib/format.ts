import type { Flag } from "../api";

export const THRESHOLD = 0.85;

/** Below this the extraction is treated as unverified and gets the amber path. */
export const isLow = (confidence?: number) =>
  confidence !== undefined && confidence < THRESHOLD;

export const minConfidence = (confidence: Record<string, number> = {}) => {
  const values = Object.values(confidence);
  return values.length ? Math.min(...values) : 1;
};

export const patientName = (r: Record<string, any>) => {
  const last = r.patient_last_name?.trim();
  const first = r.patient_first_name?.trim();
  if (last && first) return `${last}, ${first}`;
  return last || first || "Unnamed patient";
};

export const ELIGIBILITY_LABELS: Record<string, string> = {
  active_in_network: "Active · in network",
  active_out_of_network: "Active · out of network",
  terminated: "Terminated",
  not_found: "Not found",
};

export const STATUS_LABELS: Record<string, string> = {
  needs_review: "Needs review",
  auto_approved: "Auto-approved",
  approved: "Approved",
  rejected: "Rejected",
  sent_to_ris: "Sent to RIS",
};

export const formatMs = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;

/** Sonnet-class vision pricing, matching the per-referral figure in the README. */
const IN_PER_TOKEN = 3 / 1_000_000;
const OUT_PER_TOKEN = 15 / 1_000_000;
export const estimateCost = (usage: Record<string, number> = {}) => {
  const input = usage.input_tokens ?? usage.input ?? 0;
  const output = usage.output_tokens ?? usage.output ?? 0;
  if (!input && !output) return null;
  return input * IN_PER_TOKEN + output * OUT_PER_TOKEN;
};

/**
 * Saving a correction sets that field's confidence to 1.0, which retires the
 * "low extraction confidence" warning the extractor raised. Validation flags
 * are deliberately left in place: the API does not re-run validation on PATCH,
 * so we cannot claim a bad NPI or member ID has been fixed just because the
 * text changed.
 */
const isRetired = (flag: Flag, confidence: Record<string, number>) =>
  flag.severity === "warning" &&
  flag.message.startsWith("low extraction confidence") &&
  confidence[flag.field] === 1;

export const liveFlags = (flags: Flag[], confidence: Record<string, number> = {}) =>
  flags.filter((f) => !isRetired(f, confidence));

/**
 * Confidence warnings are already carried by the amber percentage and edge on
 * the field itself, so repeating them as prose is pure duplication. These are
 * the flags that say something the UI is not already showing.
 */
export const validationFlags = (flags: Flag[], confidence: Record<string, number> = {}) =>
  liveFlags(flags, confidence).filter(
    (f) => !f.message.startsWith("low extraction confidence"),
  );
