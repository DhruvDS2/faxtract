import { useEffect, useRef } from "react";
import type { RetrievalCompare, RetrieverRun } from "@/contracts";
import { ApiError } from "@/api/client";
import { useRetrievalCompare } from "@/api/queries";
import { Code } from "@/components/Code";
import { ErrorState } from "@/components/States";
import { StatusDot } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtMs } from "@/lib/format";
import { useMotionPrefs } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Excerpt } from "./Excerpt";

/** "Compare v1 vs v2": the same query through v1 keyword retrieval and v2 hybrid RAG, side by side. */
export function ComparePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useRetrievalCompare(id, true);
  const ref = useRef<HTMLElement>(null);
  const { reduce } = useMotionPrefs();

  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [reduce]);

  const conflict = q.error instanceof ApiError && q.error.status === 409;

  return (
    <section
      ref={ref}
      id="compare"
      data-testid="compare-panel"
      aria-labelledby="compare-title"
      aria-busy={q.isPending}
      className="mt-4 animate-fade-in scroll-mt-4 border-t border-border pt-4"
    >
      <div className="flex items-baseline gap-4">
        <h4 id="compare-title" className="text-body font-medium text-fg">
          Retrieval: v1 keyword vs v2 RAG
        </h4>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </div>
      {q.isPending ? (
        <div className="mt-3 grid grid-cols-2 gap-6">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-2.5 w-1/3" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ) : conflict ? (
        <p className="mt-1 text-body text-fg-muted" role="status">
          Nothing to compare for this referral. {q.error instanceof Error ? q.error.message : ""}
        </p>
      ) : q.isError ? (
        <ErrorState error={q.error} title="Couldn't run the comparison" align="start" className="py-4" onRetry={() => void q.refetch()} />
      ) : (
        <CompareBody data={q.data} />
      )}
    </section>
  );
}

function CompareBody({ data }: { data: RetrievalCompare }) {
  const { query, expected_source: expected } = data;
  return (
    <>
      <p className="mt-1 text-body text-fg-muted">The same query through both retrievers, top {Math.max(data.v1.chunks.length, data.v2.chunks.length)} chunks each.</p>
      <p className="mt-1 flex min-w-0 items-baseline gap-2 text-body text-fg-muted">
        <span className="shrink-0">Expected policy</span>
        {expected ? (
          <Code className="min-w-0 truncate text-fg">{expected}</Code>
        ) : (
          <span>none: no policy matches this payor and CPT</span>
        )}
      </p>
      {(query.indication || !!query.codes?.length) && (
        <p className="mt-1 min-w-0 truncate text-meta text-fg-faint" title={query.indication}>
          Query: {query.codes?.join(", ")}
          {query.codes?.length && query.indication ? " · " : ""}
          {query.indication}
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-6">
        <RetrieverColumn run={data.v1} expected={expected} />
        <RetrieverColumn run={data.v2} expected={expected} />
      </div>
      <p className="mt-3 text-meta text-fg-faint">Scores are on each retriever's own scale, so compare ranks, not scores.</p>
    </>
  );
}

function RetrieverColumn({ run, expected }: { run: RetrieverRun; expected: string | null }) {
  const top = run.chunks[0];
  const hit = expected && top ? top.source === expected : null;
  return (
    <div className="min-w-0" data-retriever={run.name}>
      <h5 className="truncate text-body font-medium text-fg">{run.name}</h5>
      <div className="flex min-w-0 items-baseline gap-2 text-meta text-fg-muted">
        <Code className="min-w-0 truncate">{run.impl}</Code>
        <span className="shrink-0 tabular-nums">{fmtMs(run.latency_ms)}</span>
      </div>
      {hit != null && (
        <p className={cn("mt-1 flex items-center gap-2 text-meta", hit ? "text-fg" : "text-bad")}>
          <StatusDot tone={hit ? "ok" : "bad"} />
          {hit ? "Top hit is the right policy" : "Top hit is the wrong policy"}
        </p>
      )}
      {run.keywords.length > 0 && <p className="mt-1 text-meta text-fg-faint wrap-anywhere">Keywords: {run.keywords.join(", ")}</p>}
      {run.chunks.length === 0 ? (
        <p className="mt-2 text-body text-fg-muted">No chunks returned.</p>
      ) : (
        <ol className="mt-2 flex flex-col divide-y divide-border border-t border-border">
          {run.chunks.map((c) => {
            const isExpected = !!expected && c.source === expected;
            return (
              <li key={`${c.rank}-${c.source}`} className="py-2">
                <div className="flex items-center gap-3 text-meta text-fg-muted tabular-nums">
                  <span className="text-fg-faint">#{c.rank}</span>
                  <span>score {c.score.toFixed(3)}</span>
                  {isExpected && (
                    <span className="ml-auto inline-flex items-center gap-1.5">
                      <StatusDot tone="ok" />
                      expected
                    </span>
                  )}
                </div>
                <Code className={cn("block truncate", isExpected ? "text-fg" : "text-fg-muted")} title={c.source}>
                  {c.source}
                </Code>
                <Excerpt text={c.text} lines={2} />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
