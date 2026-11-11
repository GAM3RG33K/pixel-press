import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test.describe("the press — unified home", () => {
  test("home renders brand, tagline, goal chips and the drop surface", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "pixel-press" })).toBeVisible();
    await expect(page.getByText("Compress like you mean it.", { exact: false })).toBeVisible();
    for (const chip of ["Smallest file", "Good enough quality", "Social 1080p", "Keep it crisp"]) {
      await expect(page.getByRole("radio", { name: chip })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /Drop a video/i })).toBeVisible();
  });

  test("hotkey 1 opens the single-file flow, back returns home", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("1");
    await expect(page.getByRole("heading", { name: "Smart Compress" })).toBeVisible();
    await page.getByRole("button", { name: /Back to the press/i }).click();
    await expect(page.getByRole("heading", { name: "pixel-press" })).toBeVisible();
  });

  test("hotkey 2 opens the folder shrink flow, back returns home", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("2");
    await expect(page.getByRole("heading", { name: "Folder shrink" })).toBeVisible();
    await page.getByRole("button", { name: /Back to the press/i }).click();
    await expect(page.getByRole("heading", { name: "pixel-press" })).toBeVisible();
  });

  test("no workbench tabs exist anymore", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: /Workbenches/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Compare —/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Audit —/i })).toHaveCount(0);
  });

  test("help overlay toggles with ?", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard map" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Keyboard map" })).toHaveCount(0);
  });

  test("settings drawer opens with Engine section and Local AI card", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Settings/i }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Instant Rule Mode/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /SmolLM2-360M/ })).toBeVisible();
  });
});
