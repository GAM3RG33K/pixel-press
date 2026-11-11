/**
 * Native engine bridge — runs the downloaded/PATH `ffmpeg`/`ffprobe` as real
 * subprocesses instead of the WASM core. Used automatically when the app runs
 * inside the Tauri shell; the browser keeps using the WASM service.
 *
 * The frontend builds argument lists from `command-builder` (single source of
 * truth shared with the WASM path), and `src-tauri/src/encode.rs` only
 * executes them, streams progress, and cleans up.
 */
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { listen } from "@tauri-apps/api/event";

import { tauriApi, isTauri } from "@/lib/tauri";
import { buildEncodeArgs } from "./command-builder";
import { parseEncoderListing } from "./encoder-inventory";
import { parseFfprobeJson } from "./ffprobe-parser";
import { diag } from "@/lib/diagnostics";
import type {
  EncoderCapabilities,
  TargetCodec,
  VideoMetadata,
} from "@/types/media";

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const mod = await import("@tauri-apps/api/core");
  return mod.invoke<T>(command, args);
}

function toBytes(input: Blob | File | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return Promise.resolve(input);
  return input.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

export function isNativeEngine(): boolean {
  return isTauri();
}

export interface NativeStagedInput {
  /** Absolute path of the temp copy inside $APPDATA/tmp. */
  tmpPath: string;
  outputPath: string;
  dir: string;
  fileName: string;
}

function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return p.slice(0, i);
}

/**
 * Copies the file into the app's temp area by streaming it in 8 MB chunks —
 * never builds a giant in-memory buffer, never JSON-serializes bytes through
 * the IPC bus. Emits `(bytesCopied, totalBytes)` per chunk so the UI can show
 * progress and ETA. Call once per user-selected file and reuse for probe + all encodes.
 */
export async function nativeStageInput(
  file: File,
  outputName: string,
  onProgress?: (copiedBytes: number, totalBytes: number) => void,
): Promise<NativeStagedInput> {
  const paths = await invoke<{ input_path: string; output_path: string }>("encode_paths", {
    inputName: sanitizeName(file.name),
    outputName: sanitizeName(outputName),
  });
  const { create, writeFile } = await import("@tauri-apps/plugin-fs");
  try {
    const reader = file.stream().getReader();
    const handle = await create(paths.input_path);
    let copied = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await handle.write(value);
        copied += value.byteLength;
        onProgress?.(copied, file.size);
      }
    } finally {
      await handle.close();
      reader.releaseLock();
    }
  } catch (streamError) {
    diag.warn("native-engine", "stream copy failed, falling back to single copy", {
      file: file.name,
      size: file.size,
      error: streamError instanceof Error ? streamError.message : String(streamError),
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    await writeFile(paths.input_path, bytes);
    onProgress?.(bytes.byteLength, file.size);
  }
  return { tmpPath: paths.input_path, outputPath: paths.output_path, dir: dirOf(paths.input_path), fileName: file.name };
}

/** Absolute path for a variant output inside the staged temp dir. */
export function nativeOutPath(staged: NativeStagedInput, outputFileName: string): string {
  const sep = staged.dir.includes("\\") ? "\\" : "/";
  return `${staged.dir}${sep}${sanitizeName(outputFileName)}`;
}

/** Absolute-path probe (native drop) — no copy, full duration from headers. */
export async function nativeProbePath(
  path: string,
  fileName: string,
  fileSize: number,
): Promise<{ metadata: VideoMetadata; raw: string }> {
  const raw = await tauriApi.ffprobeJson(path);
  const metadata = parseFfprobeJson(raw, fileName, fileSize);
  return { metadata, raw };
}

/** Huge-file slice probe — ffprobes only the first bytes of a browser File. */
export async function tryProbeSlice(
  slice: Blob,
  fileName: string,
  fileSize: number,
): Promise<{ metadata: VideoMetadata; raw: string } | null> {
  try {
    const bytes = new Uint8Array(await slice.arrayBuffer());
    const raw = await tauriApi.ffprobeBytes(bytes, fileName);
    return { metadata: parseFfprobeJson(raw, fileName, fileSize), raw };
  } catch {
    return null;
  }
}

/** Output path inside a fresh cache temp dir (no staged input). Async — uses encode_paths. */
export async function nativeOutCachePath(outputFileName: string): Promise<string> {
  const paths = await invoke<{ input_path: string; output_path: string }>("encode_paths", {
    inputName: "source",
    outputName: sanitizeName(outputFileName),
  });
  return paths.output_path;
}

/** Probe a staged temp file with native ffprobe (path-based — no bytes through IPC). */
export async function nativeProbeStaged(
  staged: NativeStagedInput,
  fileName: string,
  fileSize: number,
): Promise<{ metadata: VideoMetadata; raw: string }> {
  const raw = await tauriApi.ffprobeJson(staged.tmpPath);
  const metadata = parseFfprobeJson(raw, fileName, fileSize);
  return { metadata, raw };
}

/** Read a file's bytes via the fs plugin and delete it afterwards (free the temp dir). */
export async function nativeReadAndRemove(path: string): Promise<Uint8Array> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(path);
  try {
    const { removeFile } = await import("@/lib/tauri");
    await removeFile(path);
  } catch {
    // best-effort cleanup; temp dir sweep also happens on clear
  }
  return bytes;
}

