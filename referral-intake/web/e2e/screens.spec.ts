/**
 * QA gate: every screen and state, screenshotted to docs/gates/screens/, plus
 * the gate assertions (the demo referral is in the queue; its trace covers
 * every node on the path it took). Runs against the seeded live demo, after
 * demo.spec.ts.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SCREENS = path.resolve(HERE, "../../../docs/gates/screens");
type Summary = { id: string; status: string; source_name: string };

async function byStatus(page: Page, status: string): Promise<Summary[]> {
  const res = await page.request.get(`/api/referrals?status=${status}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Summary[];
}

const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: `${SCREENS}/${name}.png`, fullPage });

test("queue: all, needs review, RIS errors", async ({ page }) => {
  await page.goto("/queue");
  await expect(page.getByTestId("queue-row").first()).toBeVisible();
  await shot(page, "queue");
  // gate: the referral uploaded by the demo is in the queue
  const sent = await byStatus(page, "sent_to_ris");
  const demo = sent.find((r) => r.source_name.includes("referral_013"));
  expect(demo, "demo upload referral_013 should be sent_to_ris").toBeTruthy();
  await expect(page.locator(`[data-testid="queue-row"][data-id="${demo!.id}"]`)).toBeVisible();
  await page.goto("/queue");
  await page.getByTestId("filter-status").click();
  await page.getByRole("option", { name: /needs review/i }).click();
  await shot(page, "queue-needs-review");
});

test("referral detail: review, edit with 422, compare, reject dialog", async ({ page }) => {
  const [r] = await byStatus(page, "needs_review");
  await page.goto(`/referrals/${r.id}`);
  await expect(page.getByTestId("fax-viewer")).toBeVisible();
  await page.waitForTimeout(1500); // let the PDF paint
  await shot(page, "detail-needs-review");

  await page.getByTestId("btn-edit").click();
  await page.getByTestId("field-patient_dob").fill("2020-13-45");
  await page.getByTestId("btn-save").click();
  await expect(page.getByTestId("field-error-patient_dob")).toBeVisible();
  await shot(page, "detail-edit-422");
  await page.getByTestId("btn-cancel").click();

  await page.getByTestId("btn-compare").click();
  await expect(page.getByTestId("compare-panel")).toBeVisible();
  await page.getByTestId("compare-panel").scrollIntoViewIfNeeded();
  await shot(page, "detail-compare-v1-v2");

  await page.getByTestId("btn-reject").click();
  await expect(page.getByTestId("reject-reason")).toBeVisible();
  await shot(page, "detail-reject-dialog");
});

test("referral detail: sent (AA), RIS error, rejected", async ({ page }) => {
  for (const [status, name] of [["sent_to_ris", "detail-sent-aa"], ["ris_error", "detail-ris-error"], ["rejected", "detail-rejected"]] as const) {
    const [r] = await byStatus(page, status);
    expect(r, `a seeded ${status} referral`).toBeTruthy();
    await page.goto(`/referrals/${r.id}`);
    await expect(page.getByTestId("detail-status")).toBeVisible();
    await page.waitForTimeout(1200);
    await shot(page, name, true);
  }
});

test("pipeline graph: empty, paused, sent, RIS error with node panel; trace covers the path", async ({ page }) => {
  await page.goto("/graph");
  await expect(page.getByTestId("graph-canvas")).toBeVisible();
  await shot(page, "graph-empty");

  const [paused] = await byStatus(page, "needs_review");
  await page.goto(`/graph?referral=${paused.id}`);
  await expect(page.locator('[data-testid="graph-node"][data-node="human_review"]')).toHaveAttribute("data-state", "paused");
  await shot(page, "graph-paused");

  const sent = (await byStatus(page, "sent_to_ris")).find((r) => r.source_name.includes("referral_013"))!;
  await page.goto(`/graph?referral=${sent.id}`);
  // gate: every node the referral passed through shows as done
  const trace = (await (await page.request.get(`/api/referrals/${sent.id}/trace`)).json()) as { node: string; status: string }[];
  const visited = [...new Set(trace.filter((e) => e.status !== "running").map((e) => e.node))];
  expect(visited).toEqual(expect.arrayContaining(["extract", "validate", "eligibility", "auth", "human_review", "order"]));
  for (const n of visited) {
    await expect(page.locator(`[data-testid="graph-node"][data-node="${n}"]`)).toHaveAttribute("data-state", "done");
  }
  await shot(page, "graph-sent");

  const [err] = await byStatus(page, "ris_error");
  await page.goto(`/graph?referral=${err.id}`);
  await page.locator('[data-testid="graph-node"][data-node="order"]').click();
  await expect(page.getByTestId("node-panel")).toBeVisible();
  await shot(page, "graph-ris-error-node-panel");
});

test("evals and RIS orders", async ({ page }) => {
  await page.goto("/evals");
  await expect(page.getByTestId("evals-benchmark")).toBeVisible();
  await expect(page.getByTestId("evals-false-approvals")).toBeVisible();
  await expect(page.getByTestId("evals-field-accuracy")).toBeVisible();
  await shot(page, "evals", true);

  await page.goto("/orders");
  await expect(page.getByTestId("orders-table")).toBeVisible();
  await expect(page.getByTestId("btn-retry").first()).toBeVisible();
  await shot(page, "orders");
});
