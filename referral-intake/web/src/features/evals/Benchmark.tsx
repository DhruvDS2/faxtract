import type { BenchmarkReport, Count, PipelineBenchmark, Percentiles } from "@/contracts";
import { BarComparison } from "@/components/BarComparison";
import { Code } from "@/components/Code";
import { CountThrough } from "@/components/CountThrough";
import { PageHeader } from "@/components/PageHeader";
import { StatRow } from "@/components/StatRow";
import { describeError } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtMs, fmtUsd } from "@/lib/format";
import { benchmarkMeta, falseApprovalComparison, fraction, headline, isNotFound, pct, plural, runs } from "./copy";
import { RevealScope, Section } from "./parts";

type Query = { isPending: boolean; isError: boolean; isFetching: boolean; error: unknown; refetch: () => unknown };

/** The page's display line: the result as a sentence, or what's missing and how to make it. */
export function BenchmarkHeader({
  query,
  report,
  onRetry,
}: {
  query: Query;
  report: BenchmarkReport | undefined;
  /** Retry everything that failed on the page (one Retry, not one per section). */
  onRetry: () => void;
}) {
  if (report)
    return (
      <PageHeader
        divider={false}
        wrap
        title={headline(report.v1.retrieval_hit_at_1_with_cpt, report.v2.retrieval_hit_at_1_with_cpt)}
        meta={benchmarkMeta(report)}
      />
    );
  if (query.isError && isNotFound(query.error))
    return (
      <PageHeader
        divider={false}
        title="No benchmark yet"
        meta={
          <>
            Run <Code className="text-fg">python -m evals.benchmark</Code> to compare v1 and v2 on the same faxes.
          </>
        }
      />
    );
  if (query.isError) {
    const { cause, detail } = describeError(query.error);
    return (
      <PageHeader
        divider={false}
        title="Couldn't load the benchmark"
        meta={
          <>
            <span role="alert">{cause}</span>
            {detail && <span className="block font-mono text-code break-words text-fg-faint">{detail}</span>}
          </>
        }
        actions={
          <Button size="sm" onClick={onRetry} loading={query.isFetching} loadingText="Retrying">
            Retry
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-1 px-6 pt-5 pb-4" aria-busy="true" aria-label="Loading the benchmark">
      <Skeleton className="my-1 h-5 w-1/2 max-w-xl" />
      <Skeleton className="my-1 h-3 w-1/3 max-w-sm" />
    </div>
  );
}

/** "60/60" with the hits counting through once; the denominator is quieter. */
function Fraction({ c }: { c: Count }) {
  return (
    <>
      <CountThrough value={c.hits} />
      <span className="text-fg-faint">/{c.n}</span>
    </>
  );
}

/** Four headline stats on hairline rules (Stripe), each with its label and the v1 value. */
export function BenchmarkStats({ report }: { report: BenchmarkReport }) {
  const { v1, v2 } = report;
  return (
    <StatRow
      className="px-6"
      aria-label="v2 headline results, with v1 for comparison"
      stats={[
        {
          id: "hit-with-cpt",
          value: <Fraction c={v2.retrieval_hit_at_1_with_cpt} />,
          label: "right policy, with CPT",
          comparison: `v1: ${fraction(v1.retrieval_hit_at_1_with_cpt)}`,
        },
        {
          id: "hit-without-cpt",
          value: <Fraction c={v2.retrieval_hit_at_1_without_cpt} />,
          label: "right policy, CPT removed",
          comparison: `v1: ${fraction(v1.retrieval_hit_at_1_without_cpt)}`,
        },
        {
          id: "false-approvals",
          value: <CountThrough value={v2.false_approvals} />,
          label: `${plural(v2.false_approvals, "false approval")} in ${v2.auto_approved} auto-approved`,
          comparison: falseApprovalComparison(v1, v2),
        },
        {
          id: "cost",
          value: <CountThrough value={v2.cost_per_referral_usd} format={fmtUsd} />,
          label: "model cost per referral",
          comparison: `v1: ${fmtUsd(v1.cost_per_referral_usd)}`,
        },
      ]}
    />
  );
}

export function StatsSkeleton() {
  const cell = (id: string) => ({
    id,
    value: <Skeleton className="my-1.5 h-4 w-20" />,
    label: <Skeleton className="my-1 h-3 w-36" />,
    comparison: <Skeleton className="my-1 h-2 w-16" />,
  });
  return <StatRow className="px-6" aria-busy="true" stats={["a", "b", "c", "d"].map(cell)} />;
}

const rate = (c: Count) => (c.n ? c.hits / c.n : null);

/** "keyword overlap, whole documents" out of "app.policy.retrieve (keyword overlap, whole documents)". */
const retrieverPlain = (p: PipelineBenchmark) => /\(([^)]+)\)\s*$/.exec(p.retriever)?.[1] ?? p.retriever;

const samePercentiles = (a: Percentiles | null, b: Percentiles | null) => !!a && !!b && a.p50 === b.p50 && a.p95 === b.p95;

const pctl = (p: Percentiles) => `${fmtMs(p.p50)} / ${fmtMs(p.p95)}`;

/**
 * v1 vs v2 labelled bars (Effortel): rates plotted on one 0–100% scale, the counts as
 * text. Latency is a plain row under the bars: 0.4 ms against 57 ms would draw as an
 * empty bar beside a full one, and both sit beside a model call that takes seconds.
 */
export function BenchmarkBars({ report }: { report: BenchmarkReport }) {
  const { v1, v2 } = report;
  const countRow = (id: string, label: string, a: Count, b: Count) => ({
    id,
    label,
    max: 1,
    values: { v1: rate(a), v2: rate(b) },
    display: { v1: fraction(a), v2: fraction(b) },
  });
  const auto = (p: PipelineBenchmark): Count => ({ hits: p.auto_approved, n: runs(p) });
  const replay = report.extraction.engine === "replay";
  const model = samePercentiles(v1.extraction_latency_ms, v2.extraction_latency_ms) ? v2.extraction_latency_ms : null;

  return (
    <Section
      title="v1 baseline vs v2 graph"
      meta={
        <>
          Right policy: the top-ranked result is the payor&rsquo;s policy for the referral&rsquo;s CPT code (Hit@1). v1
          ranks by {retrieverPlain(v1)}; v2 by {retrieverPlain(v2)}.
        </>
      }
      className="border-t-0"
    >
      <RevealScope id="bars" className="max-w-4xl">
        <BarComparison
          caption="v1 baseline versus v2 graph, share of referrals"
          format={(v) => pct(v)}
          series={[
            { key: "v1", label: "v1 baseline" },
            { key: "v2", label: "v2 graph" },
          ]}
          rows={[
            countRow("hit-with-cpt", "Right policy, with CPT", v1.retrieval_hit_at_1_with_cpt, v2.retrieval_hit_at_1_with_cpt),
            countRow("hit-without-cpt", "Right policy, CPT removed", v1.retrieval_hit_at_1_without_cpt, v2.retrieval_hit_at_1_without_cpt),
            countRow("auto", `Auto-approved at ${report.threshold}`, auto(v1), auto(v2)),
            {
              id: "latency",
              label: "Pipeline latency, p50 / p95",
              plain: true,
              values: { v1: v1.latency_ms.p50, v2: v2.latency_ms.p50 },
              display: { v1: pctl(v1.latency_ms), v2: pctl(v2.latency_ms) },
            },
          ]}
        />
        <p className="mt-2 text-meta text-fg-muted tabular-nums">
          Time inside each pipeline, without human review.
          {replay && " Extraction is replayed, so the model call isn't counted"}
          {replay && model ? (
            <>
              : it took {fmtMs(model.p50)} p50, {fmtMs(model.p95)} p95 per fax, the same for both.
            </>
          ) : replay ? (
            "."
          ) : null}
        </p>
      </RevealScope>
    </Section>
  );
}

export function BarsSkeleton() {
  return (
    <Section title="v1 baseline vs v2 graph" className="border-t-0">
      <div className="max-w-4xl" aria-busy="true">
        <div className="h-8" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex h-10 animate-row-in items-center gap-4" style={{ "--i": i } as React.CSSProperties}>
            <Skeleton className="h-2.5 w-1/4" />
            <span className="w-1/6" />
            <Skeleton className="h-2 flex-1" />
            <Skeleton className="h-2 flex-1" />
          </div>
        ))}
      </div>
    </Section>
  );
}
