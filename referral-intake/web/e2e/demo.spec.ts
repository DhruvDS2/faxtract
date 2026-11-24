/**
 * The "Demo in 90 seconds" script (README), end to end against a live demo:
 *   upload fax -> nodes light up -> pauses at human review -> fix field ->
 *   approve -> resumes -> ORM sent -> ACK -> Evals page v1 vs v2.
 * The recorded video of this test is the demo video.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const FAX = path.resolve(HERE, "../../corpus/out/referral_013.pdf");
const SCREENS = path.resolve(HERE, "../../../docs/gates/screens");
const beat = (page: Page, ms = 1200) => page.waitForTimeout(ms); // pacing for the video

const node = (page: Page, id: string) => page.locator(`[data-testid="graph-node"][data-node="${id}"]`);

test("demo: upload -> graph pauses -> fix -> approve -> ACK -> evals", async ({ page }) => {
  await page.goto("/queue");
  await expect(page.getByTestId("queue-table")).toBeVisible();
  await expect(page.getByTestId("pipeline-badge")).toContainText("graph");
  await beat(page, 1500);

  // 1. upload: the app navigates to the pipeline graph for the new referral
  await page.getByTestId("upload-input").setInputFiles(FAX);
  await page.waitForURL(/\/graph\?referral=/);
  const id = new URL(page.url()).searchParams.get("referral")!;
  await expect(page.getByTestId("graph-canvas")).toBeVisible();

  // 2. nodes light up: extraction runs (replayed at its recorded speed) ...
  await expect(node(page, "extract")).toHaveAttribute("data-state", "running", { timeout: 15_000 });
  await page.screenshot({ path: `${SCREENS}/demo-01-graph-running.png` });
  // ... and the graph pauses at human review
  await expect(node(page, "human_review")).toHaveAttribute("data-state", "paused", { timeout: 60_000 });
  await expect(node(page, "extract")).toHaveAttribute("data-state", "done");
  await beat(page, 2000);
  await page.screenshot({ path: `${SCREENS}/demo-02-graph-paused.png` });

  // 3. Fix & resume -> referral detail in edit mode
  await page.getByTestId("btn-fix-resume").click();
  await page.waitForURL(new RegExp(`/referrals/${id}`));
  const first = page.getByTestId("field-patient_first_name");
  await expect(first).toBeVisible();
  await expect(first).toHaveValue(/ciara/i); // the real model misread "Clara"
  await beat(page);
  await page.screenshot({ path: `${SCREENS}/demo-03-fix-field.png` });
  await first.fill("Clara");
  await beat(page, 800);
  await page.getByTestId("btn-save").click();
  await expect(page.getByTestId("field-patient_first_name")).toContainText("Clara");
  await beat(page);

  // 4. approve -> the graph resumes, sends the ORM, the RIS ACKs
  await page.getByTestId("btn-approve").click();
  await expect(page.getByTestId("detail-status")).toContainText(/sent to ris/i, { timeout: 30_000 });
  await expect(page.getByTestId("order-ack")).toContainText("AA");
  await page.getByTestId("order-ack").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("order-message")).toContainText("ORM^O01");
  await beat(page, 2000);
  await page.screenshot({ path: `${SCREENS}/demo-04-ack.png`, fullPage: true });

  // 5. the graph shows the resumed path through order
  await page.goto(`/graph?referral=${id}`);
  await expect(node(page, "order")).toHaveAttribute("data-state", "done");
  await beat(page, 2000);
  await page.screenshot({ path: `${SCREENS}/demo-05-graph-sent.png` });

  // 6. evals: v1 vs v2
  await page.goto("/evals");
  await expect(page.getByTestId("evals-benchmark")).toBeVisible();
  await expect(page.getByTestId("evals-source")).toContainText("benchmark_v1_v2.json");
  await beat(page, 2500);
  await page.screenshot({ path: `${SCREENS}/demo-06-evals.png`, fullPage: true });
});
