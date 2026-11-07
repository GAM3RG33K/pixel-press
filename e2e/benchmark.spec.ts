import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Manual benchmark (not part of the default suite).
 *
 *   BENCH=1 bunx playwright test e2e/benchmark.spec.ts
 *
 * Generates a synthetic clip with the system FFmpeg (no network, no committed
 * media), encodes it with the browser WASM core, and measures size, wall time
 * and SSIM for a sweep of H.264 CRFs and two VP9 CRFs.
 */

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";

test.skip(
  process.env.BENCH !== "1",
  "Set BENCH=1 to run the encoder benchmark (slow).",
);

test.describe.configure({ mode: "serial" });
test.use({ serviceWorkers: "block" });

let sourcePath = "";
let workDir = "";

test.beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "pixel-press-bench-"));
  sourcePath = join(workDir, "source.mp4");
  execFileSync(
    FFMPEG,
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
      "-t", "3", "-pix_fmt", "yuv420p",
      "-c:v", "libx264", "-qp", "0", "-preset", "ultrafast",
      sourcePath,
    ],
    { stdio: "inherit" },
  );
});

async function serveSource(page: import("@playwright/test").Page, body: Buffer) {
  await page.route("**/bench-source.mp4", (route) =>
    route.fulfill({ status: 200, contentType: "video/mp4", body }),
  );
}

test("calibration: h264 CRF sweep with SSIM", async ({ page }) => {
  test.setTimeout(900_000);
  await serveSource(page, readFileSync(sourcePath));
  await page.goto("/");

  const results = await page.evaluate(async () => {
    const log: string[] = [];
    const step = (msg: string) => {
      log.push(msg);
      console.log("STEP:", msg);
    };

    try {
      step("importing service");
      const { getFfmpegService } = await import("/src/lib/ffmpeg/service.ts");
      const { parseSsim } = await import("/src/lib/ffmpeg/ssim.ts");
      step("imported");

      const service = getFfmpegService();
      step("loading");
      await service.load({ forceSingleThreaded: true });
      step("loaded");
      const capabilities = await service.getCapabilities();
      step("capabilities: " + JSON.stringify(capabilities));

      const sourceBytes = new Uint8Array(
        await (await fetch("/bench-source.mp4")).arrayBuffer(),
      );
      step("fetched source: " + sourceBytes.byteLength);

      const probe = await service.probe({
        input: sourceBytes,
        fileName: "source.mp4",
      });
      const durationSeconds = probe.metadata.duration;
      step("probed: " + JSON.stringify(probe.metadata));

      const measurements = [];
      for (const crf of [20, 23, 26, 28, 30]) {
        const label = `h264-crf${crf}`;
        step(`encoding ${label}`);
        const encoded = await service.encode({
          input: sourceBytes,
          inputFileName: "source.mp4",
          outputFileName: `out-${label}.mp4`,
          codec: "h264",
          crf,
          durationSeconds,
          stripAudio: true,
        });
        step(`encoded ${label}: ${encoded.data.byteLength} bytes`);

        step(`ssim ${label}`);
        const comparison = await service.run({
          inputs: [
            { fileName: `distorted.mp4`, data: encoded.data },
            { fileName: "reference.mp4", data: sourceBytes },
          ],
          buildArgs: ({ inputPaths }) => [
            "-hide_banner",
            "-i", inputPaths[0] ?? "",
            "-i", inputPaths[1] ?? "",
            "-lavfi", "ssim",
            "-threads", "1",
            "-f", "null", "-",
          ],
        });
        step(`ssim ${label} done: exit=${comparison.exitCode}`);

        const ssim = parseSsim(comparison.log);
        measurements.push({
          label,
          codec: "h264",
          crf,
          preset: "medium",
          bytes: encoded.data.byteLength,
          seconds: Number((encoded.durationMs / 1000).toFixed(2)),
          ssimAll: ssim ? Number(ssim.all.toFixed(6)) : null,
          ssimDb: ssim ? Number(ssim.allDb.toFixed(3)) : null,
        });
      }

      return {
        capabilities,
        multithreaded: service.engineStatus?.multithreaded ?? false,
        source: {
          bytes: sourceBytes.byteLength,
          width: probe.metadata.width,
          height: probe.metadata.height,
          durationSeconds,
          fps: probe.metadata.fps,
        },
        measurements,
        log,
      };
    } catch (error) {
      step("ERROR: " + (error instanceof Error ? error.message : String(error)));
      step("STACK: " + (error instanceof Error ? (error.stack || "no stack") : "no error object"));
      throw error;
    }
  });

  writeFileSync(
    join(workDir, "calibration.json"),
    JSON.stringify(results, null, 2),
  );
  console.log("BENCH_CALIBRATION:", JSON.stringify(results, null, 2));
  console.log("BENCH_ARTIFACT_DIR:", workDir);

  expect(results.measurements).toHaveLength(5);
  for (const m of results.measurements) {
    expect(m.bytes).toBeGreaterThan(0);
  }
});