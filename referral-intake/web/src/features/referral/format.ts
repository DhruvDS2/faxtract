import type { AckCode, Eligibility } from "@/contracts";
import type { StatusTone } from "@/lib/status";
import { fmtDateTime } from "@/lib/format";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const fmtMoney = (v: number | null | undefined) => (v == null ? null : usd.format(v));
export const fmtPercent = (v: number | null | undefined) => (v == null ? null : `${Number(v.toFixed(1))}%`);

export const ELIGIBILITY: Record<Eligibility["status"], { label: string; tone: StatusTone }> = {
  active_in_network: { label: "Active · in network", tone: "ok" },
  active_out_of_network: { label: "Active · out of network", tone: "warn" },
  terminated: { label: "Coverage terminated", tone: "bad" },
  not_found: { label: "Member not found", tone: "bad" },
};

export const ACK_MEANING: Record<AckCode, string> = {
  AA: "accepted",
  AE: "application error",
  AR: "rejected",
};

/** Policy chunks are markdown; show them as plain prose. */
export const plainExcerpt = (text: string) =>
  text
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * A policy chunk is "<doc title>\n## <section>\n<body>". The title repeats on every
 * chunk (the source already names the doc), so split out the section and the body.
 */
export function chunkParts(text: string): { section: string | null; body: string } {
  const lines = text.split("\n");
  let i = 0;
  if (lines.length > 1 && !/^#{2,}/.test(lines[0]) && /\u2014|Medical Policy/i.test(lines[0])) i = 1;
  let section: string | null = null;
  if (lines[i]?.startsWith("#")) {
    section = lines[i].replace(/^#+\s*/, "").trim() || null;
    i += 1;
  }
  const body = plainExcerpt(lines.slice(i).join("\n"));
  return body ? { section, body } : { section: null, body: plainExcerpt(text) };
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** "prior_imaging" → "prior imaging". */
export const words = (s: string) => s.replace(/_/g, " ");

/** "a", "a and b", "a, b and c". */
export const listOf = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** "19:55" today, else "2026-11-23 19:55". */
export function fmtWhen(iso: string | null | undefined, now = new Date()) {
  if (!iso) return "-";
  const d = new Date(iso);
  const today = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return today ? fmtDateTime(iso).slice(11) : fmtDateTime(iso);
}

export const ordinalAttempt = (n: number) => (n <= 1 ? "first attempt" : `attempt ${n}`);

/** The modifier shown in shortcut hints. */
export const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";
