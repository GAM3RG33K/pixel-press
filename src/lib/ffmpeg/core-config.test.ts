import { describe, it, expect } from "vitest";
import { resolveCoreSource } from "./core-config";

describe("resolveCoreSource", () => {
  it("returns single-threaded URLs by default", () => {
    const result = resolveCoreSource({ env: {} });

    expect(result.coreURL).toBe(
      "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js",
    );
    expect(result.wasmURL).toBe(
      "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm",
    );
    expect(result.workerURL).toBeUndefined();
  });

  it("returns multithreaded URLs when multithreaded is true", () => {
    const result = resolveCoreSource({ multithreaded: true, env: {} });

    expect(result.coreURL).toContain("@ffmpeg/core-mt@0.12.10");
    expect(result.coreURL).toBe(
      "https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm/ffmpeg-core.js",
    );
    expect(result.wasmURL).toBe(
      "https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm/ffmpeg-core.wasm",
    );
    expect(result.workerURL).toBe(
      "https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm/ffmpeg-core.worker.js",
    );
  });

  it("overrides single-threaded base URL from env", () => {
    const result = resolveCoreSource({
      env: { VITE_FFMPEG_CORE_BASE_URL: "https://cdn.example.com/core" },
    });

    expect(result.coreURL).toBe("https://cdn.example.com/core/ffmpeg-core.js");
    expect(result.wasmURL).toBe("https://cdn.example.com/core/ffmpeg-core.wasm");
    expect(result.workerURL).toBeUndefined();
  });

  it("normalizes trailing slash in single-threaded env base URL", () => {
    const result = resolveCoreSource({
      env: { VITE_FFMPEG_CORE_BASE_URL: "https://cdn.example.com/core/" },
    });

    expect(result.coreURL).toBe("https://cdn.example.com/core/ffmpeg-core.js");
    expect(result.wasmURL).toBe("https://cdn.example.com/core/ffmpeg-core.wasm");
  });

  it("overrides multithreaded base URL from env", () => {
    const result = resolveCoreSource({
      multithreaded: true,
      env: { VITE_FFMPEG_CORE_MT_BASE_URL: "https://cdn.example.com/mt/" },
    });

    expect(result.coreURL).toBe(
      "https://cdn.example.com/mt/ffmpeg-core.js",
    );
    expect(result.wasmURL).toBe("https://cdn.example.com/mt/ffmpeg-core.wasm");
    expect(result.workerURL).toBe(
      "https://cdn.example.com/mt/ffmpeg-core.worker.js",
    );
  });

  it("ignores MT env variable when multithreaded is false", () => {
    const result = resolveCoreSource({
      multithreaded: false,
      env: {
        VITE_FFMPEG_CORE_BASE_URL: "https://cdn.example.com/st",
        VITE_FFMPEG_CORE_MT_BASE_URL: "https://cdn.example.com/mt",
      },
    });

    expect(result.coreURL).toBe("https://cdn.example.com/st/ffmpeg-core.js");
    expect(result.wasmURL).toBe("https://cdn.example.com/st/ffmpeg-core.wasm");
    expect(result.workerURL).toBeUndefined();
  });
});