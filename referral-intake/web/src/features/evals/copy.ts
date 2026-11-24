/**
 * Copy for the Evals page, built from the benchmark artifacts at runtime.
 * Pure functions only (no React), so the sentence logic can be exercised on any
 * values: ties, v1 ahead, 0 hits, 1 referral, different sample sizes.
 */
import type { ArtifactEnvelope, BenchmarkReport, Count, PipelineBenchmark, PipelineName } from "@/contracts";
import { ApiError } from "@/api/client";
import { humanize } from "@/lib/format";

/** The names the page uses for the two pipelines ("graph" is v2). */
export const PIPELINE_LABEL: Record<PipelineName, string> = { v1: "v1", graph: "v2" };

export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** "v1", "v1 and v2", "v1, v2 and v3". */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "patient_dob" → "Date of birth"; "member_id" → "Member ID". */
export function fieldLabel(field: string): string {
  const h = humanize(field)
    .replace(/^dob$/i, "date of birth")
    .replace(/\bid\b/gi, "ID");
  return capitalize(h);
}

type Side = { name: string; hits: number; n: number };

/**
 * The page's display line: which pipeline puts the right policy first, for how many
 * referrals. The leader (higher hit rate) speaks first; a tie says "both".
 *
 *   v2 ahead   "v2 retrieves the right policy for 60 of 60 referrals; v1 for 57."
 *   v1 ahead   "v1 retrieves the right policy for 58 of 60 referrals; v2 for 55."
 *   tie        "v1 and v2 both retrieve the right policy for 57 of 60 referrals."
 *   none       "Neither v1 nor v2 retrieves the right policy for any of the 60 referrals."
 *   sizes differ: the second count carries its own "of n".
 */
export function headline(v1: Count, v2: Count): string {
  const a: Side = { name: "v1", ...v1 };
  const b: Side = { name: "v2", ...v2 };
  if (a.n === 0 && b.n === 0) return "The benchmark has no retrieval results yet.";
  if (a.n === 0 || b.n === 0) {
    const [has, none] = a.n === 0 ? [b, a] : [a, b];
    return `${has.name} retrieves the right policy for ${has.hits} of ${has.n} ${plural(has.n, "referral")}; ${none.name} has no results.`;
  }
  // compare rates without division: a.hits / a.n vs b.hits / b.n
  const cmp = a.hits * b.n - b.hits * a.n;
  if (cmp === 0 && a.n === b.n) {
    if (a.hits === 0)
      return a.n === 1
        ? "Neither v1 nor v2 retrieves the right policy for the one referral."
        : `Neither v1 nor v2 retrieves the right policy for any of the ${a.n} referrals.`;
    return `v1 and v2 both retrieve the right policy for ${a.hits} of ${a.n} ${plural(a.n, "referral")}.`;
  }
  // v2 speaks first unless v1 is strictly ahead
  const [lead, trail] = cmp > 0 ? [a, b] : [b, a];
  const tail = trail.n !== lead.n ? `${trail.hits} of ${trail.n}` : trail.hits === 0 ? "none" : String(trail.hits);
  return `${lead.name} retrieves the right policy for ${lead.hits} of ${lead.n} ${plural(lead.n, "referral")}; ${trail.name} for ${tail}.`;
}

/** How many faxes the benchmark ran: the corpus size when recorded, else the runs timed. */
export function corpusSize(r: BenchmarkReport): number {
  const n = r.corpus.n;
  if (typeof n === "number") return n;
  return r.v2.latency_ms.n ?? r.v2.retrieval_hit_at_1_with_cpt.n;
}

/** Referrals each pipeline processed end to end (the denominator for auto-approved). */
export const runs = (p: PipelineBenchmark) => p.latency_ms.n ?? p.retrieval_hit_at_1_with_cpt.n;

/** "Same 60 faxes, same extraction and gate · threshold 0.85" */
export function benchmarkMeta(r: BenchmarkReport): string {
  const n = corpusSize(r);
  const faxes = n === 1 ? "The same fax" : `Same ${n} faxes`;
  return `${faxes}, same extraction and gate · auto-approve threshold ${r.threshold}`;
}

export const fraction = (c: Count) => `${c.hits}/${c.n}`;

const sameSet = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join("\n") === [...y].sort().join("\n");

/** Comparison line for the false-approval stat: "v1: 1 in 19 · the same fax". */
export function falseApprovalComparison(v1: PipelineBenchmark, v2: PipelineBenchmark): string {
  const base = `v1: ${v1.false_approvals} in ${v1.auto_approved}`;
  if (v1.false_approvals > 0 && sameSet(v1.false_approval_files, v2.false_approval_files))
    return `${base} · the same ${plural(v1.false_approvals, "fax", "faxes")}`;
  return base;
}

/**
 * The benchmark's explanation usually opens with "<file> (<context>): …". Pull that
 * context out (it is shown beside the file name) and start the prose at the sentence.
 */
export function splitExplanation(file: string, text: string): { context: string | null; body: string } {
  const esc = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^${esc}\\s*\\(([^)]*)\\)\\s*:\\s*`).exec(text);
  if (!m) return { context: null, body: text };
  return { context: m[1].trim() || null, body: capitalize(text.slice(m[0].length)) };
}

/** A field value as the artifact recorded it: strings verbatim, lists joined, null as "empty". */
export function showValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(showValue).join(", ");
  return JSON.stringify(v);
}

/** "evals/benchmark_v1_v2.json has not been generated" → the path, from the API's 404. */
export function missingPath(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const m = /^(\S+\.json)\b/.exec(error.message);
  return m ? m[1] : null;
}

export const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;

/** How the run time was established, for the provenance line. */
export function runAtText(env: ArtifactEnvelope<unknown>, fmt: (iso: string) => string): { text: string; title: string } {
  if (!env.run_at) return { text: "run time unknown", title: "Neither the artifact nor git records when this ran" };
  if (env.run_at_source === "git") return { text: `committed ${fmt(env.run_at)}`, title: "The artifact has no run time; this is the last git commit of the file" };
  return { text: `run ${fmt(env.run_at)}`, title: "Run time recorded in the artifact" };
}

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
