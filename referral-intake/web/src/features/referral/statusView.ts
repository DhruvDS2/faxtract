import type { ReferralRecord, ReferralStatus, ReferralSummary, TraceEvent } from "@/contracts";
import type { StatusTone } from "@/lib/status";
import { fmtWhen, ordinalAttempt, plural } from "./format";

/** Graph nodes in plain words (coordinator first). */
export const NODE_WORDS: Record<string, string> = {
  extract: "Reading the fax",
  validate: "Checking the fields",
  eligibility: "Checking coverage (270/271)",
  auth: "Checking prior auth",
  retrieve: "Finding the payor's policy",
  packet: "Building the auth packet",
  human_review: "Pausing for review",
  order: "Sending the order",
  ris_wait: "Waiting for the RIS",
};

export type StatusView = { tone: StatusTone; text: string; running: boolean; detail: string };

/** The node the pipeline is on right now, if the trace says one is running. */
export function runningNode(trace: TraceEvent[] | undefined): string | null {
  const last = trace?.at(-1);
  return last && last.status === "running" ? last.node : null;
}

const received = (source: string, createdAt: string) => `${source} · received ${fmtWhen(createdAt)}`;

/** The header's one quiet line for a referral at rest (the approve flow overrides it). */
export function statusView(record: ReferralRecord, reasons: number, trace: TraceEvent[] | undefined): StatusView {
  const detail = received(record.source_name, record.created_at);
  const o = record.order;
  switch (record.status) {
    case "processing": {
      const node = runningNode(trace);
      return { tone: "idle", text: `${node ? (NODE_WORDS[node] ?? "Reading the fax") : "Reading the fax"}…`, running: true, detail };
    }
    case "needs_review":
      return { tone: "warn", text: reasons ? `Paused for review · ${plural(reasons, "reason")}` : "Paused for review", running: false, detail };
    case "approved":
      return { tone: "ok", text: "Approved · sending to RIS", running: true, detail };
    case "auto_approved":
      return { tone: "ok", text: "Auto-approved · sending to RIS", running: true, detail };
    case "sent_to_ris":
      return o.ack_code && o.ack_code !== "AA"
        ? { tone: "bad", text: `RIS rejected the order · ACK ${o.ack_code}`, running: false, detail }
        : {
            tone: "ok",
            text: o.ack_code ? `Sent to RIS · ACK ${o.ack_code}` : "Sent to RIS",
            running: false,
            detail: `${o.order_id ?? "order"} · ${ordinalAttempt(o.attempts)}${o.sent_at ? ` · ${fmtWhen(o.sent_at)}` : ""}`,
          };
    case "ris_error":
      return {
        tone: "bad",
        text: o.ack_code && o.ack_code !== "AA" ? `RIS rejected the order · ACK ${o.ack_code}` : "RIS didn't acknowledge",
        running: false,
        detail: `${ordinalAttempt(o.attempts)}${o.sent_at ? ` · ${fmtWhen(o.sent_at)}` : ""} · ${record.source_name}`,
      };
    case "rejected": {
      const r = [...record.reviews].reverse().find((x) => x.action === "reject");
      return {
        tone: "rejected",
        text: r?.reviewer ? `Rejected by ${r.reviewer}` : "Rejected",
        running: false,
        detail: r ? `${fmtWhen(r.at)} · ${record.source_name}` : detail,
      };
    }
    case "failed":
      return { tone: "bad", text: "Couldn't read this fax", running: false, detail };
  }
}

const SUMMARY_TEXT: Record<ReferralStatus, { tone: StatusTone; text: string; running: boolean }> = {
  processing: { tone: "idle", text: "Reading the fax…", running: true },
  needs_review: { tone: "warn", text: "Paused for review", running: false },
  approved: { tone: "ok", text: "Approved · sending to RIS", running: true },
  auto_approved: { tone: "ok", text: "Auto-approved · sending to RIS", running: true },
  sent_to_ris: { tone: "ok", text: "Sent to RIS", running: false },
  ris_error: { tone: "bad", text: "RIS didn't acknowledge", running: false },
  rejected: { tone: "rejected", text: "Rejected", running: false },
  failed: { tone: "bad", text: "Couldn't read this fax", running: false },
};

/** Before the full record arrives: the same line from the cached queue row. */
export function summaryView(s: ReferralSummary): StatusView {
  const detail = received(s.source_name, s.created_at);
  if (s.status === "sent_to_ris" && s.ack_code)
    return s.ack_code === "AA"
      ? { tone: "ok", text: "Sent to RIS · ACK AA", running: false, detail }
      : { tone: "bad", text: `RIS rejected the order · ACK ${s.ack_code}`, running: false, detail };
  return { ...SUMMARY_TEXT[s.status], detail };
}
