import { defineConfig, devices } from "@playwright/test";

// Runs against a live demo (make demo): web on :5173, API on :8000.
// E2E_BASE_URL overrides. Artifacts: docs/gates/screens (screenshots) and
// test-results/ (video, traces; gitignored).
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    { name: "demo", testMatch: /demo\.spec\.ts/, use: { video: { mode: "on", size: { width: 1440, height: 900 } }, viewport: { width: 1440, height: 900 } } },
    { name: "screens", testMatch: /(^|\/)screens\.spec\.ts/, use: { viewport: { width: 1440, height: 900 } } },
    { name: "design", testMatch: /design-shots\.spec\.ts/, use: { viewport: { width: 1440, height: 900 } } },
    { name: "videos", testMatch: /design-videos\.spec\.ts/, use: { video: { mode: "on", size: { width: 1440, height: 900 } }, viewport: { width: 1440, height: 900 } } },
    { name: "perf", testMatch: /perf\.spec\.ts/, use: { viewport: { width: 1440, height: 900 } } },
  ],
});
