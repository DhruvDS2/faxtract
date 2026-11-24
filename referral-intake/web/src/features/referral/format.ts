import type { AckCode, Eligibility } from "@/contracts";
import type { Tone } from "@/lib/status";

/**
 * HL7 v2 segments are separated by \r. Not lib/format.segments(): that also splits
 * on "~", which is one of HL7's MSH-2 encoding characters (^~\&) and would cut MSH in two.
 */
export const hl7Lines = (msg: string | null | undefined) => (msg ?? "").split(/\r\n|\r|\n/).filter(Boolean);

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const fmtMoney = (v: number | null | undefined) => (v == null ? null : usd.format(v));
export const fmtPercent = (v: number | null | undefined) => (v == null ? null : `${Number(v.toFixed(1))}%`);

export const ELIGIBILITY: Record<Eligibility["status"], { label: string; tone: Tone }> = {
  active_in_network: { label: "Active · in network", tone: "ok" },
  active_out_of_network: { label: "Active · out of network", tone: "warn" },
  terminated: { label: "Coverage terminated", tone: "bad" },
  not_found: { label: "Member not found", tone: "bad" },
};

export const ACK_MEANING: Record<AckCode, string> = {
  AA: "Application accept",
  AE: "Application error",
  AR: "Application reject",
};

/** Policy chunks are markdown; show them as plain prose. */
export const plainExcerpt = (text: string) =>
  text
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The modifier shown in shortcut hints. */
export const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";
