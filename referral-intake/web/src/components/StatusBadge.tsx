import type { AckCode, ReferralStatus } from "@/contracts";
import { STATUS, isRunning, statusText, statusTone } from "@/lib/status";
import { Code } from "./Code";
import { StatusDot, StatusPill } from "./StatusPill";

/** A referral's status (dot + label). Kept name from v2-ui; renders a StatusPill. */
export function StatusBadge({ status, className }: { status: ReferralStatus; className?: string }) {
  return (
    <StatusPill tone={statusTone(status)} running={isRunning(status)} data-status={status} className={className}>
      {STATUS[status].label}
    </StatusPill>
  );
}

/** One status column with the ACK folded in: "Sent to RIS · AA", "RIS error · no ACK". */
export function ReferralStatusPill({ status, ack, className }: { status: ReferralStatus; ack?: AckCode | null; className?: string }) {
  const s = statusText(status, ack);
  return (
    <StatusPill tone={s.tone} running={isRunning(status)} data-status={status} className={className}>
      {s.label}
    </StatusPill>
  );
}

/** An HL7 ACK code in mono; AE/AR get a red dot, a missing ACK reads "no ACK". */
export function AckBadge({ code }: { code: AckCode | null }) {
  if (!code) return <span className="text-body text-fg-faint">no ACK</span>;
  return (
    <span className="inline-flex items-center gap-1.5" data-ack={code}>
      <StatusDot tone={code === "AA" ? "ok" : "bad"} />
      <Code className={code === "AA" ? "text-fg-muted" : "text-bad"}>{code}</Code>
    </span>
  );
}
