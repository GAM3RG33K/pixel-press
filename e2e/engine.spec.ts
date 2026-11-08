import { expect, test } from "@playwright/test";

test.describe("PWA shell", () => {
  test("renders the header, status pill, and engine diagnostics", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByText("pixel-press").first()).toBeVisible();
    await expect(page.getByLabel("Engine and AI status")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /run engine check/i }),
    ).toBeVisible();
  });

  test("is cross-origin isolated and can load the FFmpeg core", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto("/");

    const isolated = await page.evaluate(() => window.crossOriginIsolated);
    expect(isolated).toBe(true);

    // Security guard: only run against a Chrome new enough to include the
    // Chromium security fixes we depend on. CVE-2026-2441 was fixed in
    // 145.0.7632.75; require major 146+ because the reduced UA only exposes
    // the major version.
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const chromeMajor = Number(/Chrome\/(\d+)/.exec(userAgent)?.[1] ?? 0);
    expect(chromeMajor).toBeGreaterThanOrEqual(146);

    await page.getByRole("button", { name: /run engine check/i }).click();

    await expect(page.getByText("Core loaded")).toBeVisible({
      timeout: 180_000,
    });

    const summary = page.locator("section[aria-labelledby='engine-check']");
    await expect(summary).toContainText(/Multi-threaded|Single-threaded/);
    await expect(summary).toContainText(/H\.264 (available|missing)/);
    await expect(summary).toContainText(/H\.265 (available|missing)/);
    await expect(summary).toContainText(/VP8 (available|missing)/);

    // Emit the capability text so the test log records the Q-03 answer.
    console.log("ENGINE SUMMARY:", (await summary.innerText()).replace(/\n/g, " | "));

    const encoderLines = await page.evaluate(async () => {
      const mod = await import("/src/lib/ffmpeg/service.ts");
      const service = mod.getFfmpegService();
      await service.getCapabilities();
      const lines = service.lastCapabilityLog as string[];
      return lines.filter((line) =>
        /libx264|libx265|libvpx/.test(line),
      );
    });
    console.log("ENCODER LINES:", encoderLines.join(" || "));
  });
});
