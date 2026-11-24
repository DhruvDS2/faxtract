import { useMemo } from "react";
import type { ReferralRecord, ReferralSummary } from "@/contracts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusDot } from "@/components/StatusPill";
import { STATUS, statusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

const file = (name: string) => name.replace(/\.pdf$/i, "");

/**
 * A quiet select over GET /referrals, newest first: no border until hovered or
 * focused, so the page's one action stays the only loud thing in the header.
 */
export function ReferralPicker({
  value,
  items,
  record,
  failed,
  onChange,
}: {
  value: string | undefined;
  items: ReferralSummary[] | undefined;
  /** The selected record, so a fresh upload shows before the list refetches. */
  record: ReferralRecord | undefined;
  failed: boolean;
  onChange: (id: string | undefined) => void;
}) {
  const sorted = useMemo(() => [...(items ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)), [items]);
  const missing = !!value && !sorted.some((r) => r.id === value);

  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v || undefined)}>
      <SelectTrigger
        data-testid="referral-picker"
        aria-label="Referral"
        className={cn(
          "w-72 border-transparent bg-transparent text-fg-muted hover:border-border-strong hover:bg-bg",
          "data-[state=open]:border-border-strong",
        )}
      >
        <SelectValue placeholder={failed ? "Couldn't load referrals" : "Pick a referral"} />
      </SelectTrigger>
      <SelectContent className="max-h-96 w-(--radix-select-trigger-width) overflow-y-auto">
        {sorted.length === 0 && !missing && (
          <div className="px-2 py-1.5 text-meta text-fg-muted">No referrals yet. Upload a fax from the queue.</div>
        )}
        {sorted.map((r) => (
          <SelectItem key={r.id} value={r.id} data-id={r.id}>
            <span className="flex min-w-0 items-center gap-2">
              <StatusDot tone={statusTone(r.status)} />
              <span className="truncate text-fg">{r.patient_name ?? file(r.source_name)}</span>
              <span className="shrink-0 text-meta text-fg-faint">{r.patient_name ? file(r.source_name) : STATUS[r.status].label}</span>
            </span>
          </SelectItem>
        ))}
        {missing && value && (
          <SelectItem value={value} data-id={value}>
            <span className="truncate">{record ? file(record.source_name) : value}</span>
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
