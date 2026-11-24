#!/usr/bin/env node
/**
 * Token lint: no raw colours, pixel sizes or durations outside the token files.
 *
 *   npm run lint:tokens                     # everything; exit 1 on any violation
 *   npm run lint:tokens -- --scope=base     # components, app, features/styleguide
 *   npm run lint:tokens -- --scope=features # the five screens (Phase 2 lanes)
 *   npm run lint:tokens -- --summary        # per-file counts only
 *
 * Scanned: src/components, src/features, src/app (.ts/.tsx/.css).
 * Allowed to hold raw values: src/styles/globals.css, src/lib/motion.ts, *tokens*.
 *
 * Rules
 *   hex            #rgb / #rrggbb / #rrggbbaa
 *   color-fn       rgb() hsl() oklch() … colour functions
 *   palette        Tailwind palette colours (bg-zinc-100, text-white …): use a token
 *   px             any NNpx, incl. arbitrary values (text-[13px], w-[140px])
 *   ms             any NNms; Tailwind duration-NNN / delay-NNN; duration-[…] / delay-[…]
 *   easing         cubic-bezier(…) or `ease: [..]` arrays: use EASE / ease-enter
 *   style-number   a bare number for a length in style={{…}} (React adds px)
 *   motion-number  a bare number for x / y / duration / delay … in a motion config
 *   motion-import  `motion` / framer-motion imports: use `m` from @/lib/motion
 *
 * Escape hatch (narrow, with a reason, for cases a token can't express, e.g.
 * react-pdf canvas sizing or React Flow internals):
 *   foo(12);  // tokens-allow: react-pdf renders the page at a pixel width
 *   // tokens-allow-next-line: React Flow needs numeric node sizes
 *   {/* tokens-allow-next-line: <reason> *\/}   (in JSX)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const scopeArg = (args.find((a) => a.startsWith("--scope=")) ?? "--scope=all").split("=")[1];
const summaryOnly = args.includes("--summary");
const asJson = args.includes("--json");

const DIRS = ["src/components", "src/features", "src/app"];
const ALLOWED = [/^src\/styles\/globals\.css$/, /^src\/lib\/motion\.ts$/, /tokens?\.(ts|css)$/];
const BASE = [/^src\/components\//, /^src\/app\//, /^src\/features\/styleguide\//];

const scopeOf = (rel) => (BASE.some((r) => r.test(rel)) ? "base" : "features");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

/** Blank out comments (keeping line/column positions) so text in comments isn't linted. */
function stripComments(src) {
  let out = "";
  let i = 0;
  let mode = "code"; // code | sq | dq | bt | line | block
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") {
        mode = "line";
        out += "  ";
        i += 2;
        continue;
      }
      if (c === "/" && n === "*") {
        mode = "block";
        out += "  ";
        i += 2;
        continue;
      }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "bt";
      out += c;
      i += 1;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        out += c;
      } else out += " ";
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && n === "/") {
        mode = "code";
        out += "  ";
        i += 2;
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    // inside a string
    if (c === "\\") {
      out += c + (n ?? "");
      i += 2;
      continue;
    }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "bt" && c === "`")) mode = "code";
    else if ((mode === "sq" || mode === "dq") && c === "\n") mode = "code"; // unterminated: recover
    out += c;
    i += 1;
  }
  return out;
}

