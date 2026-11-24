#!/usr/bin/env node
/**
 * Bundle budget: the JavaScript /queue needs before its first meaningful paint.
 *
 *   npm run check:bundle                 # vite build --manifest, then measure; exit 1 if over budget
 *   node scripts/measure-initial-js.mjs --no-build [--json] [--budget=300000]
 *
 * Counted (from dist/.vite/manifest.json and dist/index.html):
 *   - shell: the entry script, its static-import closure and any <link rel="modulepreload">
 *   - /queue route: the lazily loaded queue page chunk (requested at once on /queue,
 *     before the queue can paint) and its static-import closure
 * Not counted, but listed: chunks requested after first paint (motion features,
 * the idle preload of the referral detail) and CSS.
 * Sizes are bytes; gzip is level 9. Budget: gzip < 300 kB (300,000 bytes).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const args = process.argv.slice(2);
const BUDGET = Number((args.find((a) => a.startsWith("--budget=")) ?? "--budget=300000").split("=")[1]);
const QUEUE = /src\/features\/queue\/QueuePage\.tsx$/;
const AFTER_PAINT = [/src\/lib\/motion-features\.ts$/, /src\/features\/referral\/ReferralPage\.tsx$/];

if (!args.includes("--no-build")) {
  execFileSync(path.join(ROOT, "node_modules/.bin/vite"), ["build", "--manifest", "--logLevel", "warn"], { cwd: ROOT, stdio: "inherit" });
}
const manifestPath = path.join(DIST, ".vite/manifest.json");
if (!existsSync(manifestPath)) {
  console.error("no dist/.vite/manifest.json: run without --no-build (it builds with --manifest)");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const html = readFileSync(path.join(DIST, "index.html"), "utf8");

const sizes = new Map();
const size = (file) => {
  if (!sizes.has(file)) {
    const buf = readFileSync(path.join(DIST, file));
    sizes.set(file, { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length });
  }
  return sizes.get(file);
};

/** Static-import closure of a manifest key, as output files. */
function closure(key, seen = new Set()) {
  const chunk = manifest[key];
  if (!chunk || seen.has(chunk.file)) return seen;
  seen.add(chunk.file);
  for (const k of chunk.imports ?? []) closure(k, seen);
  return seen;
}

const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
const shell = closure(entryKey);
for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/([^"]+\.js)"/g)) shell.add(m[1]);

const queueKey = Object.keys(manifest).find((k) => QUEUE.test(k) && manifest[k].isDynamicEntry);
const queue = queueKey ? [...closure(queueKey)].filter((f) => !shell.has(f)) : [];

const later = new Set();
for (const k of Object.keys(manifest))
  if (AFTER_PAINT.some((r) => r.test(k)) && manifest[k].isDynamicEntry)
    for (const f of closure(k)) if (!shell.has(f) && !queue.includes(f)) later.add(f);

const sum = (files) => [...files].reduce((t, f) => ({ raw: t.raw + size(f).raw, gzip: t.gzip + size(f).gzip }), { raw: 0, gzip: 0 });
const kb = (n) => `${(n / 1000).toFixed(1)} kB`;
const row = (f) => `  ${f.padEnd(52)} ${kb(size(f).raw).padStart(10)} ${kb(size(f).gzip).padStart(10)}`;

const shellT = sum(shell);
const queueT = sum(queue);
const total = { raw: shellT.raw + queueT.raw, gzip: shellT.gzip + queueT.gzip };
const css = Object.values(manifest).flatMap((c) => (c.isEntry ? c.css ?? [] : []));
const cssT = sum(new Set(css));
const pass = total.gzip < BUDGET;

if (args.includes("--json")) {
  console.log(JSON.stringify({ budget: BUDGET, pass, total, shell: { files: [...shell], ...shellT }, queue: { files: queue, ...queueT }, afterPaint: { files: [...later], ...sum(later) }, css: cssT }, null, 2));
} else {
  console.log(`\n${"file".padEnd(54)} ${"raw".padStart(10)} ${"gzip".padStart(10)}`);
  console.log("shell (entry + static imports + modulepreload)");
  [...shell].sort((a, b) => size(b).raw - size(a).raw).forEach((f) => console.log(row(f)));
  console.log(queueKey ? "/queue route chunk (+ its static imports)" : "/queue route: in the entry (not code-split)");
  queue.sort((a, b) => size(b).raw - size(a).raw).forEach((f) => console.log(row(f)));
  console.log(`\n  shell        ${kb(shellT.raw).padStart(10)} raw ${kb(shellT.gzip).padStart(10)} gzip`);
  console.log(`  /queue route ${kb(queueT.raw).padStart(10)} raw ${kb(queueT.gzip).padStart(10)} gzip`);
  console.log(`  INITIAL JS   ${kb(total.raw).padStart(10)} raw ${kb(total.gzip).padStart(10)} gzip   (${total.raw} / ${total.gzip} bytes)`);
  console.log(`  after paint  ${kb(sum(later).raw).padStart(10)} raw ${kb(sum(later).gzip).padStart(10)} gzip   (motion features, referral preload; not counted)`);
  console.log(`  CSS          ${kb(cssT.raw).padStart(10)} raw ${kb(cssT.gzip).padStart(10)} gzip   (not counted)`);
  console.log(`\nbudget: gzip < ${kb(BUDGET)} → ${pass ? "PASS" : "FAIL"} (${kb(total.gzip)})`);
}
process.exit(pass ? 0 : 1);