/** Native probe — writes bytes via ffprobe_bytes temp file. */
export async function nativeProbe(
  input: Blob | File | Uint8Array,
  fileName: string,
): Promise<{ metadata: VideoMetadata; raw: string }> {
  const fileSize = input instanceof Uint8Array ? input.byteLength : input.size;
  const bytes = await toBytes(input);
  const raw = await tauriApi.ffprobeBytes(bytes, fileName);
  const metadata = parseFfprobeJson(raw, fileName, fileSize);
  diag.info("native-engine", "native probe complete", {
    fileName,
    duration: metadata.duration,
    width: metadata.width,
    height: metadata.height,
    codec: metadata.videoCodec,
  });
  return { metadata, raw };
}

/** Native `-encoders` listing for capability detection. */
export async function nativeCapabilities(): Promise<EncoderCapabilities> {
  const output = await invoke<string>("ffmpeg_encoders");
  const lines = output.split(/\r?\n/);
  return parseEncoderListing(lines, true);
}

export interface NativeEncodeFileOptions {
  /** Absolute path of a file on disk — encode reads it directly, no temp copy. */
  inputPath: string;
  /** Absolute output path; parent directories are created natively. */
  outputPath: string;
  codec: TargetCodec;
  crf: number;
  preset?: string;
  width?: number;
  height?: number;
  scaleFilter?: string;
  fps?: number;
  stripAudio?: boolean;
  faststart?: boolean;
  extraArgs?: string[];
  durationSeconds: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface NativeEncodeFileResult {
  outputPath: string;
  durationMs: number;
  sizeBytes: number;
  log: string[];
}

/** Native encode from a real file path to a real output path — no bytes through the webview. */
export async function nativeEncodeFile(options: NativeEncodeFileOptions): Promise<NativeEncodeFileResult> {
  const requestId = crypto.randomUUID();
  diag.info("native-engine", "native encode-file start", {
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    codec: options.codec,
    crf: options.crf,
  });

  const args = buildEncodeArgs({
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    codec: options.codec,
    crf: options.crf,
    ...(options.preset !== undefined ? { preset: options.preset } : {}),
    ...(options.width !== undefined ? { width: options.width } : {}),
    ...(options.height !== undefined ? { height: options.height } : {}),
    ...(options.scaleFilter !== undefined ? { scaleFilter: options.scaleFilter } : {}),
    ...(options.fps !== undefined ? { fps: options.fps } : {}),
    ...(options.stripAudio !== undefined ? { stripAudio: options.stripAudio } : {}),
    ...(options.faststart !== undefined ? { faststart: options.faststart } : {}),
    ...(options.extraArgs !== undefined ? { extraArgs: options.extraArgs } : {}),
  });

  const unlisten = await listen<{ requestId: string; progress: number }>("encode-progress", (event) => {
    if (event.payload.requestId === requestId) {
      options.onProgress?.(Math.max(0, Math.min(100, event.payload.progress)));
    }
  });

  const onAbort = () => {
    diag.info("native-engine", "native encode-file abort requested", { requestId });
    void invoke("abort_encode", { requestId });
  };
  if (options.signal) {
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  let result: { duration_ms: number; exit_code: number; size_bytes: number; log_tail: string[] };
  try {
    result = await invoke("encode_video", {
      request: {
        input_path: options.inputPath,
        output_path: options.outputPath,
        args,
        duration_seconds: options.durationSeconds,
        request_id: requestId,
        delete_input: false,
      },
    });
  } finally {
    unlisten();
    options.signal?.removeEventListener("abort", onAbort);
  }

  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  if (result.exit_code !== 0) {
    diag.error("native-engine", `native ffmpeg exited ${result.exit_code}`, {
      args,
      logTail: result.log_tail.slice(-40),
    });
    throw new Error(`ffmpeg exited with code ${result.exit_code}: ${result.log_tail.slice(-3).join(" | ")}`);
  }

  diag.info("native-engine", "native encode-file complete", {
    outputPath: options.outputPath,
    sizeBytes: result.size_bytes,
    durationMs: result.duration_ms,
  });

  return {
    outputPath: options.outputPath,
    durationMs: result.duration_ms,
    sizeBytes: result.size_bytes,
    log: result.log_tail,
  };
}

export interface NativeEncodeOptions {
  input: Blob | File | Uint8Array;
  inputFileName: string;
  outputFileName: string;
  codec: TargetCodec;
  crf: number;
  preset?: string;
  width?: number;
  height?: number;
  scaleFilter?: string;
  fps?: number;
  stripAudio?: boolean;
  faststart?: boolean;
  extraArgs?: string[];
  durationSeconds: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface NativeEncodeResult {
  data: Uint8Array;
  outputFileName: string;
  durationMs: number;
  sizeBytes: number;
  log: string[];
}

/** Native encode — same shape as `FfmpegService.encode`, minus the WASM core. */
export async function nativeEncode(options: NativeEncodeOptions): Promise<NativeEncodeResult> {
  const requestId = crypto.randomUUID();
  diag.info("native-engine", "native encode start", {
    fileName: options.inputFileName,
    codec: options.codec,
    crf: options.crf,
    durationSeconds: options.durationSeconds,
  });

  const inputName = sanitizeName(options.inputFileName);
  const outName = sanitizeName(options.outputFileName);
  const paths = await invoke<{ input_path: string; output_path: string }>("encode_paths", {
    inputName,
    outputName: outName,
  });

  const bytes = await toBytes(options.input);
  await writeFile(paths.input_path, bytes);

  const args = buildEncodeArgs({
    inputPath: paths.input_path,
    outputPath: paths.output_path,
    codec: options.codec,
    crf: options.crf,
    ...(options.preset !== undefined ? { preset: options.preset } : {}),
    ...(options.width !== undefined ? { width: options.width } : {}),
    ...(options.height !== undefined ? { height: options.height } : {}),
    ...(options.scaleFilter !== undefined ? { scaleFilter: options.scaleFilter } : {}),
    ...(options.fps !== undefined ? { fps: options.fps } : {}),
    ...(options.stripAudio !== undefined ? { stripAudio: options.stripAudio } : {}),
    ...(options.faststart !== undefined ? { faststart: options.faststart } : {}),
    ...(options.extraArgs !== undefined ? { extraArgs: options.extraArgs } : {}),
  });

  const unlisten = await listen<{ requestId: string; progress: number }>("encode-progress", (event) => {
    if (event.payload.requestId === requestId) {
      options.onProgress?.(Math.max(0, Math.min(100, event.payload.progress)));
    }
  });

  const onAbort = () => {
    diag.info("native-engine", "native encode abort requested", { requestId });
    void invoke("abort_encode", { requestId });
  };
  if (options.signal) {
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  let result: { duration_ms: number; exit_code: number; size_bytes: number; log_tail: string[] };
  try {
    result = await invoke("encode_video", {
      request: {
        input_path: paths.input_path,
        output_path: paths.output_path,
        args,
        duration_seconds: options.durationSeconds,
        request_id: requestId,
      },
    });
  } finally {
    unlisten();
    options.signal?.removeEventListener("abort", onAbort);
  }

  const dir = paths.input_path.replace(/\/[^/]+$/, "");
  const tmpDir = dir;

  if (options.signal?.aborted) {
    void invoke("cleanup_encode_dir", { path: tmpDir });
    throw new DOMException("Aborted", "AbortError");
  }

  if (result.exit_code !== 0) {
    diag.error("native-engine", `native ffmpeg exited ${result.exit_code}`, {
      args,
      logTail: result.log_tail.slice(-40),
    });
    void invoke("cleanup_encode_dir", { path: tmpDir });
    throw new Error(`ffmpeg exited with code ${result.exit_code}: ${result.log_tail.slice(-3).join(" | ")}`);
  }

  const data = await readFile(paths.output_path);
  void invoke("cleanup_encode_dir", { path: tmpDir });
  diag.info("native-engine", "native encode complete", {
    fileName: options.outputFileName,
    sizeBytes: result.size_bytes,
    durationMs: result.duration_ms,
  });

  return {
    data,
    outputFileName: options.outputFileName,
    durationMs: result.duration_ms,
    sizeBytes: result.size_bytes,
    log: result.log_tail,
  };
}