const PALETTE =
  "black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const LINE_RULES = [
  ["hex", /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g],
  ["color-fn", /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix)\(/g],
  ["palette", new RegExp(`\\b(?:bg|text|border(?:-[trblxy])?|ring|fill|stroke|outline|from|to|via|shadow|decoration|divide|placeholder|caret)-(?:${PALETTE})(?:-\\d{2,3})?(?:\\/\\d+)?\\b`, "g")],
  ["px", /(?<![\w$.])-?\d*\.?\d+px\b/g],
  ["ms", /(?<![\w$.])\d*\.?\d+ms\b/g],
  ["ms", /\b(?:duration|delay)-(?:\d+|\[[^\]]*\])/g],
  ["easing", /cubic-bezier\(|\bease\s*:\s*\[/g],
  ["motion-import", /from\s+["']framer-motion["']|import\s*\{[^}]*\bmotion\b[^}]*\}\s*from\s+["']motion\/react["']|\bmotion\.[a-z]+\b/g],
];

const LENGTH_KEYS =
  "width|height|minWidth|maxWidth|minHeight|maxHeight|top|left|right|bottom|inset|margin\\w*|padding\\w*|gap|rowGap|columnGap|fontSize|borderRadius|borderWidth|outlineOffset|letterSpacing|flexBasis|translateX|translateY";
const MOTION_KEYS = "x|y|z|duration|delay|staggerChildren|delayChildren|repeatDelay|bounce|stiffness|damping|mass|velocity";
const STYLE_NUM = new RegExp(`\\b(?:${LENGTH_KEYS})\\s*:\\s*-?\\d*\\.?\\d+(?!\\s*[%*/+\\-.\\w])`, "g");
const MOTION_NUM = new RegExp(`\\b(?:${MOTION_KEYS})\\s*:\\s*-?\\d*\\.?\\d+(?!\\s*[%*/+\\-.\\w])`, "g");
const PROP_OPEN = /\b(style|initial|animate|exit|whileHover|whileTap|whileFocus|whileInView|whileDrag|transition|variants|layoutTransition)=\{/g;

/** Balanced {...} spans after style= / motion props, as [start, end, prop]. */
function propSpans(code) {
  const spans = [];
  for (const m of code.matchAll(PROP_OPEN)) {
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < code.length; j++) {
      if (code[j] === "{") depth++;
      else if (code[j] === "}" && --depth === 0) break;
    }
    spans.push([m.index, j, m[1]]);
  }
  return spans;
}

function lineCol(code, idx) {
  const before = code.slice(0, idx);
  const line = before.split("\n").length;
  return [line, idx - before.lastIndexOf("\n")];
}

function lint(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  if (ALLOWED.some((r) => r.test(rel))) return null;
  const raw = readFileSync(file, "utf8");
  const rawLines = raw.split("\n");
  const code = stripComments(raw);
  const lines = code.split("\n");
  const found = [];

  const allowed = new Set();
  rawLines.forEach((l, i) => {
    const same = /tokens-allow:\s*(.*)$/.exec(l);
    const next = /tokens-allow-next-line:\s*(.*)$/.exec(l);
    for (const [hit, target] of [
      [same, i + 1],
      [next, i + 2],
    ]) {
      if (!hit) continue;
      const reason = hit[1].replace(/\*\/\s*\}?\s*$/, "").trim();
      if (reason.length < 3) found.push({ line: i + 1, col: 1, rule: "allow-reason", text: "tokens-allow needs a reason" });
      else allowed.add(target);
    }
  });

  lines.forEach((l, i) => {
    for (const [rule, re] of LINE_RULES)
      for (const m of l.matchAll(re)) found.push({ line: i + 1, col: m.index + 1, rule, text: m[0] });
  });
  for (const [start, end, prop] of propSpans(code)) {
    const body = code.slice(start, end + 1);
    const re = prop === "style" ? STYLE_NUM : MOTION_NUM;
    for (const m of body.matchAll(re)) {
      const [line, col] = lineCol(code, start + m.index);
      found.push({ line, col, rule: prop === "style" ? "style-number" : "motion-number", text: m[0] });
    }
    if (prop !== "style")
      for (const m of body.matchAll(STYLE_NUM)) {
        if (/^(?:x|y)\b/.test(m[0])) continue;
        const [line, col] = lineCol(code, start + m.index);
        found.push({ line, col, rule: "motion-number", text: m[0] });
      }
  }
  // variants / transition objects declared outside JSX: `ease: [..]` and numeric timings
  for (const m of code.matchAll(/\b(?:duration|delay|staggerChildren|delayChildren)\s*:\s*\d*\.?\d+(?![\w.])/g)) {
    const [line, col] = lineCol(code, m.index);
    if (!found.some((f) => f.line === line && f.col === col)) found.push({ line, col, rule: "motion-number", text: m[0] });
  }

  const violations = found
    .filter((f) => f.rule === "allow-reason" || !allowed.has(f.line))
    .sort((a, b) => a.line - b.line || a.col - b.col);
  return { file: rel, scope: scopeOf(rel), violations };
}

const results = DIRS.flatMap((d) => walk(path.join(ROOT, d)))
  .map(lint)
  .filter(Boolean)
  .filter((r) => scopeArg === "all" || r.scope === scopeArg);

const bad = results.filter((r) => r.violations.length);
const total = (rs) => rs.reduce((n, r) => n + r.violations.length, 0);

if (asJson) {
  console.log(JSON.stringify(bad, null, 2));
} else {
  for (const r of bad) {
    console.log(`\n${r.file}  (${r.violations.length})`);
    if (!summaryOnly) for (const v of r.violations) console.log(`  ${`${v.line}:${v.col}`.padEnd(8)} ${v.rule.padEnd(14)} ${v.text.trim()}`);
  }
  const byScope = (s) => results.filter((r) => r.scope === s);
  console.log("\nscope       files scanned  files failing  violations");
  for (const s of ["base", "features"]) {
    const rs = byScope(s);
    if (!rs.length) continue;
    console.log(`${s.padEnd(12)}${String(rs.length).padStart(13)}${String(rs.filter((r) => r.violations.length).length).padStart(15)}${String(total(rs)).padStart(12)}`);
  }
  const byRule = {};
  for (const r of bad) for (const v of r.violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
  if (Object.keys(byRule).length) console.log(`\nby rule: ${Object.entries(byRule).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(bad.length ? `\n${total(bad)} violation(s) in ${bad.length} file(s)` : "\ntoken lint: 0 violations");
}
process.exit(bad.length ? 1 : 0);
