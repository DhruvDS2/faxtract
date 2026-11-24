import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Code } from "@/components/Code";
import { cn } from "@/lib/utils";
import { stateDiff, subDiff, type DiffEntry } from "./trace";

const pretty = (v: unknown) => (v === undefined ? "(absent)" : JSON.stringify(v, null, 2));
const BIG = 360; // characters: larger values start collapsed

function JsonBlock({ value, label }: { value: unknown; label: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs text-fg-muted">{label}</div>
      <pre className="max-h-64 overflow-auto rounded-md border border-border bg-surface-2 p-2">
        <Code className={cn("block break-all whitespace-pre-wrap", value === undefined && "text-fg-faint")}>{pretty(value)}</Code>
      </pre>
    </div>
  );
}

function KindTag({ kind }: { kind: DiffEntry["kind"] }) {
  return <span className="text-xs text-fg-faint">{kind}</span>;
}

function DiffKey({ entry }: { entry: DiffEntry }) {
  const size = pretty(entry.after).length + (entry.before === undefined ? 0 : pretty(entry.before).length);
  const [open, setOpen] = useState(size < BIG);
  const [full, setFull] = useState(false);
  const sub = subDiff(entry.before, entry.after);
  const summary = sub
    ? `${sub.rows.length} field${sub.rows.length === 1 ? "" : "s"} changed${sub.same ? `, ${sub.same} unchanged` : ""}`
    : Array.isArray(entry.after)
      ? `${entry.after.length} item${entry.after.length === 1 ? "" : "s"}`
      : null;

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-8 w-full items-center gap-1.5 px-1 text-left hover:bg-surface-2"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-fg-faint transition-transform duration-150", open && "rotate-90")} />
        <Code className="font-medium text-fg">{entry.key}</Code>
        <KindTag kind={entry.kind} />
        {summary && <span className="ml-auto truncate text-xs text-fg-muted">{summary}</span>}
      </button>
      {open && (
        <div className="space-y-2 px-1 pb-3">
          {sub && !full ? (
            <>
              {sub.rows.map((r) => (
                <div key={r.key} className="space-y-1">
                  <Code className="text-fg-muted">{r.key}</Code>
                  <div className="grid grid-cols-2 gap-2">
                    <JsonBlock label="Before" value={r.before} />
                    <JsonBlock label="After" value={r.after} />
                  </div>
                </div>
              ))}
              {sub.same > 0 && (
                <button type="button" onClick={() => setFull(true)} className="text-xs text-accent hover:underline">
                  Show full objects
                </button>
              )}
            </>
          ) : (
            <div className={cn("grid gap-2", entry.before === undefined ? "grid-cols-1" : "grid-cols-2")}>
              {entry.before !== undefined && <JsonBlock label="Before" value={entry.before} />}
              <JsonBlock label={entry.before === undefined ? "Written" : "After"} value={entry.after} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Input/output state diff of one node execution: for each key it wrote, before vs after. */
export function StateDiff({
  stateIn,
  delta,
}: {
  stateIn: Record<string, unknown> | null;
  delta: Record<string, unknown> | null;
}) {
  const { changed, unchanged } = stateDiff(stateIn, delta);
  if (delta == null) return <div className="text-xs text-fg-faint">No state recorded for this execution.</div>;
  if (changed.length === 0)
    return (
      <div className="text-xs text-fg-faint">
        Wrote nothing new{unchanged.length ? ` (${unchanged.length} unchanged key${unchanged.length === 1 ? "" : "s"} hidden)` : ""}.
      </div>
    );
  return (
    <div>
      <div className="rounded-md border border-border px-2">
        {changed.map((e) => (
          <DiffKey key={e.key} entry={e} />
        ))}
      </div>
      {unchanged.length > 0 && (
        <div className="mt-1 text-xs text-fg-faint">
          {unchanged.length} unchanged key{unchanged.length === 1 ? "" : "s"} hidden: {unchanged.join(", ")}
        </div>
      )}
    </div>
  );
}
