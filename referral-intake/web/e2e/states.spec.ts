/**
 * States review: every screen in every mock fault mode, light + dark.
 *
 *   WEB_PORT=5199 npm run dev:mock -- --host 127.0.0.1
 *   E2E_BASE_URL=http://127.0.0.1:5199 npx playwright test --project=states
 *   SHOTS_DIR=docs/design/after/states (default; relative to the repo root, or absolute)
 *
 * Modes come from src/api/mock.ts (normal, empty, error, ris-down, slow,
 * extraction-pending, long-names, one), set through localStorage "mock" before the app loads. The
 * theme is set exactly like design-shots.spec.ts (localStorage "theme" + .dark).
 * Shots: <mode>-<screen>-<theme>.png. Nothing here talks to a real backend.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type Page } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../../..", process.env.SHOTS_DIR ?? "docs/design/after/states");

type Rec = { id: string; status: string };
const data = JSON.parse(readFileSync(path.resolve(HERE, "../src/api/mockData.json"), "utf8")) as { records: Rec[] };
const first = (status: string) => data.records.find((r) => r.status === status)?.id ?? data.records[0].id;
const REVIEW = first("needs_review");
const RIS_ERROR = first("ris_error");
const PENDING = "upending"; // created by mock.ts in extraction-pending mode
const ONE = "m02005"; // the single referral in mock "one" mode

const MODES = ["normal", "empty", "error", "ris-down", "slow", "extraction-pending", "long-names", "one"] as const;
type Mode = (typeof MODES)[number];

function screens(mode: Mode) {
  const detail = mode === "extraction-pending" ? PENDING : mode === "one" ? ONE : REVIEW;
  const graph = mode === "extraction-pending" ? PENDING : mode === "one" ? ONE : mode === "ris-down" ? RIS_ERROR : REVIEW;
  return [
    { name: "queue", url: "/queue" },
    { name: "detail", url: `/referrals/${detail}` },
    { name: "graph", url: `/graph?referral=${graph}` },
    { name: "evals", url: "/evals" },
    { name: "orders", url: "/orders" },
  ];
}

/** Settled: no route fallback and nothing aria-busy (bounded), then let transitions finish. */
async function settle(page: Page, mode: Mode) {
  if (mode === "slow") {
    await page.waitForTimeout(900); // mid-request: the loading state is the point
    return;
  }
  await page
    .waitForFunction(() => !document.querySelector('[data-testid="route-fallback"], [aria-busy="true"]'), undefined, { timeout: 12_000 })
    .catch(() => undefined);
  await page.waitForTimeout(900);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    for (const mode of MODES) {
      test(`${mode}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript(
          ([t, m]) => {
            try {
              localStorage.setItem("theme", t);
              localStorage.setItem("mock", m);
              sessionStorage.removeItem("mock");
            } catch {
              /* ignore */
            }
            const apply = () => {
              const el = document.documentElement;
              if (!el) return;
              el.classList.toggle("dark", t === "dark");
              el.dataset.theme = t;
            };
            apply();
            document.addEventListener("DOMContentLoaded", apply);
          },
          [theme, mode] as const,
        );
        const shot = (name: string) => page.screenshot({ path: `${OUT}/${mode}-${name}-${theme}.png` });

        for (const s of screens(mode)) {
          await page.goto(s.url);
          await settle(page, mode);
          await shot(s.name);
        }

        if (mode === "ris-down") {
          // approving while the RIS is down ends in a RIS error on the detail page
          await page.goto(`/referrals/${REVIEW}`);
          await settle(page, mode);
          const approve = page.getByTestId("btn-approve");
          if (await approve.isEnabled().catch(() => false)) {
            await approve.click();
            await page.waitForTimeout(1500);
          }
          await shot("detail-after-approve");
        }
      });
    }
  });
}
