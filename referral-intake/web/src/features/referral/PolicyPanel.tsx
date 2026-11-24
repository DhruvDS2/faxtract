import { GitCompareArrows, TriangleAlert } from "lucide-react";
import type { ReferralRecord } from "@/contracts";
import { usePolicy } from "@/api/queries";
import { Code } from "@/components/Code";
import { KeyValue } from "@/components/PageHeader";
import { ErrorState } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Excerpt } from "./Excerpt";
import { plural } from "./format";
import { Section } from "./Section";

type Props = { record: ReferralRecord; compareOpen: boolean; onToggleCompare: () => void };

const words = (s: string) => s.replace(/_/g, " ");

/** Prior-auth requirement plus the policy chunks retrieval cited for it. */
export function PolicyPanel({ record, compareOpen, onToggleCompare }: Props) {
  const ready = record.status !== "processing" && record.status !== "failed";
  const policy = usePolicy(record.id, ready);
  const auth = record.auth;
  const citations = policy.data?.citations ?? [];
  const keywords = policy.data?.keywords ?? [];

  return (
    <Section
      id="policy"
      title="Prior auth and policy"
      meta={policy.data && `${plural(citations.length, "citation")}`}
      actions={
        <Button
          variant="secondary"
          size="sm"
          data-testid="btn-compare"
          aria-expanded={compareOpen}
          aria-controls="compare"
          onClick={onToggleCompare}
          disabled={!ready}
        >
          <GitCompareArrows aria-hidden />
          {compareOpen ? "Hide comparison" : "Compare v1 vs v2"}
        </Button>
      }
    >
      {!auth ? (
        <p className="text-sm text-fg-muted">The prior-auth check has not run yet.</p>
      ) : (
        <div className="px-0.5">
          <KeyValue label="Prior auth">
            {auth.required ? <span className="font-medium">Required</span> : <span className="text-fg-muted">Not required</span>}
          </KeyValue>
          {auth.required && (
            <>
              <KeyValue label="Submission">
                {auth.submission_channel ?? <span className="text-fg-faint">-</span>}
                {auth.turnaround_days != null && <span className="text-fg-muted"> · {plural(auth.turnaround_days, "day")} turnaround</span>}
              </KeyValue>
              <KeyValue label="Missing for packet">
                {auth.missing_elements.length ? (
                  <span className="inline-flex items-center gap-1.5 text-warn">
                    <TriangleAlert className="size-3.5" aria-hidden />
                    {auth.missing_elements.map(words).join(", ")}
                  </span>
                ) : (
                  <span className="text-fg-muted">Nothing</span>
                )}
              </KeyValue>
            </>
          )}
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1 flex items-center gap-2">
          <h3 className="text-sm font-medium">Policy citations</h3>
          {keywords.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-1" aria-label="Retrieval keywords">
              {keywords.map((k) => (
                <Badge key={k} tone="outline">
                  {k}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {!ready ? (
          <p className="text-sm text-fg-muted">Citations appear once the pipeline has finished.</p>
        ) : policy.isPending ? (
          <div className="flex flex-col gap-2 py-1" aria-busy>
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            ))}
          </div>
        ) : policy.isError ? (
          <ErrorState error={policy.error} onRetry={() => void policy.refetch()} />
        ) : citations.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {policy.data?.required === false ? "No prior auth is required, so no policy was retrieved." : "Retrieval returned no policy chunks."}
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {citations.map((c, i) => (
              <li key={i} className="py-2 first:pt-1">
                <div className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
                  <Code className="truncate text-fg">{c.source}</Code>
                  {c.payor && <span className="shrink-0">{c.payor}</span>}
                  {c.cpt && (
                    <span className="shrink-0">
                      CPT <Code className="text-fg">{c.cpt}</Code>
                    </span>
                  )}
                  <span className="ml-auto shrink-0 tabular-nums">score {c.score.toFixed(3)}</span>
                </div>
                <Excerpt text={c.text} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </Section>
  );
}
