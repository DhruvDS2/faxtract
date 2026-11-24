/**
 * Design videos for the UI-upgrade gate (docs/design/videos/):
 *   human-review.webm  a paused referral: why it stopped -> fix a field -> Approve -> graph resumes -> "Order sent · ACK AA"
 *   graph-lights-up.webm  upload referral_040 (auto-approves under replay) and watch every step light up to "sent"
 * The 90-second demo video comes from demo.spec.ts (copied by the gate).
 * Run against a live demo:  E2E_BASE_URL=http://127.0.0.1:5195 npx playwright test --project=videos
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../../../docs/design/videos");
const CORPUS = path.resolve(HERE, "../../corpus/out");
const beat = (page: Page, ms = 1200) => page.waitForTimeout(ms);
const node = (page: Page, id: string) => page.locator(`[data-testid="graph-node"][data-node="${id}"]`);

async function saveVideo(page: Page, name: string) {
  const video = page.video();
  await page.close();
  if (!video) return;
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(await video.path(), path.join(OUT, `${name}.webm`));
}

test("human-review moment", async ({ page }) => {
  await page.goto("/queue");
  await page.getByTestId("upload-input").setInputFiles(path.join(CORPUS, "referral_057.pdf"));
  await page.waitForURL(/\/graph\?referral=/);
  const id = new URL(page.url()).searchParams.get("referral")!;
  await expect(node(page, "human_review")).toHaveAttribute("data-state", "paused", { timeout: 60_000 });
  // the review moment proper starts on the detail page
  await page.goto(`/referrals/${id}`);
  await expect(page.getByTestId("detail-status")).toBeVisible();
  await beat(page, 2000);
  await page.getByTestId("btn-edit").click();
  const urgency = page.getByTestId("field-urgency");
  await expect(urgency).toBeVisible();
  await beat(page, 800);
  // urgency is a select in edit mode; pick "Routine" (the printed value)
  await urgency.click();
  await page.getByRole("option", { name: /routine/i }).click();
  await beat(page, 800);
  await page.getByTestId("btn-save").click();
  await beat(page, 1500);
  await page.getByTestId("btn-approve").click();
  await expect(page.getByTestId("order-ack")).toContainText("AA", { timeout: 30_000 });
  await beat(page, 3000);
  await saveVideo(page, "human-review");
});

test("pipeline graph lights up", async ({ page }) => {
  await page.goto("/queue");
  await page.getByTestId("upload-input").setInputFiles(path.join(CORPUS, "referral_040.pdf"));
  await page.waitForURL(/\/graph\?referral=/);
  await expect(node(page, "extract")).toHaveAttribute("data-state", "running", { timeout: 15_000 });
  // 040 passes the gate, so the run goes straight through order to the RIS
  await expect(node(page, "order")).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  await beat(page, 2500);
  await node(page, "order").click();
  await expect(page.getByTestId("node-panel")).toBeVisible();
  await beat(page, 2500);
  await saveVideo(page, "graph-lights-up");
});
