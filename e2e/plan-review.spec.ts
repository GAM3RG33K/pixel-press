import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("advanced mode reveals editable controls and save-preset", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("1");
  await page.setInputFiles("#file-input", "/tmp/planreview-sample.mp4");
  await expect(page.getByLabel("Plan review", { exact: false })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("switch", { name: "Advanced user mode" }).click();
  await expect(page.getByRole("combobox", { name: "Container" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Save current as preset/i })).toBeVisible();
});

test("intent beyond rule-engine coverage opens the model-required modal", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("1");
  await page.setInputFiles("#file-input", "/tmp/planreview-sample.mp4");
  await expect(page.getByLabel("Plan review", { exact: false })).toBeVisible({ timeout: 120_000 });
  await page.getByLabel(/Intent \(optional\)/i).fill("rotate 90 degrees and make it exactly 42 megabytes");
  // wait for the debounced recipe resolution
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Compress now/i }).click();
  await expect(page.getByRole("dialog", { name: /Local AI model required/i })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /Download model & encode/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /best-effort/i })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /Local AI model required/i })).toHaveCount(0);
});

test("settings drawer has Backup & Restore with export/import", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Settings/i }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Backup", exact: true }).click();
  await expect(page.getByText("Backup & Restore")).toBeVisible();
  await expect(page.getByRole("button", { name: /Export config/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Import config/i })).toBeVisible();
});
