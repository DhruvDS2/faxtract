import { useHealth } from "@/api/queries";
import { confidenceTone } from "@/lib/status";
import { fmtConfidence } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE_TEXT = { ok: "text-fg", idle: "text-fg-muted", warn: "text-warn", bad: "text-bad" } as const;
const TONE_BAR = { ok: "bg-fg-faint", idle: "bg-fg-faint", warn: "bg-warn", bad: "bg-bad" } as const;

/** Two-decimal confidence with a 3-step meter; tone uses the server threshold. */
export function Confidence({ value, className }: { value: number | null | undefined; className?: string }) {
  const threshold = useHealth().data?.threshold ?? 0.85;
  const tone = confidenceTone(value, threshold);
  const steps = value == null ? 0 : value >= threshold ? 3 : value >= 0.5 ? 2 : 1;
  return (
    <span className={cn("inline-flex items-center gap-1.5 tabular-nums", TONE_TEXT[tone], className)}>
      <span className="inline-flex gap-px" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn("h-2.5 w-1 rounded-[1px]", i <= steps ? TONE_BAR[tone] : "bg-border")} />
        ))}
      </span>
      {fmtConfidence(value)}
    </span>
  );
}
