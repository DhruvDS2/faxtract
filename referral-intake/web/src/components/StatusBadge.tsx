import type { AckCode, ReferralStatus } from "@/contracts";
import { Badge } from "@/components/ui/badge";
import { STATUS, ackTone } from "@/lib/status";

export function StatusBadge({ status }: { status: ReferralStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} data-status={status}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {s.label}
    </Badge>
  );
}

export function AckBadge({ code }: { code: AckCode | null }) {
  if (!code) return <Badge tone="idle">no ACK</Badge>;
  return <Badge tone={ackTone(code)} className="font-mono">{code}</Badge>;
}
