import type { BenchmarkReport } from "@/contracts";
import { Accordion, AccordionItem } from "@/components/Accordion";
import { Code } from "@/components/Code";
import { KeyValue } from "@/components/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime, fmtMs, humanize } from "@/lib/format";
import { stepLabel } from "@/lib/steps";
import { fieldLabel, listJoin, plural } from "./copy";
import { Value } from "./parts";

/** "app.rag.retrieve_3step (3-step hybrid RAG on pgvector)" → the module in mono, the description plain. */
function Retriever({ text }: { text: string }) {
  const m = /^(\S+)\s*\(([^)]+)\)\s*$/.exec(text);
  if (!m) return <span className="break-words">{text}</span>;
  return (
    <>
      <Code>{m[1]}</Code> <span className="text-fg-muted">{m[2]}</span>
    </>
  );
}

function StepTimings({ report }: { report: BenchmarkReport }) {
  const rows = Object.entries(report.v2.node_timings_ms);
  if (!rows.length) return <p className="text-body text-fg-muted">The benchmark recorded no per-step timings.</p>;
  return (
    <div className="max-w-2xl">
      <Table aria-label="v2 time per step, from trace events">
        <TableHeader className="static">
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-0">Step</TableHead>
            <TableHead className="text-right">Runs</TableHead>
            <TableHead className="text-right">p50</TableHead>
            <TableHead className="text-right">p95</TableHead>
            <TableHead className="pr-0 text-right">Mean</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([node, t]) => (
            <TableRow key={node} data-node={node}>
              <TableCell className="pl-0">
                <span className="text-fg">{stepLabel(node)}</span>{" "}
                <Code className="text-meta text-fg-faint">{node}</Code>
              </TableCell>
              <TableCell className="text-right tabular-nums">{t.n ?? <span className="text-fg-faint">-</span>}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtMs(t.p50)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtMs(t.p95)}</TableCell>
              <TableCell className="pr-0 text-right tabular-nums">{fmtMs(t.mean)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {new Set(rows.map(([, t]) => t.n)).size > 1 && (
        <p className="mt-2 text-meta text-fg-faint">A step runs only for the referrals that reach it, so the run counts differ.</p>
      )}
    </div>
  );
}

const scalar = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function HowItRan({ report }: { report: BenchmarkReport }) {
  const corpus = Object.entries(report.corpus).filter(([, v]) => scalar(v));
  const extraction = Object.entries(report.extraction).filter(([k, v]) => scalar(v) && k !== "note");
  const note = typeof report.extraction.note === "string" ? report.extraction.note : null;
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <KeyValue label="Generated">
          <span className="tabular-nums">{fmtDateTime(report.generated_at)}</span>
        </KeyValue>
        <KeyValue label="Commit">{report.git_commit ? <Value v={report.git_commit} /> : <span className="text-fg-faint">not recorded</span>}</KeyValue>
        <KeyValue label="v1 retriever">
          <Retriever text={report.v1.retriever} />
        </KeyValue>
        <KeyValue label="v2 retriever">
          <Retriever text={report.v2.retriever} />
        </KeyValue>
        <KeyValue label="Critical fields">{listJoin(report.critical_fields.map(fieldLabel))}</KeyValue>
        {corpus.map(([k, v]) => (
          <KeyValue key={`c-${k}`} label={`Corpus ${humanize(k)}`}>
            <Value v={v} />
          </KeyValue>
        ))}
        {extraction.map(([k, v]) => (
          <KeyValue key={`e-${k}`} label={`Extraction ${humanize(k)}`}>
            <Value v={v} />
          </KeyValue>
        ))}
      </div>
      {note && <p className="text-body text-fg-muted">{note}</p>}
      {report.notes.length > 0 && (
        <ul className="list-disc space-y-2 pl-4 text-body text-fg-muted marker:text-fg-faint">
          {report.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Engineer detail, kept quiet: per-step timings and how the run was set up, behind one-open panels. */
export function MethodDetails({ report }: { report: BenchmarkReport }) {
  const steps = Object.keys(report.v2.node_timings_ms).length;
  const commit = report.git_commit?.slice(0, 7);
  return (
    <Accordion className="mt-0">
      <AccordionItem
        value="timings"
        title="Show per-step timings for v2"
        summary={steps ? `${steps} ${plural(steps, "step")}, from trace events` : "none recorded"}
        data-testid="evals-node-timings"
      >
        <StepTimings report={report} />
      </AccordionItem>
      <AccordionItem
        value="method"
        title="How the benchmark was run"
        summary={
          <span className="tabular-nums">
            {report.notes.length} {plural(report.notes.length, "note")}
            {commit && (
              <>
                {" · commit "}
                <Code>{commit}</Code>
              </>
            )}
          </span>
        }
      >
        <HowItRan report={report} />
      </AccordionItem>
    </Accordion>
  );
}
