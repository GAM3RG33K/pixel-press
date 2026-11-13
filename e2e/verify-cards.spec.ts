import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("post-encode hero card and quality levels rows render", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await page.keyboard.press("1");
  await page.setInputFiles("#file-input", "/tmp/planreview-sample.mp4");
  await expect(page.getByLabel("Plan review", { exact: false })).toBeVisible({ timeout: 120_000 });
  // WASM core can't do VP9 (upstream OOB) — force an mp4-only job for browser verification.
  await page.getByLabel(/Intent \(optional\)/i).fill("convert to mp4");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /Compress now/i }).click();
  // wait for encode to finish and the CompressionStat hero to appear
  await expect(page.getByRole("region", { name: /Compression summary/i })).toBeVisible({ timeout: 180_000 });
  await page.screenshot({ path: "/tmp/card-hero.png", fullPage: false });
  // open quality levels and encode 3 levels
  await page.getByRole("button", { name: /Try 3 quality levels/i }).click();
  await page.getByRole("button", { name: /Encode 3 levels/i }).click();
  await expect(page.getByText("recommended")).toBeVisible({ timeout: 180_000 });
  await page.screenshot({ path: "/tmp/card-rows.png", fullPage: true });
});
