import { useId } from "react";
import { Code } from "@/components/Code";
import { AnimatePresence } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * A page section: a title, one meta line, then content. Sections are separated by a
 * full-width hairline and whitespace, never boxes.
 */
export function Section({
  title,
  meta,
  testId,
  children,
  className,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section data-testid={testId} aria-labelledby={id} className={cn("border-t border-border px-6 pt-6 pb-8", className)}>
      <h2 id={id} className="text-title text-fg">
        {title}
      </h2>
      {meta && <p className="mt-1 max-w-3xl text-meta text-fg-muted">{meta}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const HASH = /^[0-9a-f]{16,}$/i;

/** A scalar from an artifact: hashes shortened (full value on hover), lists joined. */
export function Value({ v }: { v: unknown }) {
  if (v === null || v === undefined || v === "") return <span className="text-fg-faint">not recorded</span>;
  if (typeof v === "number") return <span className="tabular-nums">{v}</span>;
  if (typeof v === "boolean") return <span>{v ? "yes" : "no"}</span>;
  if (typeof v === "string") return HASH.test(v) ? <Code title={v}>{v.slice(0, 12)}</Code> : <span className="break-words">{v}</span>;
  if (Array.isArray(v)) return <span className="break-words">{v.map(String).join(", ")}</span>;
  return <span className="break-words">{JSON.stringify(v)}</span>;
}

/**
 * A fresh motion presence scope for one-time reveals.
 *
 * RouteTransition renders the first page after a load under <AnimatePresence initial={false}>,
 * and motion passes that through PresenceContext to every m.* in the page, even ones that
 * mount later: their `initial` is skipped. BarComparison's bars would then start full width
 * and never grow on a direct load of /evals. A nested presence scope (initial allowed) keeps
 * the reveal. Base change request filed; remove this once RouteTransition resets the context.
 */
export function RevealScope({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  return (
    <AnimatePresence>
      <div key={id} className={className}>
        {children}
      </div>
    </AnimatePresence>
  );
}
