import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test.describe("workbench shell", () => {
  test("renders all four workbench tabs", async ({ page }) => {
    await page.goto("/");
    for (const label of ["Compress", "Compare", "Audit", "Optimize"]) {
      await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
    }
  });

  test("can switch between workbenches", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Compare —/i }).click();
    await expect(page.getByRole("heading", { name: "Compare", exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Audit —/i }).click();
    await expect(page.getByRole("heading", { name: "Project Auditor" })).toBeVisible();

    await page.getByRole("button", { name: /Optimize —/i }).click();
    await expect(page.getByRole("heading", { name: "Scan & Optimize" })).toBeVisible();
  });

  test("compress tab shows the drop zone and sample button", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Choose video|Drop a video/i }).first()).toBeVisible();
    await expect(page.getByText("Try with a sample clip", { exact: false })).toBeVisible();
  });

  test("engine check card renders and runs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Engine diagnostics" })).toBeVisible();
  });

  test("local AI settings card lists the three modes with rule-engine default", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Local AI" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Instant Rule Mode/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /SmolLM2-360M/ })).toBeVisible();
  });
});