import type { StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

const DOT: Record<StatusTone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  bad: "bg-bad",
  rejected: "bg-rejected",
  idle: "border border-idle bg-transparent",
};
/** Label colour: only an error is coloured text; rejected and pending are muted. */
const LABEL: Record<StatusTone, string> = {
  ok: "text-fg",
  warn: "text-fg",
  bad: "text-bad",
  rejected: "text-fg-muted",
  idle: "text-fg-muted",
};

/** A 6px status dot. `idle` (pending) is a hollow ring; `running` breathes. */
export function StatusDot({ tone, running = false, className }: { tone: StatusTone; running?: boolean; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", DOT[tone], running && "animate-breathe", className)} />;
}

export type StatusPillProps = {
  tone: StatusTone;
  children: React.ReactNode;
  /** Something is still happening (processing, sending): the dot breathes. */
  running?: boolean;
  /** Muted text after the label, e.g. "· attempt 2". */
  detail?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "children">;

/** Status as a dot plus a text label. No fill, no border: colour sits on the dot. */
export function StatusPill({ tone, children, running, detail, className, ...rest }: StatusPillProps) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2 text-body whitespace-nowrap", className)} data-tone={tone} {...rest}>
      <StatusDot tone={tone} running={running} />
      <span className={cn("truncate", LABEL[tone])}>{children}</span>
      {detail && <span className="truncate text-fg-faint">{detail}</span>}
    </span>
  );
}
