import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Code } from "@/components/Code";
import { cn } from "@/lib/utils";
import { stateDiff, subDiff, type DiffEntry } from "./trace";

const pretty = (v: unknown) => (v === undefined ? "(absent)" : JSON.stringify(v, null, 2));
const BIG = 360; // characters: larger values start collapsed

function Value({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <div className="text-meta text-fg-faint">{label}</div>
      <pre className="mt-0.5 max-h-48 overflow-auto rounded-sm bg-surface px-2 py-1">
        <Code className={cn("block break-all whitespace-pre-wrap text-fg-muted", value === undefined && "text-fg-faint")}>{pretty(value)}</Code>
      </pre>
    </div>
  );
}

function DiffKey({ entry }: { entry: DiffEntry }) {
  const size = pretty(entry.after).length + (entry.before === undefined ? 0 : pretty(entry.before).length);
  const [open, setOpen] = useState(size < BIG);
  const [full, setFull] = useState(false);
  const sub = subDiff(entry.before, entry.after);
  const summary = sub
    ? `${sub.rows.length} changed${sub.same ? `, ${sub.same} unchanged` : ""}`
    : Array.isArray(entry.after)
      ? `${entry.after.length} item${entry.after.length === 1 ? "" : "s"}`
      : null;

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-8 w-full items-center gap-1.5 text-left hover:bg-surface-2"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-fg-faint transition-transform duration-fast ease-enter", open && "rotate-90")} />
        <Code className="font-medium text-fg">{entry.key}</Code>
        <span className="text-meta text-fg-faint">{entry.kind}</span>
        {summary && <span className="ml-auto truncate text-meta text-fg-faint">{summary}</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-2 pb-3 pl-5">
          {sub && !full ? (
            <>
              {sub.rows.map((r) => (
                <div key={r.key} className="flex flex-col gap-1">
                  <Code className="text-fg">{r.key}</Code>
                  {r.before !== undefined && <Value label="Before" value={r.before} />}
                  <Value label={r.before === undefined ? "Written" : "After"} value={r.after} />
                </div>
              ))}
              {sub.same > 0 && (
                <button type="button" onClick={() => setFull(true)} className="self-start text-meta text-fg-muted underline-offset-2 hover:underline">
                  Show the whole object
                </button>
              )}
            </>
          ) : (
            <>
              {entry.before !== undefined && <Value label="Before" value={entry.before} />}
              <Value label={entry.before === undefined ? "Written" : "After"} value={entry.after} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One attempt's input/output state diff: each key the step wrote, before vs after. Unchanged keys are hidden. */
export function StateDiff({ stateIn, delta }: { stateIn: Record<string, unknown> | null; delta: Record<string, unknown> | null }) {
  const { changed, unchanged } = stateDiff(stateIn, delta);
  if (delta == null) return <p className="text-body text-fg-faint">This attempt wrote nothing (it paused or is still running).</p>;
  return (
    <div>
      {changed.length === 0 ? (
        <p className="text-body text-fg-faint">Wrote nothing new.</p>
      ) : (
        changed.map((e) => <DiffKey key={e.key} entry={e} />)
      )}
      {unchanged.length > 0 && (
        <p className="mt-1 text-meta text-fg-faint">
          {unchanged.length} unchanged key{unchanged.length === 1 ? "" : "s"} hidden: {unchanged.join(", ")}
        </p>
      )}
    </div>
  );
}
