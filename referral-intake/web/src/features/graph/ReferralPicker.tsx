import { useMemo } from "react";
import { X } from "lucide-react";
import type { ReferralRecord } from "@/contracts";
import { useReferrals } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";

const TONE_DOT = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", idle: "bg-fg-faint" } as const;

/** Select over GET /referrals, newest first. The parent syncs the value with ?referral=. */
export function ReferralPicker({
  value,
  record,
  onChange,
}: {
  value: string | undefined;
  /** The selected record, so a fresh upload shows before the list refetches. */
  record: ReferralRecord | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const list = useReferrals();
  const items = useMemo(
    () => [...(list.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [list.data],
  );
  const missing = !!value && !items.some((r) => r.id === value);

  if (list.isPending && !value) return <Skeleton className="h-8 w-80" />;

  return (
    <div className="flex items-center gap-1">
      <Select value={value ?? ""} onValueChange={(v) => onChange(v || undefined)}>
        <SelectTrigger data-testid="referral-picker" className="w-80" aria-label="Referral">
          <SelectValue placeholder={list.isError ? "Could not load referrals" : "Pick a referral"} />
        </SelectTrigger>
        <SelectContent className="max-h-96 w-[var(--radix-select-trigger-width)] overflow-y-auto">
          {items.length === 0 && !missing && <div className="px-2 py-1.5 text-xs text-fg-muted">No referrals yet. Upload a fax from the queue.</div>}
          {items.map((r) => {
            const s = STATUS[r.status];
            return (
              <SelectItem key={r.id} value={r.id} data-id={r.id}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[s.tone])} aria-hidden />
                  <span className="truncate">{r.patient_name ?? r.source_name}</span>
                  <span className="shrink-0 text-xs text-fg-muted">{r.source_name.replace(/\.pdf$/i, "")}</span>
                  <span className="shrink-0 text-xs text-fg-faint">{s.label}</span>
                </span>
              </SelectItem>
            );
          })}
          {missing && value && (
            <SelectItem value={value} data-id={value}>
              {record ? (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{record.source_name}</span>
                  <span className="shrink-0 text-xs text-fg-faint">{STATUS[record.status].label}</span>
                </span>
              ) : (
                <span className="font-mono">{value}</span>
              )}
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      {value && (
        <Button variant="ghost" size="icon" className="size-8" onClick={() => onChange(undefined)} aria-label="Clear referral">
          <X />
        </Button>
      )}
    </div>
  );
}
