export const fmtConfidence = (v: number | null | undefined) => (v == null ? "-" : v.toFixed(2));

export const fmtMs = (ms: number | null | undefined) => {
  if (ms == null) return "-";
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
};

export const fmtUsd = (v: number | null | undefined, digits = 4) => (v == null ? "-" : `$${v.toFixed(digits)}`);

export const fmtPct = (num: number, den: number) => (den ? `${((num / den) * 100).toFixed(1)}%` : "-");

export const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return "-";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const fmtAge = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return "-";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const humanize = (field: string) => field.replace(/_/g, " ").replace(/^patient /, "").replace(/\bnpi\b/i, "NPI").replace(/\bcpt\b/i, "CPT").replace(/\bicd10\b/i, "ICD-10");

/** X12 (270/271): segments end with "~"; show one per line. Not for HL7 -- its MSH encoding characters contain "~". */
export const segments = (msg: string | null | undefined) => (msg ?? "").split(/\r\n|\r|\n|~/).filter(Boolean);

/** HL7 v2: segments are separated by \r. */
export const hl7Segments = (msg: string | null | undefined) => (msg ?? "").split(/\r\n|\r|\n/).filter(Boolean);
