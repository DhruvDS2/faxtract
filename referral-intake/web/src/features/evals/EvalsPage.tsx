import { useBenchmark, useExtractionEval } from "@/api/queries";
import type { ArtifactEnvelope } from "@/contracts";
import { Code } from "@/components/Code";
import { PageHeader } from "@/components/PageHeader";
import { LoadingRows } from "@/components/States";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDateTime } from "@/lib/format";
import { BenchmarkTable, NodeTimings, RunFacts } from "./Benchmark";
import { FalseApprovals } from "./FalseApprovals";
import { FieldAccuracy } from "./FieldAccuracy";
import { ArtifactState, Section, isNotFound } from "./parts";

const RUN_AT_SOURCE: Record<ArtifactEnvelope<unknown>["run_at_source"], string> = {
  artifact: "recorded in the artifact",
  git: "last git commit of the file",
  unknown: "unknown",
};

/** Screen 4: v1 vs v2 benchmark and extraction accuracy, read from the eval artifacts at runtime. */
export function EvalsPage() {
  const bench = useBenchmark();
  const extraction = useExtractionEval();
  const report = bench.data?.data;

  return (
    <div className="pb-8">
      <PageHeader
        title="Evals"
        meta="v1 baseline vs v2 graph on the same faxes. Every number on this page is read from the eval artifacts at runtime."
      />
      <div className="divide-y divide-border">
        <Section title="Provenance" meta="Where these numbers come from" testId="evals-source">
          <dl className="grid max-w-5xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <SourceRow label="Benchmark" query={bench} />
            <SourceRow label="Extraction eval" query={extraction} />
          </dl>
        </Section>

        <Section
          title="Benchmark: v1 vs v2"
          testId="evals-benchmark"
          meta={
            report && (
              <span className="tabular-nums">
                approval threshold {report.threshold}
                {report.v1.latency_ms.n ? ` · ${report.v1.latency_ms.n} referrals per pipeline` : ""}
              </span>
            )
          }
        >
          <ArtifactState
            query={bench}
            missingTitle="Benchmark not generated yet."
            missingHint={
              <>
                Run <Code>python -m evals.benchmark</Code> to write <Code>evals/benchmark_v1_v2.json</Code>.
              </>
            }
          />
          {report && (
            <div className="grid gap-x-8 gap-y-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
              <div className="min-w-0 space-y-6">
                <BenchmarkTable report={report} />
                <div>
                  <h3 className="mb-2 text-sm font-semibold">
                    v2 per-node timings <span className="font-normal text-fg-muted">from trace events</span>
                  </h3>
                  <NodeTimings report={report} />
                </div>
              </div>
              <div className="min-w-0 space-y-6">
                <div>
                  <h3 className="mb-1 text-sm font-semibold">Run facts</h3>
                  <RunFacts report={report} />
                </div>
                {report.notes.length > 0 && (
                  <div>
                    <h3 className="mb-1 text-sm font-semibold">Notes</h3>
                    <ul className="list-disc space-y-1 pl-4 text-sm text-fg-muted">
                      {report.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </Section>

        <Section
          title="False approvals"
          testId="evals-false-approvals"
          meta={
            report && (
              <span className="tabular-nums">
                auto-approved with a critical field wrong · v1 {report.v1.false_approvals} · v2 {report.v2.false_approvals}
              </span>
            )
          }
        >
          {bench.isPending ? (
            <LoadingRows rows={2} />
          ) : bench.isError ? (
            <div className="text-xs text-fg-muted">
              {isNotFound(bench.error) ? "Appears once the benchmark is generated." : "Benchmark unavailable."}
            </div>
          ) : (
            report && <FalseApprovals cases={report.false_approval_cases} />
          )}
        </Section>

        <Section title="Field accuracy" meta="Extraction only, per field, worst first" testId="evals-field-accuracy">
          <ArtifactState
            query={extraction}
            missingTitle="Extraction eval not found."
            missingHint={
              <>
                Run <Code>python -m evals.run_extraction_eval</Code> to write <Code>evals/extraction_eval.json</Code>.
              </>
            }
          />
          {extraction.data && <FieldAccuracy data={extraction.data.data} />}
        </Section>
      </div>
    </div>
  );
}

function SourceRow({
  label,
  query,
}: {
  label: string;
  query: { data?: ArtifactEnvelope<unknown>; isPending: boolean; isError: boolean; error: unknown };
}) {
  const env = query.data;
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0" data-artifact={label}>
        {query.isPending ? (
          <Skeleton className="h-4 w-96" />
        ) : query.isError ? (
          <span className="text-fg-muted">
            {isNotFound(query.error) ? "not generated" : query.error instanceof Error ? query.error.message : "unavailable"}
          </span>
        ) : (
          env && (
            <span className="flex flex-wrap items-baseline gap-x-2">
              <Code className="break-all">{env.source}</Code>
              <span className="text-fg-muted">·</span>
              <span className="tabular-nums">{env.run_at ? `run ${fmtDateTime(env.run_at)}` : "run time unknown"}</span>
              <span className="text-xs text-fg-muted">({RUN_AT_SOURCE[env.run_at_source]})</span>
            </span>
          )
        )}
      </dd>
    </>
  );
}
