import { useEffect, useRef } from "react";
import { Check, X } from "lucide-react";
import type { RetrievalCompare, RetrieverRun } from "@/contracts";
import { ApiError } from "@/api/client";
import { useRetrievalCompare } from "@/api/queries";
import { Code } from "@/components/Code";
import { ErrorState } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Excerpt } from "./Excerpt";
import { Section } from "./Section";

/** "Compare v1 vs v2": the same query through v1 keyword retrieval and v2 3-step hybrid RAG. */
export function ComparePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useRetrievalCompare(id, true);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const conflict = q.error instanceof ApiError && q.error.status === 409;

  return (
    <Section
      ref={ref}
      id="compare"
      data-testid="compare-panel"
      title="Retrieval: v1 vs v2"
      meta="Same query, both retrievers, side by side"
      aria-busy={q.isPending}
      actions={
        <Button variant="ghost" size="icon" className="size-7" aria-label="Close comparison" onClick={onClose}>
          <X />
        </Button>
      }
    >
      {q.isPending ? (
        <div className="grid grid-cols-2 gap-4 py-1">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ))}
        </div>
      ) : conflict ? (
        <div className="rounded-md border border-dashed border-border-strong px-4 py-6 text-center" role="status">
          <div className="text-sm font-medium">Nothing to compare for this referral</div>
          <div className="mx-auto mt-1 max-w-sm text-xs text-fg-muted">{q.error instanceof Error ? q.error.message : ""}</div>
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <CompareBody data={q.data} />
      )}
    </Section>
  );
}

function CompareBody({ data }: { data: RetrievalCompare }) {
  const { query, expected_source: expected } = data;
  return (
    <>
      <dl className="mb-3 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        {query.indication && (
          <>
            <dt className="text-xs text-fg-muted">Indication</dt>
            <dd className="min-w-0 truncate" title={query.indication}>
              {query.indication}
            </dd>
          </>
        )}
        {!!query.codes?.length && (
          <>
            <dt className="text-xs text-fg-muted">Codes</dt>
            <dd className="flex flex-wrap gap-x-2">
              {query.codes.map((c) => (
                <Code key={c}>{c}</Code>
              ))}
            </dd>
          </>
        )}
        {query.payor && (
          <>
            <dt className="text-xs text-fg-muted">Payor</dt>
            <dd>{query.payor}</dd>
          </>
        )}
        <dt className="text-xs text-fg-muted">Expected policy</dt>
        <dd>{expected ? <Code>{expected}</Code> : <span className="text-fg-muted">None: no policy matches this payor and CPT</span>}</dd>
      </dl>
      <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
        <RetrieverColumn run={data.v1} expected={expected} className="pr-3" />
        <RetrieverColumn run={data.v2} expected={expected} className="pl-3" />
      </div>
      <p className="mt-2 text-xs text-fg-faint">Scores are on each retriever's own scale and are not comparable across columns.</p>
    </>
  );
}

function RetrieverColumn({ run, expected, className }: { run: RetrieverRun; expected: string | null; className?: string }) {
  const top = run.chunks[0];
  const hit = expected && top ? top.source === expected : null;
  return (
    <div className={cn("min-w-0 pt-2", className)} data-retriever={run.name}>
      <div className="flex items-center gap-2">
        <h3 className="truncate text-sm font-semibold">{run.name}</h3>
        {hit != null &&
          (hit ? (
            <Badge tone="ok">Top hit expected</Badge>
          ) : (
            <Badge tone="bad">Top hit missed</Badge>
          ))}
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-fg-muted">
        <Code className="truncate">{run.impl}</Code>
        <span className="shrink-0 tabular-nums">{fmtMs(run.latency_ms)}</span>
      </div>
      {run.keywords.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1" aria-label={`${run.name} keywords`}>
          {run.keywords.map((k) => (
            <Badge key={k} tone="outline">
              {k}
            </Badge>
          ))}
        </div>
      )}
      {run.chunks.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">No chunks returned.</p>
      ) : (
        <ol className="mt-1 flex flex-col divide-y divide-border">
          {run.chunks.map((c) => {
            const isExpected = !!expected && c.source === expected;
            return (
              <li key={`${c.rank}-${c.source}`} className="py-2">
                <div className="flex min-w-0 items-center gap-1.5 text-xs">
                  <span className="w-5 shrink-0 text-fg-faint tabular-nums">#{c.rank}</span>
                  <Code className="min-w-0 truncate" title={c.source}>
                    {c.source}
                  </Code>
                  {isExpected && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-ok">
                      <Check className="size-3" aria-hidden />
                      expected
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-fg-muted tabular-nums">{c.score.toFixed(3)}</span>
                </div>
                <Excerpt text={c.text} lines={2} />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
