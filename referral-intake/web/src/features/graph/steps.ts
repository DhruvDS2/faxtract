/**
 * What a step found, in plain words, read from its trace event (the closing
 * event's `delta`, then its `detail`). Keyed by node id for the steps we know;
 * any other step gets a generic summary (its error, its route, what it wrote).
 * Presentational only: nothing here decides state or structure.
 */
import { branchWords, humanizeId } from "./labels";
import type { Execution } from "./trace";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const words = (s: string) => s.replace(/[_-]+/g, " ");

export type Finding = {
  /** One line for the map: "Member not found", "ACK AA". */
  short: string;
  /** A sentence for the panel. */
  sentence: string;
  /** Label / value facts for the panel. */
  facts: [string, string][];
  /** Red for errors; amber for a pause waiting on a person. */
  tone?: "bad" | "warn";
};

const COVERAGE: Record<string, [string, string]> = {
  active_in_network: ["Active, in network", "Coverage is active and in network."],
  active_out_of_network: ["Out of network", "Coverage is active but out of network."],
  terminated: ["Coverage ended", "The payor says this member's coverage has ended."],
  not_found: ["Member not found", "The payor has no member with this ID."],
};

type Reader = (ex: Execution, d: Json, detail: Json) => Finding | null;

const READERS: Record<string, Reader> = {
  extract: (_ex, d, detail) => {
    const ref = obj(d.referral);
    const filled = Object.entries(ref).filter(([k, v]) => k !== "confidence" && k !== "boxes" && v != null && !(Array.isArray(v) && !v.length));
    const n = num(detail.fields) ?? filled.length;
    const facts: [string, string][] = [];
    const name = [str(ref.patient_last_name), str(ref.patient_first_name)].filter(Boolean).join(", ");
    if (name) facts.push(["Patient", name]);
    if (str(ref.requested_study)) facts.push(["Study", str(ref.requested_study)!]);
    if (str(ref.payor_name)) facts.push(["Payor", str(ref.payor_name)!]);
    return { short: `${plural(n, "field")} read`, sentence: `Read ${plural(n, "field")} from the fax.`, facts };
  },
  validate: (_ex, d) => {
    if (!("flags" in d)) return null;
    const flags = arr(d.flags).map(obj);
    const errors = flags.filter((f) => f.severity === "error").length;
    const warnings = flags.length - errors;
    const facts = flags.map((f): [string, string] => [humanizeId(str(f.field) ?? "field"), str(f.message) ?? ""]);
    if (!flags.length) return { short: "No problems", sentence: "Every field passed its checks.", facts };
    const parts = [errors ? plural(errors, "error") : null, warnings ? plural(warnings, "warning") : null].filter(Boolean).join(" and ");
    const short = errors && warnings ? plural(flags.length, "problem") : parts;
    return { short, sentence: `Found ${parts} to check.`, facts };
  },
  eligibility: (_ex, d, detail) => {
    const e = obj(d.eligibility);
    const status = str(e.status) ?? str(detail.coverage);
    if (!status) return null;
    const [short, sentence] = COVERAGE[status] ?? [words(status), `Coverage: ${words(status)}.`];
    const facts: [string, string][] = [];
    if (str(e.payor_name)) facts.push(["Payor", str(e.payor_name)!]);
    if (str(e.plan_name)) facts.push(["Plan", str(e.plan_name)!]);
    if (num(e.deductible_remaining) != null) facts.push(["Deductible left", `$${num(e.deductible_remaining)!.toLocaleString("en-US")}`]);
    if (num(e.coinsurance_percent) != null) facts.push(["Coinsurance", `${num(e.coinsurance_percent)}%`]);
    return { short, sentence, facts };
  },
  auth: (_ex, d, detail) => {
    const a = obj(d.auth);
    const required = typeof a.required === "boolean" ? a.required : typeof detail.required === "boolean" ? detail.required : null;
    if (required == null) return null;
    const missing = (arr(a.missing_elements).length ? arr(a.missing_elements) : arr(detail.missing)).map((m) => words(String(m)));
    const facts: [string, string][] = [];
    if (missing.length) facts.push(["Missing", missing.join(", ")]);
    if (str(a.submission_channel)) facts.push(["Submit by", str(a.submission_channel)!]);
    if (num(a.turnaround_days) != null) facts.push(["Turnaround", plural(num(a.turnaround_days)!, "day")]);
    if (!required) return { short: "Not required", sentence: "This study doesn't need prior authorization.", facts };
    return {
      short: missing.length ? `${plural(missing.length, "item")} missing` : "Required",
      sentence: missing.length ? `Prior auth is required, and the referral is missing ${missing.join(", ")}.` : "Prior auth is required.",
      facts,
    };
  },
  retrieve: (_ex, d) => {
    if (!("citations" in d)) return null;
    const cites = arr(d.citations).map(obj);
    if (!cites.length) return { short: "No policy found", sentence: "No matching payor policy was found.", facts: [] };
    const top = cites[0];
    const facts: [string, string][] = [["Top match", [str(top.payor), str(top.cpt) ? `CPT ${str(top.cpt)}` : null].filter(Boolean).join(" · ") || words(str(top.source) ?? "")]];
    return { short: plural(cites.length, "citation"), sentence: `Found the payor's policy and kept ${plural(cites.length, "passage")} to cite.`, facts };
  },
  packet: (_ex, d) => {
    if (!("packet_path" in d)) return null;
    return d.packet_path
      ? { short: "Packet ready", sentence: "Built the prior-auth packet.", facts: [] }
      : { short: "No packet", sentence: "No packet was needed.", facts: [] };
  },
  human_review: (ex, d, detail) => {
    if (ex.status === "interrupted") {
      const reasons = arr(obj(detail.waiting_for).review_reasons).map(String);
      return {
        short: "Waiting for review",
        sentence: "Waiting for a coordinator to review it.",
        facts: reasons.map((r, i): [string, string] => [i === 0 ? "Why" : "", r]),
        tone: "warn",
      };
    }
    const review = obj(d.review);
    const action = str(detail.action) ?? str(review.kind) ?? str(detail.route);
    const who = str(detail.reviewer) ?? str(review.reviewer);
    const changed = arr(detail.changed_fields).map((f) => humanizeId(String(f)));
    const facts: [string, string][] = [];
    if (who) facts.push(["Reviewer", who]);
    if (changed.length) facts.push(["Changed", changed.join(", ")]);
    if (str(review.note)) facts.push(["Note", str(review.note)!]);
    if (action === "approve") return { short: "Approved", sentence: who ? `Approved by ${who}.` : "Approved.", facts };
    if (action === "reject") return { short: "Rejected", sentence: who ? `Rejected by ${who}.` : "Rejected.", facts };
    if (action === "edit") return { short: `Edited ${plural(changed.length, "field")}`, sentence: "Fields were edited, so the checks ran again.", facts };
    return null;
  },
  order: (ex, d, detail) => {
    const o = obj(d.order);
    const ack = str(detail.ack) ?? str(o.ack_code);
    const err = ex.close?.error ?? str(detail.last_error) ?? str(o.last_error);
    const facts: [string, string][] = [];
    if (str(detail.order_id) ?? str(o.order_id)) facts.push(["Order", (str(detail.order_id) ?? str(o.order_id))!]);
    if (ack) facts.push(["ACK", ack]);
    if (ex.status === "ok") return { short: ack ? `ACK ${ack}` : "Sent", sentence: ack === "AA" ? "The RIS accepted the order (ACK AA)." : "Sent to the RIS.", facts };
    if (ex.status === "error") {
      if (err) facts.push(["Error", err]);
      return ack
        ? { short: `RIS rejected · ${ack}`, sentence: `The RIS rejected the order (${ack}).`, facts, tone: "bad" }
        : { short: "No ACK", sentence: "The RIS didn't acknowledge the order.", facts, tone: "bad" };
    }
    return null;
  },
  ris_wait: (ex, _d, detail) => {
    if (ex.status === "interrupted") {
      const w = obj(detail.waiting_for);
      const err = str(w.last_error);
      return {
        short: "Waiting to retry",
        sentence: "Waiting for someone to retry the send or reject the referral.",
        facts: err ? [["Last error", err]] : [],
        tone: "warn",
      };
    }
    const route = str(detail.route) ?? str(detail.action);
    if (route === "retry" || route === "retry_send") return { short: "Retry requested", sentence: "Someone asked to send the order again.", facts: [] };
    if (route === "reject") return { short: "Rejected", sentence: "Someone rejected the referral instead of retrying.", facts: [] };
    return null;
  },
  reject: () => ({ short: "Referral closed", sentence: "The referral was closed as rejected.", facts: [] }),
};

