import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests always drive the locally installed Chrome.
 *
 * Do NOT run `playwright install`. Playwright's bundled Chromium can lag
 * patched Chrome releases (e.g. CVE-2026-2441, fixed in 145.0.7632.75), so the
 * channel is pinned and `e2e/engine.spec.ts` asserts the browser major version.
 */
const channel = "chrome";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 120_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5199",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel,
      },
    },
  ],
  webServer: {
    command: "bun run dev --port 5199 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:5199",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
