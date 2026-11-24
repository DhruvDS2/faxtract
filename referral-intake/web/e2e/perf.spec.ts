/**
 * Perf + reduced-motion checks for the UI-upgrade gate.
 * - No long tasks (>50 ms) while a transition runs (<html data-transitioning="true">).
 * - With prefers-reduced-motion, animated containers never get a transform (fades only).
 * Run against a production build (vite preview) proxied to the demo API:
 *   E2E_BASE_URL=http://127.0.0.1:5196 npx playwright test --project=perf
 */
import { expect, test, type Page } from "@playwright/test";

async function watchLongTasks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __longDuringTransition: number[] };
    w.__longDuringTransition = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (document.documentElement.dataset.transitioning === "true") w.__longDuringTransition.push(Math.round(e.duration));
      }
    }).observe({ type: "longtask", buffered: true });
  });
}
const longTasks = (page: Page) => page.evaluate(() => (window as unknown as { __longDuringTransition: number[] }).__longDuringTransition);

test("no long tasks during transitions", async ({ page }) => {
  await watchLongTasks(page);
  await page.goto("/queue");
  await expect(page.getByTestId("queue-row").first()).toBeVisible();
  await page.waitForTimeout(800);
  for (const to of ["/evals", "/orders", "/graph", "/queue"]) {
    await page.goto(to, { waitUntil: "commit" }).catch(() => undefined);
    await page.waitForTimeout(700);
  }
  // in-app navigation: nav clicks (route crossfade) and row -> detail (shared element)
  for (const label of [/evals/i, /ris orders/i, /queue/i]) {
    await page.getByRole("link", { name: label }).first().click();
    await page.waitForTimeout(600);
  }
  await page.getByTestId("queue-row").first().click();
  await page.waitForURL(/\/referrals\//);
  await page.waitForTimeout(800);
  const tasks = await longTasks(page);
  expect(tasks, `long tasks during transitions: ${tasks.join(", ")} ms`).toEqual([]);
});

test("reduced motion: fades only", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/queue");
  await expect(page.getByTestId("queue-row").first()).toBeVisible();
  const transforms: string[] = [];
  const sample = async () => {
    const t = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-testid="route-transition"], [data-morph]')]
        .map((el) => getComputedStyle(el).transform)
        .filter((v) => v && v !== "none"),
    );
    transforms.push(...t);
  };
  await page.getByRole("link", { name: /evals/i }).first().click();
  for (let i = 0; i < 8; i++) { await sample(); await page.waitForTimeout(40); }
  await page.getByRole("link", { name: /queue/i }).first().click();
  await page.getByTestId("queue-row").first().click();
  for (let i = 0; i < 8; i++) { await sample(); await page.waitForTimeout(40); }
  expect(transforms, "no transforms under reduced motion").toEqual([]);
});
