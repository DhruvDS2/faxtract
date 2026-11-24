import { useHealth } from "@/api/queries";
import { confidenceTone } from "@/lib/status";
import { fmtConfidence } from "@/lib/format";
import { cn } from "@/lib/utils";

const TEXT = { ok: "text-fg-muted", idle: "text-fg-muted", warn: "text-warn", bad: "text-bad" } as const;
const FILL = { ok: "bg-chart-1", idle: "bg-chart-1", warn: "bg-warn", bad: "bg-bad" } as const;

export type ConfidenceMeterProps = {
  value: number | null | undefined;
  /** The approval threshold. Given, the meter doesn't query GET /health itself (pass it from the page in tables). */
  threshold?: number;
  /** A tiny bar after the number, with a tick at the threshold. */
  bar?: boolean;
  /** At or above the threshold, fade the number back (fg-faint): only low values draw the eye. */
  quiet?: boolean;
  className?: string;
};

/**
 * Confidence as a two-decimal number. Neutral at or above the threshold, amber
 * below it, red below 0.5. The threshold comes from GET /health, never hardcoded.
 */
export function ConfidenceMeter(props: ConfidenceMeterProps) {
  // a given threshold never subscribes to /health (a table of meters would add one query observer per row)
  return props.threshold != null ? <Meter {...props} /> : <MeterWithHealth {...props} />;
}

function MeterWithHealth(props: ConfidenceMeterProps) {
  const threshold = useHealth().data?.threshold;
  return <Meter {...props} threshold={threshold} />;
}

function Meter({ value, threshold, bar = false, quiet = false, className }: ConfidenceMeterProps) {
  const t = threshold;
  const tone = t == null ? "idle" : confidenceTone(value, t);
  const low = tone === "warn" || tone === "bad";
  const label =
    value == null ? "No confidence" : `Confidence ${fmtConfidence(value)}${t != null ? (low ? `, below the ${t} threshold` : `, at or above the ${t} threshold`) : ""}`;
  return (
    <span
      className={cn("inline-flex items-center gap-2 text-body tabular-nums", TEXT[tone], quiet && !low && "text-fg-faint", className)}
      title={label}
      aria-label={label}
      data-tone={tone}
    >
      {fmtConfidence(value)}
      {bar && value != null && (
        <span aria-hidden className="relative inline-block h-1 w-8 overflow-hidden rounded-full bg-chart-track">
          <span className={cn("absolute inset-y-0 left-0 rounded-full", FILL[tone])} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
          {t != null && <span className="absolute inset-y-0 w-px bg-fg-faint" style={{ left: `${t * 100}%` }} />}
        </span>
      )}
    </span>
  );
}

/** v2-ui name: the plain number with its tone. */
export function Confidence({ value, className }: { value: number | null | undefined; className?: string }) {
  return <ConfidenceMeter value={value} className={className} />;
}
