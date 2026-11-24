import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { BenchmarkReport, FalseApprovalCase } from "@/contracts";
import { useReferrals } from "@/api/queries";
import { Code } from "@/components/Code";
import { KeyValue } from "@/components/PageHeader";
import { fmtConfidence, humanize } from "@/lib/format";
import { PIPELINE_LABEL, fieldLabel, listJoin, showValue, splitExplanation } from "./copy";
import { Section } from "./parts";

/** CPT codes inside the benchmark's prose are set in mono, like every other code. */
function Prose({ text }: { text: string }) {
  const parts = text.split(/\b(CPT \d{5})\b/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <span key={i}>
            CPT <Code>{p.slice(4)}</Code>
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

function confidenceText(c: number | null, threshold: number) {
  if (c == null) return "no confidence recorded";
  const side = c >= threshold ? (c === threshold ? "at" : "above") : "below";
  return `at confidence ${fmtConfidence(c)}, ${side} the ${threshold} threshold`;
}

function Case({
  c,
  threshold,
  truthVersion,
  referralId,
}: {
  c: FalseApprovalCase;
  threshold: number;
  truthVersion: string | null;
  referralId: string | null;
}) {
  const { context, body } = splitExplanation(c.file, c.explanation);
  return (
    <article className="py-6 first:pt-0 last:pb-0" data-file={c.file} aria-label={`${c.file}, ${fieldLabel(c.field)}`}>
      <div className="max-w-3xl">
        <KeyValue label="Fax">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <Code>{c.file}</Code>
            {context && <span className="text-fg-muted">{context}</span>}
            {referralId && (
              <Link
                to={`/referrals/${referralId}`}
                className="text-fg-muted underline decoration-border-strong underline-offset-4 transition-colors duration-fast ease-enter hover:text-fg hover:decoration-fg-muted"
              >
                Open referral
              </Link>
            )}
          </span>
        </KeyValue>
        <KeyValue label="Field">{fieldLabel(c.field)}</KeyValue>
        <KeyValue label="Model read">
          <Code className="text-fg">{showValue(c.predicted)}</Code>{" "}
          <span className="text-fg-muted tabular-nums">{confidenceText(c.confidence, threshold)}</span>
        </KeyValue>
        <KeyValue label="Ground truth">
          <Code className="text-fg">{showValue(c.truth)}</Code>
          {truthVersion && <span className="text-fg-muted"> · {humanize(truthVersion)}</span>}
        </KeyValue>
        <KeyValue label="Auto-approved by">{listJoin(c.pipelines.map((p) => PIPELINE_LABEL[p] ?? p))}</KeyValue>
      </div>
      <p className="mt-4 max-w-2xl text-body text-fg">
        <Prose text={body} />
      </p>
    </article>
  );
}

/** Each auto-approval that had a critical field wrong, explained in the benchmark's own words. */
export function FalseApprovals({ report }: { report: BenchmarkReport }) {
  const cases = report.false_approval_cases;
  const referrals = useReferrals();
  const byFile = useMemo(() => new Map((referrals.data ?? []).map((r) => [r.source_name, r.id])), [referrals.data]);
  const truthVersion = typeof report.corpus.truth_version === "string" ? report.corpus.truth_version : null;
  const { v1, v2 } = report;
  const n = cases.length;

  return (
    <Section
      testId="evals-false-approvals"
      title={n === 0 ? "No false approvals" : n === 1 ? "The false approval, explained" : `The ${n} false approvals, explained`}
      meta={
        <span className="tabular-nums">
          Auto-approved with a critical field wrong: v1 {v1.false_approvals} of {v1.auto_approved} auto-approved, v2{" "}
          {v2.false_approvals} of {v2.auto_approved}
        </span>
      }
    >
      {n === 0 ? (
        <p className="text-body text-fg-muted">
          Neither pipeline auto-approved a referral with a critical field wrong in this run.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {cases.map((c, i) => (
            <Case
              key={`${c.file}-${c.field}-${i}`}
              c={c}
              threshold={report.threshold}
              truthVersion={truthVersion}
              referralId={byFile.get(c.file) ?? null}
            />
          ))}
        </div>
      )}
    </Section>
  );
}
