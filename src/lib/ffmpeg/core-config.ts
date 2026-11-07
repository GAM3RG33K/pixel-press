/**
 * Resolves the FFmpeg WASM core files at runtime.
 *
 * The core is treated as a swappable external asset: hosts can point the app at
 * a self-hosted build (including a separately licensed GPL core) through Vite
 * environment variables without rebuilding the app.
 */

export interface FfmpegCoreSource {
  coreURL: string;
  wasmURL: string;
  workerURL?: string;
}

export interface ResolveCoreOptions {
  multithreaded?: boolean;
  env?: Record<string, string | undefined>;
}

const DEFAULT_CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
const DEFAULT_CORE_MT_BASE =
  "https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function resolveCoreSource(
  options: ResolveCoreOptions = {},
): FfmpegCoreSource {
  const env =
    options.env ??
    (import.meta.env as unknown as Record<string, string | undefined>);
  const multithreaded = options.multithreaded ?? false;

  if (multithreaded) {
    const base = trimTrailingSlash(
      env.VITE_FFMPEG_CORE_MT_BASE_URL ?? DEFAULT_CORE_MT_BASE,
    );
    return {
      coreURL: `${base}/ffmpeg-core.js`,
      wasmURL: `${base}/ffmpeg-core.wasm`,
      workerURL: `${base}/ffmpeg-core.worker.js`,
    };
  }

  const base = trimTrailingSlash(
    env.VITE_FFMPEG_CORE_BASE_URL ?? DEFAULT_CORE_BASE,
  );
  return {
    coreURL: `${base}/ffmpeg-core.js`,
    wasmURL: `${base}/ffmpeg-core.wasm`,
  };
}
