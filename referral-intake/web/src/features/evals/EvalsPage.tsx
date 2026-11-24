import { useBenchmark, useExtractionEval } from "@/api/queries";
import { BarsSkeleton, BenchmarkBars, BenchmarkHeader, BenchmarkStats, StatsSkeleton } from "./Benchmark";
import { isNotFound } from "./copy";
import { FalseApprovals } from "./FalseApprovals";
import { FieldAccuracy } from "./FieldAccuracy";
import { MethodDetails } from "./MethodDetails";
import { Provenance } from "./Provenance";

/**
 * Screen 4: v1 vs v2 on the same faxes, and extraction accuracy. Every number is read
 * from the eval artifacts at runtime (GET /evals/benchmark, GET /evals/extraction);
 * the two load independently, so either can be missing without hiding the other.
 *
 *   headline sentence + meta line
 *   stat row (4 stats, count through once)
 *   v1 vs v2 bars (grow once) + latency as plain values
 *   the false approval, explained
 *   field accuracy
 *   per-step timings / how it ran (accordion)
 *   provenance (sticky footer line)
 */
export function EvalsPage() {
  const bench = useBenchmark();
  const extraction = useExtractionEval();
  const report = bench.data?.data;
  const model = report && typeof report.extraction.model === "string" ? report.extraction.model : null;
  const retryFailed = () => {
    if (bench.isError) void bench.refetch();
    if (extraction.isError) void extraction.refetch();
  };

  return (
    <div className="flex min-h-full flex-col">
      <div data-testid="evals-benchmark" data-state={report ? "ready" : bench.isPending ? "loading" : isNotFound(bench.error) ? "missing" : "error"}>
        <BenchmarkHeader query={bench} report={report} onRetry={retryFailed} />
        {report ? (
          <div className="animate-fade-in">
            <BenchmarkStats report={report} />
            <BenchmarkBars report={report} />
          </div>
        ) : bench.isPending ? (
          <>
            <StatsSkeleton />
            <BarsSkeleton />
          </>
        ) : null}
      </div>

      {report && <FalseApprovals report={report} />}

      <FieldAccuracy
        query={extraction}
        critical={report?.critical_fields ?? []}
        modelHint={model}
        retryInHeader={bench.isError && !isNotFound(bench.error)}
      />

      {report && <MethodDetails report={report} />}

      <Provenance bench={bench} extraction={extraction} />
    </div>
  );
}
