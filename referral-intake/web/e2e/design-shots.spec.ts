/**
 * Design review screenshots: every screen and state, light + dark.
 * SHOTS_DIR=docs/design/before (or after) E2E_BASE_URL=http://127.0.0.1:5195 npx playwright test --project=design
 * States that the seeded demo can't show on its own (loading, empty, errors, RIS down)
 * are produced by intercepting the API, never by changing the backend.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../../..", process.env.SHOTS_DIR ?? "docs/design/before");
type Summary = { id: string; status: string; source_name: string };

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript((t) => {
        try { localStorage.setItem("theme", t); } catch { /* ignore */ }
        // <html> does not exist yet when init scripts run: apply once the DOM does
        const apply = () => {
          const el = document.documentElement;
          if (!el) return;
          el.classList.toggle("dark", t === "dark");
          el.dataset.theme = t;
        };
        apply();
        document.addEventListener("DOMContentLoaded", apply);
      }, theme);
    });

    const shot = (page: Page, name: string, fullPage = false) =>
      page.screenshot({ path: `${OUT}/${name}-${theme}.png`, fullPage });

    async function byStatus(page: Page, status: string): Promise<Summary[]> {
      const res = await page.request.get(`/api/referrals?status=${status}`);
      return (await res.json()) as Summary[];
    }
    const delay = (ms: number) => async (route: Route) => {
      await new Promise((r) => setTimeout(r, ms));
      await route.continue().catch(() => undefined); // the test may have moved on
    };
    const fail = (status: number, detail: string) => (route: Route) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ detail, errors: [], status: null, flags: [] }) });

    test("queue", async ({ page }) => {
      await page.goto("/queue");
      await expect(page.getByTestId("queue-row").first()).toBeVisible();
      await page.waitForTimeout(400);
      await shot(page, "01-queue");
      await page.keyboard.press("j"); await page.keyboard.press("j");
      await shot(page, "02-queue-keyboard-selected");
      await page.goto("/queue?status=needs_review");
      await page.waitForTimeout(600);
      await shot(page, "03-queue-filter-needs-review");
    });

    test("queue states", async ({ page }) => {
      await page.route("**/api/referrals", delay(4000));
      await page.goto("/queue");
      await page.waitForTimeout(600);
      await shot(page, "04-queue-loading");
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.route("**/api/referrals", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
      await page.goto("/queue");
      await page.waitForTimeout(800);
      await shot(page, "05-queue-empty");
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.route("**/api/referrals", fail(500, "database is unavailable"));
      await page.goto("/queue");
      await page.waitForTimeout(2500);
      await shot(page, "06-queue-error");
    });

    test("ris down (health)", async ({ page }) => {
      await page.route("**/api/health", (r) => r.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: false, db: true, ris: "down", pipeline: "graph", extractor: "replay", threshold: 0.85 }) }));
      await page.goto("/orders");
      await page.waitForTimeout(1200);
      await shot(page, "07-shell-ris-down-orders");
    });

    test("referral detail", async ({ page }) => {
      const [r] = await byStatus(page, "needs_review");
      await page.goto(`/referrals/${r.id}`);
      await expect(page.getByTestId("fax-viewer")).toBeVisible();
      await page.waitForTimeout(1500);
      await shot(page, "10-detail-needs-review");
      await page.getByTestId("btn-edit").click();
      await page.getByTestId("field-patient_dob").fill("2020-13-45");
      await page.getByTestId("btn-save").click();
      await expect(page.getByTestId("field-error-patient_dob")).toBeVisible();
      await shot(page, "11-detail-edit-422");
      await page.getByTestId("btn-cancel").click();
      await page.getByTestId("btn-compare").click();
      await expect(page.getByTestId("compare-panel")).toBeVisible();
      await page.getByTestId("compare-panel").scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await shot(page, "12-detail-compare");
      await page.getByTestId("btn-reject").click();
      await expect(page.getByTestId("reject-reason")).toBeVisible();
      await shot(page, "13-detail-reject-dialog");
    });

    test("referral detail outcomes", async ({ page }) => {
      for (const [status, name] of [["sent_to_ris", "14-detail-sent-aa"], ["ris_error", "15-detail-ris-error"], ["rejected", "16-detail-rejected"]] as const) {
        const [r] = await byStatus(page, status);
        await page.goto(`/referrals/${r.id}`);
        await expect(page.getByTestId("detail-status")).toBeVisible();
        await page.waitForTimeout(1200);
        await shot(page, name);
      }
      await page.goto("/referrals/doesnotexist");
      await page.waitForTimeout(2500);
      await shot(page, "17-detail-not-found");
    });

    test("pipeline graph", async ({ page }) => {
      await page.goto("/graph");
      await expect(page.getByTestId("graph-canvas")).toBeVisible();
      await page.waitForTimeout(600);
      await shot(page, "20-graph-empty");
      const [paused] = await byStatus(page, "needs_review");
      await page.goto(`/graph?referral=${paused.id}`);
      await expect(page.locator('[data-testid="graph-node"][data-node="human_review"]')).toHaveAttribute("data-state", "paused");
      await page.waitForTimeout(600);
      await shot(page, "21-graph-paused");
      const [sent] = await byStatus(page, "sent_to_ris");
      await page.goto(`/graph?referral=${sent.id}`);
      await page.waitForTimeout(800);
      await shot(page, "22-graph-sent");
      const [err] = await byStatus(page, "ris_error");
      await page.goto(`/graph?referral=${err.id}`);
      await page.locator('[data-testid="graph-node"][data-node="order"]').click();
      await expect(page.getByTestId("node-panel")).toBeVisible();
      await page.waitForTimeout(400);
      await shot(page, "23-graph-ris-error-node-panel");
    });

    test("evals", async ({ page }) => {
      await page.goto("/evals");
      await expect(page.getByTestId("evals-benchmark")).toBeVisible();
      await page.waitForTimeout(1200);
      await shot(page, "30-evals");
      await shot(page, "31-evals-full", true);
      await page.route("**/api/evals/benchmark", fail(404, "benchmark not generated"));
      await page.goto("/evals");
      await page.waitForTimeout(1500);
      await shot(page, "32-evals-benchmark-missing");
    });

    test("ris orders", async ({ page }) => {
      await page.goto("/orders");
      await expect(page.getByTestId("orders-table")).toBeVisible();
      await page.waitForTimeout(600);
      await shot(page, "40-orders");
      await page.route("**/api/orders", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
      await page.goto("/orders");
      await page.waitForTimeout(800);
      await shot(page, "41-orders-empty");
    });
  });
}
