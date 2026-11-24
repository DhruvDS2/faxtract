import type { StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { StatusDot } from "./StatusPill";

export type StatusLineProps = {
  tone: StatusTone;
  /** What is true now, as a sentence: "Paused for review · 2 reasons". */
  children: React.ReactNode;
  /** Quiet context after the sentence: "referral_013.pdf · received 19:55". */
  detail?: React.ReactNode;
  /** One inline action (a link or a quiet button). */
  action?: React.ReactNode;
  running?: boolean;
} & Omit<React.HTMLAttributes<HTMLParagraphElement>, "children">;

/**
 * The page-header status: one quiet line with a dot. Replaces filled alert banners.
 * Errors read in red text; everything else stays neutral.
 */
export function StatusLine({ tone, children, detail, action, running, className, ...rest }: StatusLineProps) {
  return (
    <p
      role={tone === "bad" ? "alert" : "status"}
      data-tone={tone}
      className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body", className)}
      {...rest}
    >
      <StatusDot tone={tone} running={running} />
      <span className={cn("font-medium", tone === "bad" ? "text-bad" : "text-fg")}>{children}</span>
      {detail && <span className="min-w-0 text-fg-muted">{detail}</span>}
      {action && <span className="inline-flex items-center">{action}</span>}
    </p>
  );
}