/** Generic: an error, a pause, the branch it chose, or what it wrote. */
function generic(ex: Execution, d: Json, detail: Json): Finding {
  if (ex.status === "error") {
    const err = ex.close?.error ?? "Failed";
    return { short: err, sentence: err, facts: [], tone: "bad" };
  }
  if (ex.status === "interrupted") return { short: "Waiting for a person", sentence: "Paused until a person acts.", facts: [], tone: "warn" };
  const route = branchWords(str(detail.route));
  if (route) return { short: route[0].toUpperCase() + route.slice(1), sentence: `Chose "${route}".`, facts: [] };
  const keys = Object.keys(d);
  if (keys.length) {
    const list = keys.map((k) => words(k)).join(", ");
    return { short: `Updated ${list}`, sentence: `Updated ${list}.`, facts: [] };
  }
  return { short: "Done", sentence: "Finished.", facts: [] };
}

/** What one execution of a step found. */
export function finding(ex: Execution): Finding {
  if (ex.status === "running") return { short: "Running", sentence: "Running now.", facts: [] };
  if (ex.status === "skipped") return { short: "Skipped", sentence: "Skipped.", facts: [] };
  const d = obj(ex.close?.delta);
  const detail = obj(ex.close?.detail);
  const read = READERS[ex.node];
  let out: Finding | null = null;
  try {
    out = read ? read(ex, d, detail) : null;
  } catch {
    out = null; // an unexpected payload shape falls back to the generic summary
  }
  if (out && ex.status === "error" && !out.tone) out = { ...out, tone: "bad" };
  return out ?? generic(ex, d, detail);
}
