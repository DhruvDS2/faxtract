import type { RisOrderRow } from "@/contracts";
import { isSettling } from "@/api/queries";
import type { StatusTone } from "@/lib/status";

/** What the RIS did with an order, in one status: the ACK is folded in. */
export type OrderKind = "acknowledged" | "rejected" | "no_ack" | "sending" | "sent";
export type OrderState = { kind: OrderKind; label: string; tone: StatusTone; running?: boolean };

/**
 * "Sent · ACK AA", "RIS rejected · AE", "RIS didn't acknowledge", "Sending to RIS".
 * `sending`: a retry from this page is in flight.
 */
export function orderState(r: RisOrderRow, sending = false): OrderState {
  if (sending) return { kind: "sending", label: "Sending to RIS", tone: "idle", running: true };
  if (r.ack_code === "AA") return { kind: "acknowledged", label: "Sent · ACK AA", tone: "ok" };
  if (r.ack_code) return { kind: "rejected", label: `RIS rejected · ${r.ack_code}`, tone: "bad" };
  if (isSettling(r.status)) return { kind: "sending", label: "Sending to RIS", tone: "idle", running: true };
  if (r.status === "sent_to_ris") return { kind: "sent", label: "Sent to RIS", tone: "ok" };
  return { kind: "no_ack", label: "RIS didn't acknowledge", tone: "bad" };
}

/** The RIS rejected it or never answered: what the "Not acknowledged" tab and the headline count. */
export const isUnacknowledged = (r: RisOrderRow) => {
  const k = orderState(r).kind;
  return k === "rejected" || k === "no_ack";
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The display line, from the API's rows. */
export function headline(rows: RisOrderRow[]): string {
  const unacked = rows.filter(isUnacknowledged).length;
  const sending = rows.filter((r) => orderState(r).kind === "sending").length;
  if (!rows.length) return "No orders sent to the RIS yet";
  if (unacked) return `${unacked} ${plural(unacked, "order wasn't", "orders weren't")} acknowledged by the RIS`;
  if (sending) return `${sending} ${plural(sending, "order is", "orders are")} on the way to the RIS`;
  return rows.length === 1 ? "The RIS acknowledged the order" : `The RIS acknowledged all ${rows.length} orders`;
}

/** "23 sent · 20 acknowledged (AA) · 1 rejected (AE) · 2 never reached the RIS": non-zero parts only. */
export function metaLine(rows: RisOrderRow[]): string {
  const states = rows.map((r) => ({ r, s: orderState(r) }));
  const count = (kind: OrderKind) => states.filter((x) => x.s.kind === kind).length;
  const rejected = states.filter((x) => x.s.kind === "rejected");
  const codes = [...new Set(rejected.map((x) => x.r.ack_code))].join(", ");
  const noAck = states.filter((x) => x.s.kind === "no_ack");
  const neverReached = noAck.filter((x) => !x.r.in_ris).length;
  const noAnswer = noAck.length - neverReached;
  const parts = [
    `${rows.length} sent`,
    count("acknowledged") && `${count("acknowledged")} acknowledged (AA)`,
    rejected.length && `${rejected.length} rejected (${codes})`,
    neverReached && `${neverReached} never reached the RIS`,
    noAnswer && `${noAnswer} with no ACK`,
    count("sending") && `${count("sending")} sending`,
  ];
  return parts.filter(Boolean).join(" · ");
}
