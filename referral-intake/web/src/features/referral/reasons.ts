import type { Flag, ReferralRecord } from "@/contracts";
import { fieldMeta, flagField, isField } from "./fields";
import { listOf, words } from "./format";

export type PanelId = "eligibility" | "policy" | "packet" | "order" | "history";

export type ReasonTarget = { kind: "field"; field: string } | { kind: "panel"; panel: PanelId };

/** One "why it stopped" line: a sentence, and where to go to resolve it. */
export type Reason = {
  key: string;
  /** "Coverage", "Prior auth", "Date of birth". */
  lead: string | null;
  text: string;
  tone: "warn" | "bad";
  target: ReasonTarget | null;
  /** "Check coverage", "See policy", "Go to field". */
  link: string | null;
};

const COVERAGE: Record<string, string> = {
  terminated: "the payor reports this coverage as terminated (271)",
  "not found": "the payor couldn't find this member (271)",
  not_found: "the payor couldn't find this member (271)",
  "out of network": "active, but out of network (271)",
  active_out_of_network: "active, but out of network (271)",
};

/** Turn a pipeline review reason ("prior auth: missing prior_imaging") into a sentence with a target. */
export function parseReason(raw: string, i: number): Reason {
  const key = `r${i}-${raw}`;
  const m = /^\s*([^:]+?)\s*:\s*(.+)$/.exec(raw);
  if (!m) return { key, lead: null, text: raw, tone: "warn", target: null, link: null };
  const [, head, rest] = m;
  const h = head.toLowerCase();

  if (h === "eligibility" || h === "coverage")
    return {
      key,
      lead: "Coverage",
      text: COVERAGE[rest.trim().toLowerCase()] ?? rest,
      tone: "warn",
      target: { kind: "panel", panel: "eligibility" },
      link: "Check coverage",
    };

  if (h === "prior auth" || h === "auth" || h === "policy") {
    const missing = /^missing\s+(.+)$/i.exec(rest);
    const items = missing ? missing[1].split(/\s*,\s*/).map(words) : [];
    return {
      key,
      lead: "Prior auth",
      text: missing ? `${listOf(items)} ${items.length === 1 ? "is" : "are"} missing for the auth packet` : rest,
      tone: "warn",
      target: { kind: "panel", panel: "policy" },
      link: "See policy",
    };
  }

  const field = head.replace(/\[\d+\]$|\.\d+$/, "");
  if (isField(field))
    return {
      key,
      lead: fieldMeta(field).label,
      text: rest,
      tone: "warn",
      target: { kind: "field", field },
      link: "Go to field",
    };

  return { key, lead: head.replace(/^./, (c) => c.toUpperCase()), text: rest, tone: "warn", target: null, link: null };
}

const fieldReason = (flag: Flag, i: number): Reason => {
  const field = flagField(flag);
  return {
    key: `f${i}-${flag.field}-${flag.message}`,
    lead: field ? fieldMeta(field).label : flag.field,
    text: flag.message,
    tone: flag.severity === "error" ? "bad" : "warn",
    target: field ? { kind: "field", field } : null,
    link: field ? "Go to field" : null,
  };
};

/**
 * Why the referral stopped: the pipeline's review reasons, plus any error flag the
 * reasons don't already name (those block approval).
 */
export function reviewReasons(record: ReferralRecord): Reason[] {
  const out = record.review_reasons.map(parseReason);
  const named = new Set(out.flatMap((r) => (r.target?.kind === "field" ? [r.target.field] : [])));
  record.flags.forEach((f, i) => {
    if (f.severity !== "error") return;
    const field = flagField(f);
    if (field && named.has(field)) return;
    out.push(fieldReason(f, i));
  });
  return out;
}

/** Flags the server said block approval (409), as reasons. */
export const blockingReasons = (flags: Flag[]): Reason[] => flags.map((f, i) => ({ ...fieldReason(f, i), tone: "bad" }));
