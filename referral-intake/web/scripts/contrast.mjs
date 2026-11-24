#!/usr/bin/env node
/**
 * Measures WCAG 2.x contrast for the token pairs the UI actually uses, in light and
 * dark, straight from src/styles/globals.css (so the table can't drift from the CSS).
 *
 *   node scripts/contrast.mjs            # table + exit 1 if a required pair fails
 *   node scripts/contrast.mjs --markdown # the table pasted into DESIGN.md
 *
 * Levels: "text" needs 4.5:1, "ui" needs 3:1 (WCAG 1.4.11: controls, focus, status
 * dots, chart marks). "info" rows are decorative (hairlines, hover fills) and are
 * listed for reference only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.resolve(HERE, "../src/styles/globals.css"), "utf8");

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const vars = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) vars[m[1]] = m[2];
  return vars;
}
const light = block(":root");
const dark = { ...light, ...block(".dark") };

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const NEED = { text: 4.5, ui: 3, info: 0 };
/** [foreground token, background token, level, where it's used] */
const PAIRS = [
  ["fg", "bg", "text", "body text"],
  ["fg", "surface", "text", "sidebar, table header"],
  ["fg", "selected", "text", "selected row, active nav"],
  ["fg", "raised", "text", "popover, dialog, toast"],
  ["fg-muted", "bg", "text", "secondary text, labels"],
  ["fg-muted", "surface", "text", "nav items, header labels"],
  ["fg-muted", "surface-2", "text", "hovered row / nav item"],
  ["fg-muted", "selected", "text", "selected row meta"],
  ["fg-faint", "bg", "text", "meta, placeholders"],
  ["fg-faint", "surface", "text", "sidebar footer, header meta"],
  ["fg-faint", "surface-2", "text", "meta on a hovered row"],
  ["fg-faint", "selected", "text", "meta on a selected row"],
  ["accent-fg", "accent", "text", "primary button"],
  ["accent-fg", "accent-hover", "text", "primary button, hover"],
  ["accent", "bg", "text", "quiet row action, links"],
  ["accent", "surface-2", "text", "quiet row action on a hovered row"],
  ["accent", "selected", "text", "quiet row action on a selected row"],
  ["accent", "accent-subtle", "text", "quiet action, hover"],
  ["ok", "bg", "text", "status label / dot (sent, approved)"],
  ["warn", "bg", "text", "status label / dot (needs review)"],
  ["bad", "bg", "text", "status label (error, RIS down)"],
  ["bad", "surface", "text", "RIS down in the top bar"],
  ["bad", "selected", "text", "error label on a selected row"],
  ["rejected", "bg", "text", "rejected (muted, terminal)"],
  ["idle", "bg", "text", "pending / processing"],
  ["ok", "ok-bg", "text", "inline success tint"],
  ["warn", "warn-bg", "text", "inline review tint"],
  ["bad", "bad-bg", "text", "inline validation error"],
  ["focus", "bg", "ui", "focus ring"],
  ["focus", "surface", "ui", "focus ring in the sidebar"],
  ["control", "bg", "ui", "input / select / checkbox boundary"],
  ["ok", "surface-2", "ui", "status dot on a hovered row"],
  ["warn", "surface-2", "ui", "status dot on a hovered row"],
  ["bad", "surface-2", "ui", "status dot on a hovered row"],
  ["rejected", "surface-2", "ui", "status dot on a hovered row"],
  ["idle", "surface-2", "ui", "pending ring on a hovered row"],
  ["chart-1", "bg", "ui", "v1 bar"],
  ["chart-2", "bg", "ui", "v2 bar"],
  ["chart-1", "chart-2", "info", "v1 vs v2 bars (also labelled)"],
  ["border", "bg", "info", "hairline divider (decorative)"],
  ["border-strong", "bg", "info", "secondary button edge (text-identified)"],
  ["selected", "bg", "info", "selected row fill (+ aria-selected)"],
  ["surface-2", "bg", "info", "hover fill"],
];

const rows = PAIRS.map(([f, b, level, use]) => {
  const l = ratio(light[f], light[b]);
  const d = ratio(dark[f], dark[b]);
  const need = NEED[level];
  return { f, b, level, use, l, d, ok: !need || (l >= need && d >= need) };
});

const fmt = (r, need) => `${r.toFixed(2)}${need && r < need ? " ✗" : ""}`;
const md = process.argv.includes("--markdown");
if (md) {
  console.log("| Foreground | Background | Need | Light | Dark | Used for |");
  console.log("|---|---|---|---|---|---|");
  for (const r of rows)
    console.log(`| \`${r.f}\` | \`${r.b}\` | ${NEED[r.level] ? `${NEED[r.level]}:1` : "—"} | ${fmt(r.l, NEED[r.level])} | ${fmt(r.d, NEED[r.level])} | ${r.use} |`);
} else {
  for (const r of rows)
    console.log(`${r.ok ? "ok  " : "FAIL"} ${`${r.f} on ${r.b}`.padEnd(30)} ${r.level.padEnd(5)} light ${r.l.toFixed(2).padStart(5)}  dark ${r.d.toFixed(2).padStart(5)}  ${r.use}`);
}
const failed = rows.filter((r) => !r.ok);
if (!md) console.log(failed.length ? `\n${failed.length} required pair(s) below AA` : `\nall ${rows.filter((r) => NEED[r.level]).length} required pairs pass AA in light and dark`);
process.exit(failed.length ? 1 : 0);
