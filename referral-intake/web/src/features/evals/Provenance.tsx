import type { ArtifactEnvelope } from "@/contracts";
import { Code } from "@/components/Code";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDateTime } from "@/lib/format";
import { isNotFound, missingPath, runAtText } from "./copy";

type Query = { data?: ArtifactEnvelope<unknown>; isPending: boolean; isError: boolean; error: unknown };

function Source({ label, query }: { label: string; query: Query }) {
  const env = query.data;
  let body: React.ReactNode;
  if (env) {
    const run = runAtText(env, fmtDateTime);
    body = (
      <>
        <Code className="text-fg-muted">{env.source}</Code>
        <span aria-hidden>·</span>
        <span className="tabular-nums" title={run.title}>
          {run.text}
        </span>
      </>
    );
  } else if (query.isError) {
    const path = missingPath(query.error);
    body = isNotFound(query.error) ? (
      <>
        {path && <Code className="text-fg-muted">{path}</Code>}
        <span>not generated yet</span>
      </>
    ) : (
      <span>unavailable</span>
    );
  } else {
    body = <Skeleton className="h-2.5 w-48" />;
  }
  return (
    <span className="flex min-w-0 items-baseline gap-x-2" data-artifact={label}>
      <span className="text-fg-muted">{label}</span>
      {body}
    </span>
  );
}

/**
 * Where every number on the page comes from: each artifact's file and run time, in a
 * quiet line that stays at the bottom of the viewport while the page scrolls.
 */
export function Provenance({ bench, extraction }: { bench: Query; extraction: Query }) {
  return (
    <footer
      data-testid="evals-source"
      aria-label="Sources"
      className="sticky bottom-0 z-10 mt-auto flex min-h-10 flex-wrap items-center gap-x-8 gap-y-1 border-t border-border bg-bg px-6 py-2 text-meta text-fg-faint"
    >
      <span className="sr-only">Sources:</span>
      <Source label="Benchmark" query={bench} />
      <Source label="Extraction eval" query={extraction} />
    </footer>
  );
}
