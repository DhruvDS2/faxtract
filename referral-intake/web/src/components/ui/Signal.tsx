import { cn } from "../../lib/cn";
import { THRESHOLD } from "../../lib/format";

export type Tone = "neutral" | "good" | "warn" | "bad";

const DOT: Record<Tone, string> = {
  neutral: "bg-faint",
  good: "bg-green",
  warn: "bg-amber",
  bad: "bg-red",
};

const TEXT: Record<Tone, string> = {
  neutral: "text-muted",
  good: "text-muted",
  warn: "text-amber",
  bad: "text-red",
};

/** A 5px status dot. Carries the colour so the label beside it can stay neutral. */
export const Dot = ({ tone = "neutral", className }: { tone?: Tone; className?: string }) => (
  <span className={cn("h-[5px] w-[5px] shrink-0 rounded-full", DOT[tone], className)} />
);

/** Dot plus label, for status read as prose rather than as a chip. */
export function Status({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12px]", TEXT[tone])}>
      <Dot tone={tone} />
      {children}
    </span>
  );
}

/**
 * Confidence as a plain percentage. It only earns colour when it falls below
 * the threshold, which is the only case a reviewer has to do anything about.
 */
export function Confidence({ value, className }: { value: number; className?: string }) {
  const low = value < THRESHOLD;
  return (
    <span
      className={cn("nums text-[12px]", low ? "text-amber" : "text-faint", className)}
      title={`Extraction confidence ${(value * 100).toFixed(0)}%`}
    >
      {Math.round(value * 100)}%
    </span>
  );
}
