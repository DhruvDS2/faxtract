import { useEffect, useRef, useState } from "react";
import type { ReferralRecord, TraceEvent } from "@/contracts";
import { useTrace } from "@/api/queries";
import { DURATION_MS } from "@/lib/motion";
import type { StatusTone } from "@/lib/status";

export type PathState = "done" | "running" | "pending" | "error";
export type PathStep = { id: "review" | "order" | "ack"; label: string; state: PathState };

export type FlowView = {
  tone: StatusTone;
  text: string;
  running: boolean;
  path: PathStep[];
};

/** Last displayed step: 0 approved, 1 sending, 2 order sent, 3 ACK (or the RIS failure). */
const LAST = 3;

const maxSeq = (trace: TraceEvent[] | undefined) => (trace ?? []).reduce((n, e) => Math.max(n, e.seq), 0);

/** How far the data says the resume has got, for the events since Approve was pressed. */
function reachedStep(record: ReferralRecord, since: TraceEvent[], attemptsBefore: number): number {
  const s = record.status;
  if (s === "ris_error" || (s === "sent_to_ris" && record.order.ack_code)) return LAST;
  const orderDone = since.some((e) => e.node === "order" && (e.status === "ok" || e.status === "error"));
  if (s === "sent_to_ris" || orderDone || record.order.attempts > attemptsBefore) return 2;
  const orderRunning = since.some((e) => e.node === "order" && e.status === "running");
  const resumed = since.some((e) => e.node === "human_review" && e.status === "ok");
  if (s === "approved" || s === "auto_approved" || orderRunning || resumed) return 1;
  return 0;
}

/**
 * The human-review moment after Approve: the header steps through
 * Approved → Sending to RIS → Order sent → Sent to RIS · ACK AA, one step per 200 ms
 * at most, and never ahead of the data (the referral record and its live trace).
 */
export function useApproveFlow(id: string, record: ReferralRecord | undefined, onDone?: () => void) {
  const [active, setActive] = useState(false);
  const [shown, setShown] = useState(-1);
  const finished = active && shown >= LAST;
  // The trace polls live only while the flow runs.
  const trace = useTrace(id, { live: active && !finished }).data;
  const seqBefore = useRef(0);
  const attemptsBefore = useRef(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const since = (trace ?? []).filter((e) => e.seq > seqBefore.current);
  const reached = active && record ? reachedStep(record, since, attemptsBefore.current) : -1;

  useEffect(() => {
    if (!active || shown >= reached) return;
    const t = window.setTimeout(() => setShown((n) => n + 1), DURATION_MS.state);
    return () => window.clearTimeout(t);
  }, [active, shown, reached]);

  useEffect(() => {
    if (finished) doneRef.current?.();
  }, [finished]);

  const start = () => {
    seqBefore.current = maxSeq(trace);
    attemptsBefore.current = record?.order.attempts ?? 0;
    setActive(true);
    setShown(0);
  };
  const cancel = () => {
    setActive(false);
    setShown(-1);
  };

  let view: FlowView | null = null;
  if (active && shown >= 0 && record) {
    const ack = record.order.ack_code;
    const failed = shown >= LAST && (record.status === "ris_error" || (!!ack && ack !== "AA"));
    const ackLabel = shown >= LAST && ack ? `ACK ${ack}` : "ACK";
    const path: PathStep[] = [
      { id: "review", label: "Human review", state: "done" },
      { id: "order", label: "Order", state: shown >= 2 ? (failed && !record.order.message ? "error" : "done") : shown === 1 ? "running" : "pending" },
      { id: "ack", label: ackLabel, state: shown >= LAST ? (failed ? "error" : "done") : shown === 2 ? "running" : "pending" },
    ];
    if (shown === 0) view = { tone: "ok", text: "Approved", running: true, path };
    else if (shown === 1) view = { tone: "ok", text: "Sending to RIS", running: true, path };
    else if (shown === 2) view = { tone: "ok", text: "Order sent · waiting for the ACK", running: true, path };
    else if (failed)
      view = {
        tone: "bad",
        text: record.status === "ris_error" && !ack ? "RIS didn't acknowledge" : `RIS rejected the order · ACK ${ack}`,
        running: false,
        path,
      };
    else view = { tone: "ok", text: ack ? `Sent to RIS · ACK ${ack}` : "Sent to RIS", running: false, path };
  }

  return { active, finished, view, start, cancel };
}
