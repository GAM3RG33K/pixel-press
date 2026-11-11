import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * End-to-end local pipeline + privacy assertion.
 *
 * Generates a tiny clip with the system FFmpeg, drops it into the app,
 * and verifies that no outbound network request body carries file metadata.
 */

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";

test.use({ serviceWorkers: "block" });

test("local encode: probe runs with zero file-metadata in network traffic", async ({ page }) => {
  const dirPath = mkdtempSync(join(tmpdir(), "pixel-press-e2e-"));
  const srcPath = join(dirPath, "clip.mp4");
  execFileSync(
    FFMPEG,
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=10",
      "-t", "1", "-pix_fmt", "yuv420p",
      "-c:v", "libx264", "-qp", "0", "-preset", "ultrafast",
      srcPath,
    ],
    { stdio: "inherit" },
  );

  const forbidden = /clip\.mp4|testsrc|fileName|poster|optimized/i;
  const outboundBodies: string[] = [];
  page.on("request", (request) => {
    const body = request.postData();
    if (body) outboundBodies.push(body);
  });

  await page.goto("/");

  // Route into the single-file flow via the keyboard map, then inject the clip.
  await page.keyboard.press("1");
  await expect(page.getByRole("heading", { name: "Smart Compress" })).toBeVisible();

  // Inject the generated clip into the hidden file input
  await page.setInputFiles("#file-input", srcPath);

  // The probe completes asynchronously; wait for Compress now to enable.
  const compressButton = page.getByRole("button", { name: /Compress now/i });
  await expect(compressButton).toBeEnabled({ timeout: 30_000 });

  for (const body of outboundBodies) {
    expect(body).not.toMatch(forbidden);
  }
});
