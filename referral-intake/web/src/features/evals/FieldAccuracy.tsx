import { useMemo } from "react";
import type { ArtifactEnvelope, ExtractionEval } from "@/contracts";
import { Code } from "@/components/Code";
import { ErrorState, LoadingRows } from "@/components/States";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtMs, fmtUsd } from "@/lib/format";
import { fieldLabel, isNotFound, listJoin, pct, plural } from "./copy";
import { Section } from "./parts";

type Query = {
  data?: ArtifactEnvelope<ExtractionEval>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
};

type Row = { field: string; correct: number; total: number; accuracy: number };

const TITLE = "Field accuracy";
const META = "Extraction only: each field the model read, scored against the ground truth";

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** "Date of birth" → "date of birth", but "CPT code" and "ICD-10 codes" keep their case. */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** One field: its name, an inline bar on a 0–100% track, the count and the rate. */
function FieldRow({ r, critical }: { r: Row; critical: boolean }) {
  return (
    <TableRow data-field={r.field}>
      <TableCell className="pl-0">
        <span className="text-fg">{fieldLabel(r.field)}</span>
        {critical && <span className="ml-2 text-meta text-fg-faint">critical</span>}
      </TableCell>
      <TableCell className="w-48" aria-hidden>
        <div className="h-2 w-full rounded-r-sm bg-chart-track">
          <div className="h-full rounded-r-sm bg-chart-2" style={{ width: `${Math.max(0, Math.min(1, r.accuracy)) * 100}%` }} />
        </div>
      </TableCell>
      <TableCell className="w-24 text-right tabular-nums">
        {r.correct}/{r.total}
      </TableCell>
      <TableCell className="w-24 pr-0 text-right tabular-nums">{pct(r.accuracy)}</TableCell>
    </TableRow>
  );
}

function Summary({ s, modelHint }: { s: ExtractionEval["summary"]; modelHint: string | null }) {
  return (
    <div className="space-y-1">
      <p className="text-body text-fg tabular-nums">
        {pct(s.overall_accuracy)} of fields correct overall: {s.fields_correct.toLocaleString("en-US")} of{" "}
        {s.fields_total.toLocaleString("en-US")} across {s.n_files} {plural(s.n_files, "fax", "faxes")}.
      </p>
      <p className="text-meta text-fg-muted tabular-nums">
        {capitalize(s.engine)}
        {" · "}
        {s.model ? (
          <Code>{s.model}</Code>
        ) : (
          <span title={modelHint ?? undefined} className={modelHint ? "underline decoration-dotted underline-offset-4" : undefined}>
            model not recorded
          </span>
        )}
        {" · "}
        {fmtUsd(s.cost.dollars_per_referral)} per fax, {fmtUsd(s.cost.total_dollars, 2)} in all
        {" · "}
        {fmtMs(s.latency_ms.p50)} p50, {fmtMs(s.latency_ms.p95)} p95 per fax
      </p>
    </div>
  );
}

/** Per-field extraction accuracy (evals/extraction_eval.json): imperfect fields worst first, the rest named in one line. */
export function FieldAccuracy({
  query,
  critical,
  modelHint,
}: {
  query: Query;
  /** Fields that gate auto-approval (from the benchmark, when it loaded). */
  critical: string[];
  /** What the benchmark says about the model, when the extraction artifact doesn't record it. */
  modelHint: string | null;
}) {
  const s = query.data?.data.summary;
  const { imperfect, perfect } = useMemo(() => {
    // the artifact lists fields in form order: keep it for the perfect ones, sort the rest worst first
    const rows: Row[] = Object.entries(s?.per_field ?? {}).map(([field, v]) => ({ field, ...v }));
    return {
      imperfect: rows.filter((r) => r.correct < r.total).sort((a, b) => a.accuracy - b.accuracy || a.field.localeCompare(b.field)),
      perfect: rows.filter((r) => r.correct >= r.total),
    };
  }, [s?.per_field]);

  if (query.isPending)
    return (
      <Section testId="evals-field-accuracy" title={TITLE} meta={META}>
        <LoadingRows rows={5} className="max-w-3xl [&>div]:px-0" />
      </Section>
    );

  if (query.isError)
    return (
      <Section testId="evals-field-accuracy" title={TITLE} meta={META}>
        {isNotFound(query.error) ? (
          <div className="space-y-1">
            <p className="text-body font-medium text-fg">No extraction eval yet</p>
            <p className="text-body text-fg-muted">
              Run <Code className="text-fg">python -m evals.run_extraction_eval</Code> to score the model field by field.
            </p>
          </div>
        ) : (
          <ErrorState error={query.error} title="Couldn't load the extraction eval" onRetry={() => void query.refetch()} align="start" className="px-0 py-0" />
        )}
      </Section>
    );

  if (!s) return null;
  const critSet = new Set(critical);
  const shownCritical = imperfect.some((r) => critSet.has(r.field));
  const allPerfectSameTotal = perfect.length > 0 && perfect.every((r) => r.total === perfect[0].total);

  return (
    <Section testId="evals-field-accuracy" title={TITLE} meta={META}>
      <div className="max-w-3xl animate-fade-in space-y-4">
        <Summary s={s} modelHint={modelHint} />
        {imperfect.length > 0 && (
          <Table aria-label="Fields the model got wrong at least once, worst first">
            <TableHeader className="static">
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-0">Field, worst first</TableHead>
                <TableHead className="w-48">
                  <span className="sr-only">Accuracy bar</span>
                </TableHead>
                <TableHead className="w-24 text-right">Correct</TableHead>
                <TableHead className="w-24 pr-0 text-right">Accuracy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imperfect.map((r) => (
                <FieldRow key={r.field} r={r} critical={critSet.has(r.field)} />
              ))}
            </TableBody>
          </Table>
        )}
        {perfect.length > 0 && (
          <p className="text-body text-fg-muted" data-perfect-fields={perfect.length}>
            {imperfect.length === 0 ? "Every field" : `The other ${perfect.length} ${plural(perfect.length, "field")}`} correct on{" "}
            {allPerfectSameTotal ? `all ${perfect[0].total}` : "every"} {plural(allPerfectSameTotal ? perfect[0].total : 2, "fax", "faxes")}
            {imperfect.length > 0 && <>: {listJoin(perfect.map((r) => lowerFirst(fieldLabel(r.field))))}</>}.
          </p>
        )}
        {(shownCritical || s.pricing_note) && (
          <div className="space-y-1 text-meta text-fg-faint">
            {shownCritical && <p>Critical fields gate auto-approval: a wrong value there can reach the RIS.</p>}
            {s.pricing_note && <p>{s.pricing_note}</p>}
          </div>
        )}
      </div>
    </Section>
  );
}
