import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

import { getIsolationState, supportsSharedArrayBuffer } from "@/lib/coi";
import type {
  EncoderCapabilities,
  ProbeResult,
  ProgressSample,
  TargetCodec,
} from "@/types/media";

import { buildEncodeArgs, buildProbeArgs } from "./command-builder";
import { resolveCoreSource, type FfmpegCoreSource } from "./core-config";
import { parseEncoderListing } from "./encoder-inventory";
import { parseFfprobeJson } from "./ffprobe-parser";
import { JobQueue } from "./job-queue";
import { diag, captureError } from "@/lib/diagnostics";
import { clipText } from "@/lib/format";
import { percentFromTime, parseProgressLine } from "./progress";

export interface EngineLoadStatus {
  loaded: boolean;
  multithreaded: boolean;
  coreSource: FfmpegCoreSource;
}

export interface EncodeProgressEvent {
  /** Percent complete, 0–100. */
  progress: number;
  /** Detailed sample when it could be parsed from a log line. */
  sample?: ProgressSample;
}

export interface EncodeOptions {
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
  audioHandling?: import("./recipe").AudioHandling;
  subtitleHandling?: import("./recipe").SubtitleHandling;
  subtitleStreamIndices?: number[];
  stripMetadata?: boolean;
  trimStart?: number;
  trimEnd?: number;
  durationSeconds: number;
  onProgress?: (event: EncodeProgressEvent) => void;
  signal?: AbortSignal;
}

export interface EncodeResult {
  data: Uint8Array;
  outputFileName: string;
  durationMs: number;
  log: string[];
}

export interface RunInput {
  /** Logical file name; sanitized before it becomes a sandbox path. */
  fileName: string;
  data: Blob | File | Uint8Array;
}

export interface RunPaths {
  /** Sandbox paths of `inputs`, in the same order. */
  inputPaths: string[];
  /** Sandbox path of the output file when `outputFileName` is set. */
  outputPath?: string;
}

export interface RunRequest {
  inputs: RunInput[];
  /** Builds the full FFmpeg argument list from resolved sandbox paths. */
  buildArgs: (paths: RunPaths) => string[];
  /** When set, the file at `paths.outputPath` is read back into `data`. */
  outputFileName?: string;
  /** Enables percent progress when the input duration is known. */
  durationSeconds?: number;
  onProgress?: (event: EncodeProgressEvent) => void;
  signal?: AbortSignal;
}

export interface RunResult {
  /** Output bytes when `outputFileName` was supplied. */
  data?: Uint8Array;
  outputFileName?: string;
  durationMs: number;
  exitCode: number;
  log: string[];
}

export interface ProbeOptions {
  input: Blob | File | Uint8Array;
  fileName: string;
  signal?: AbortSignal;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

async function toInputData(
  input: Blob | File | Uint8Array,
): Promise<Uint8Array> {
  // `writeFile` transfers the underlying ArrayBuffer to the worker, which
  // detaches the caller's view. Copy so callers can reuse the same bytes for
  // multiple jobs (e.g. a reference clip in a benchmark).
  if (input instanceof Uint8Array) return Uint8Array.from(input);
  return fetchFile(input);
}

/**
 * Owns the single FFmpeg WASM instance and serialises all work.
 *
 * The heavy lifting runs inside the `@ffmpeg/ffmpeg` worker, so the main
 * thread never encodes. Every operation is a Promise with progress reporting
 * and cancellation support.
 */
export class FfmpegService {
  private readonly ffmpeg = new FFmpeg();
  private readonly queue = new JobQueue({ concurrency: 1 });
  private readonly logBuffer: string[] = [];
  private loadPromise: Promise<EngineLoadStatus> | null = null;
  private capabilitiesPromise: Promise<EncoderCapabilities> | null = null;
  private status: EngineLoadStatus | null = null;
  private capabilityLog: string[] = [];

  constructor() {
    this.ffmpeg.on("log", ({ message }) => {
      this.logBuffer.push(message);
      if (this.logBuffer.length > 4000) {
        this.logBuffer.splice(0, this.logBuffer.length - 4000);
      }
      // Capture only crash signatures — the raw encoder/decoder catalog is thousands of lines
      // and would evict everything else from the diagnostic ring buffer.
      if (/Aborted\(\)|Segmentation fault|OutOfMemory|out of memory|RuntimeError/i.test(message)) {
        diag.error('ffmpeg', message);
      }
    });
  }

  get engineStatus(): EngineLoadStatus | null {
    return this.status;
  }

  get queueSize(): number {
    return this.queue.size;
  }

  /** Raw `ffmpeg -encoders` lines captured by the last capability probe. */
  get lastCapabilityLog(): readonly string[] {
    return this.capabilityLog;
  }

  /** Most recent FFmpeg log lines, for diagnostics and hang reports. */
  get logTail(): readonly string[] {
    return this.logBuffer.slice(-80);
  }

  async load(
    options: { forceSingleThreaded?: boolean } = {},
  ): Promise<EngineLoadStatus> {
    diag.info('load', 'load called', { forceSingleThreaded: Boolean(options.forceSingleThreaded) });
    if (this.loadPromise) {
      diag.debug('load', 'load already in progress, awaiting');
      return this.loadPromise;
    }

    this.loadPromise = (async () => {
      const isolationState = getIsolationState();
      const preferMultithreaded =
        !options.forceSingleThreaded &&
        isolationState === "isolated" &&
        supportsSharedArrayBuffer();
      diag.debug('load', 'load decision', {
        isolationState,
        supportsSharedArrayBuffer: supportsSharedArrayBuffer(),
        forceSingleThreaded: Boolean(options.forceSingleThreaded),
        preferMultithreaded,
      });

      if (preferMultithreaded) {
        try {
          const coreSource = resolveCoreSource({ multithreaded: true });
          await this.loadCore(coreSource, true);
          this.status = { loaded: true, multithreaded: true, coreSource };
          diag.info('service', 'FFmpeg core loaded (multi-threaded)', { coreSource });
          return this.status;
        } catch (error) {
          diag.warn('load', 'multi-threaded core failed, falling back to single-threaded', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }

      const coreSource = resolveCoreSource({ multithreaded: false });
      await this.loadCore(coreSource, false);
      this.status = { loaded: true, multithreaded: false, coreSource };
      diag.info('service', 'FFmpeg core loaded (single-threaded)', { coreSource });
      return this.status;
    })();

    try {
      return await this.loadPromise;
    } catch (error) {
      this.loadPromise = null;
      throw error;
    }
  }

  private async loadCore(
    source: FfmpegCoreSource,
    multithreaded: boolean,
  ): Promise<void> {
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(source.coreURL, "text/javascript"),
      toBlobURL(source.wasmURL, "application/wasm"),
    ]);
    const workerURL =
      multithreaded && source.workerURL
        ? await toBlobURL(source.workerURL, "text/javascript")
        : undefined;

    await this.ffmpeg.load(
      workerURL ? { coreURL, wasmURL, workerURL } : { coreURL, wasmURL },
    );
  }

  async probe(options: ProbeOptions): Promise<ProbeResult> {
    diag.info('probe', 'probe called', {
      fileName: options.fileName,
      fileSize: options.input instanceof Uint8Array ? options.input.byteLength : (options.input as Blob).size,
      signalAborted: options.signal?.aborted ?? null,
    });
    return this.queue.add(async (signal) => {
      await this.load();

      const suffix = randomSuffix();
      const inputPath = `/probe-${suffix}-${sanitizeFileName(options.fileName)}`;
      const outputPath = `/probe-${suffix}.json`;
      const fileSize = isUint8Array(options.input)
        ? options.input.byteLength
        : options.input.size;

      const probeInput = await toInputData(options.input);
      diag.debug('probe', 'probe input written to sandbox', {
        path: inputPath,
        bytes: probeInput.byteLength,
      });
      await this.ffmpeg.writeFile(inputPath, probeInput, {
        signal,
      });

      try {
        // `ffprobe` in the WASM core reports a non-zero code even on success
        // (observed with @ffmpeg/core 0.12.10), so the output file is the
        // source of truth; a missing/invalid file still throws.
        diag.info('probe', 'ffprobe command (wasm)', {
          command: `ffprobe ${[...buildProbeArgs(inputPath), '-o', outputPath].join(' ')}`,
          inputPath,
        });
        diag.debug('probe', 'ffprobe exec start', { inputPath, outputPath });
        const code = await this.ffmpeg.ffprobe(
          [...buildProbeArgs(inputPath), "-o", outputPath],
          -1,
          { signal },
        );
        diag.debug('probe', 'ffprobe exec done', { exitCode: code });

        diag.debug('probe', 'reading ffprobe output', { outputPath });
        const raw = await this.ffmpeg.readFile(outputPath, "utf8", { signal });
        if (!isUint8Array(raw) && typeof raw !== "string") {
          throw new Error(
            `ffprobe returned an unexpected payload (exit code ${code})`,
          );
        }
        const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
        diag.info('probe', 'ffprobe output', { raw: clipText(text) });
        const metadata = parseFfprobeJson(text, options.fileName, fileSize);
        diag.info('probe', 'ffprobe complete', {
          fileSize,
          width: metadata.width,
          height: metadata.height,
          duration: metadata.duration,
          fps: metadata.fps,
          videoCodec: metadata.videoCodec,
          hasAudio: metadata.hasAudio,
        });
        return { metadata, raw: text };
      } finally {
        await this.ffmpeg.deleteFile(inputPath).catch(() => undefined);
        await this.ffmpeg.deleteFile(outputPath).catch(() => undefined);
      }
    }, options.signal ? { signal: options.signal } : {}).promise;
  }

  /**
   * Runs an arbitrary FFmpeg command against one or more inputs.
   *
   * Inputs are written into the sandbox and their resolved paths are handed to
   * `buildArgs`, so callers never guess at temporary file names. Use this for
   * multi-input operations such as SSIM comparison as well as one-off encodes.
   */
  async run(options: RunRequest): Promise<RunResult> {
    const runSummary = {
      inputFiles: options.inputs.map((i) => i.fileName),
      outputFileName: options.outputFileName,
      durationSeconds: options.durationSeconds,
      signalAborted: Boolean(options.signal?.aborted),
    };
    diag.info('run', 'run request received', {
      inputFiles: options.inputs.map((i) => ({
        fileName: i.fileName,
        size: i.data instanceof Uint8Array ? i.data.byteLength : (i.data as Blob).size,
      })),
      outputFileName: options.outputFileName,
      durationSeconds: options.durationSeconds,
      signalAborted: options.signal?.aborted ?? null,
    });

    return this.queue.add(async (signal) => {
      const startLogIndex = this.logBuffer.length;
      const startedAt = performance.now();
      const durationSeconds = options.durationSeconds ?? 0;

      const inputPaths = options.inputs.map(
        (input, index) =>
          `/in-${randomSuffix()}-${index}-${sanitizeFileName(input.fileName)}`,
      );
      const outputPath = options.outputFileName
        ? `/out-${randomSuffix()}-${sanitizeFileName(options.outputFileName)}`
        : undefined;

      try {
        await this.load();

        const onLog = ({ message }: { message: string }) => {
          const sample = parseProgressLine(message);
          if (!sample) return;
          const progress =
            durationSeconds > 0
              ? percentFromTime(sample.timeSeconds, durationSeconds)
              : 0;
          options.onProgress?.({ progress, sample });
        };

        const onProgress = ({ progress }: { progress: number }) => {
          options.onProgress?.({
            progress: Math.max(0, Math.min(100, progress * 100)),
          });
        };

        this.ffmpeg.on("log", onLog);
        this.ffmpeg.on("progress", onProgress);

        try {
          diag.info('run', 'writing inputs to ffmpeg sandbox', {
            inputs: inputPaths,
          });
          for (let index = 0; index < inputPaths.length; index++) {
            const path = inputPaths[index];
            if (!path) throw new Error("missing input path");
            const data = await toInputData(options.inputs[index]!.data);
            diag.debug('run', 'writing file', {
              path,
              bytes: data.byteLength,
            });
            await this.ffmpeg.writeFile(path, data, { signal });
            diag.debug('run', 'file written', { path });
          }

          const args = options.buildArgs({
            inputPaths,
            ...(outputPath !== undefined ? { outputPath } : {}),
          });
          diag.info('run', 'ffmpeg exec start', { args });

          let exitCode: number | undefined;
          try {
            exitCode = await this.ffmpeg.exec(args, -1, { signal });
          } catch (error) {
            const normalized = captureError(error);
            diag.error('run', `ffmpeg exec threw: ${normalized.message}`, {
              ...runSummary,
              args,
              name: normalized.name,
              stack: normalized.stack,
              ffmpegCode: (normalized as Error & { ffmpegCode?: unknown }).ffmpegCode,
              logTail: this.logBuffer.slice(-40),
            });
            throw normalized;
          }

          const log = this.logBuffer.slice(startLogIndex);

          if (exitCode !== 0) {
            diag.error('run', `ffmpeg exited with code ${exitCode}`, {
              ...runSummary,
              args,
              logTail: log.slice(-40),
            });
            throw new Error(`ffmpeg exited with code ${exitCode}`);
          }

          let data: Uint8Array | undefined;
          if (outputPath) {
            diag.debug('run', 'reading ffmpeg output', { outputPath });
            const raw = await this.ffmpeg.readFile(outputPath, undefined, {
              signal,
            });
            if (!isUint8Array(raw)) {
              diag.error('run', 'ffmpeg output not binary', {
                outputPath,
                receivedType: typeof raw,
              });
              throw new Error("ffmpeg returned a non-binary payload");
            }
            data = raw;
            diag.debug('run', 'output read complete', {
              outputPath,
              bytes: raw.byteLength,
            });
          }

          diag.info('run', 'run complete', {
            ...runSummary,
            exitCode,
            outputBytes: data?.byteLength,
            avgMs: Math.round(performance.now() - startedAt),
            logLineCount: log.length,
          });
          if (log.length > 0) {
            diag.info('encode', 'ffmpeg console output (wasm, full tail)', {
              exitCode,
              outputPath,
              lines: log.length,
              console: clipText(log.slice(-160).join('\n')),
            });
          }
          diag.debug('run', 'full ffmpeg args used', { args: clipText(args.join(' ')) });

          return {
            ...(data !== undefined ? { data } : {}),
            ...(options.outputFileName !== undefined
              ? { outputFileName: options.outputFileName }
              : {}),
            durationMs: Math.round(performance.now() - startedAt),
            exitCode,
            log,
          };
        } finally {
          this.ffmpeg.off("log", onLog);
          this.ffmpeg.off("progress", onProgress);
          await Promise.all(
            inputPaths.map((path) =>
              this.ffmpeg.deleteFile(path).catch(() => undefined),
            ),
          );
          if (outputPath) {
            await this.ffmpeg.deleteFile(outputPath).catch(() => undefined);
          }
        }
      } catch (error) {
        const normalized = captureError(error);
        diag.error('run', `run failed: ${normalized.message}`, {
          ...runSummary,
          name: normalized.name,
          stack: normalized.stack,
        });
        throw normalized;
      }
    }, options.signal ? { signal: options.signal } : {}).promise;
  }

  async encode(options: EncodeOptions): Promise<EncodeResult> {
    diag.info('encode', 'encode start', {
      fileName: options.inputFileName,
      codec: options.codec,
      crf: options.crf,
      stripAudio: options.stripAudio,
      faststart: options.faststart,
      durationSeconds: options.durationSeconds,
    });
    const result = await this.run({
      inputs: [{ fileName: options.inputFileName, data: options.input }],
      outputFileName: options.outputFileName,
      durationSeconds: options.durationSeconds,
      ...(options.onProgress !== undefined
        ? { onProgress: options.onProgress }
        : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      buildArgs: ({ inputPaths, outputPath }) => {
        const inputPath = inputPaths[0];
        if (!inputPath || !outputPath) {
          throw new Error("encode requires one input and one output path");
        }
        const args = buildEncodeArgs({
          inputPath,
          outputPath,
          codec: options.codec,
          crf: options.crf,
          ...(options.preset !== undefined ? { preset: options.preset } : {}),
          ...(options.width !== undefined ? { width: options.width } : {}),
          ...(options.height !== undefined ? { height: options.height } : {}),
          ...(options.scaleFilter !== undefined
            ? { scaleFilter: options.scaleFilter }
            : {}),
          ...(options.fps !== undefined ? { fps: options.fps } : {}),
          ...(options.stripAudio !== undefined
            ? { stripAudio: options.stripAudio }
            : {}),
          ...(options.faststart !== undefined
            ? { faststart: options.faststart }
            : {}),
          ...(options.extraArgs !== undefined
            ? { extraArgs: options.extraArgs }
            : {}),
          ...(options.audioHandling !== undefined
            ? { audioHandling: options.audioHandling }
            : {}),
          ...(options.subtitleHandling !== undefined
            ? { subtitleHandling: options.subtitleHandling }
            : {}),
          ...(options.subtitleStreamIndices !== undefined
            ? { subtitleStreamIndices: options.subtitleStreamIndices }
            : {}),
          ...(options.stripMetadata !== undefined
            ? { stripMetadata: options.stripMetadata }
            : {}),
          ...(options.trimStart !== undefined
            ? { trimStart: options.trimStart }
            : {}),
          ...(options.trimEnd !== undefined
            ? { trimEnd: options.trimEnd }
            : {}),
        });
        diag.info('encode', 'ffmpeg command (wasm)', {
          args: clipText(args.join(' ')),
          outputFileName: options.outputFileName,
          codec: options.codec,
          crf: options.crf,
        });
        return args;
      },
    });

    if (!result.data) {
      diag.error('encode', 'ffmpeg did not return output data', { outputFileName: options.outputFileName });
      throw new Error("ffmpeg did not return output data");
    }

    diag.info('encode', 'encode complete', {
      outputFileName: options.outputFileName,
      outputBytes: result.data.byteLength,
      durationMs: result.durationMs,
    });
    if (result.log) {
      diag.info('encode', 'ffmpeg console output (wasm)', {
        outputFileName: options.outputFileName,
        lines: result.log.length,
        console: clipText(result.log.join('\n')),
      });
    }
    return {
      data: result.data,
      outputFileName: options.outputFileName,
      durationMs: result.durationMs,
      log: result.log,
    };
  }

  async getCapabilities(): Promise<EncoderCapabilities> {
    if (this.capabilitiesPromise) return this.capabilitiesPromise;

    this.capabilitiesPromise = this.queue
      .add(async (signal) => {
        await this.load();
        const startLogIndex = this.logBuffer.length;
        await this.ffmpeg.exec(["-hide_banner", "-encoders"], -1, { signal });
        diag.info('capability', 'capability probe exec complete', {
          startLogIndex,
          logLineCount: this.logBuffer.length - startLogIndex,
          multithreaded: this.status?.multithreaded ?? false,
        });
        const lines = this.logBuffer.slice(startLogIndex);
        this.capabilityLog = lines;        return parseEncoderListing(lines, this.status?.multithreaded ?? false);
      })
      .promise;

    this.capabilitiesPromise = this.capabilitiesPromise.catch((error) => {
      this.capabilitiesPromise = null;
      throw error;
    });

    return this.capabilitiesPromise;
  }

  terminate(): void {
    diag.info('terminate', 'service terminate called', {
      queueSize: this.queue.size,
      loaded: Boolean(this.status?.loaded),
    });
    this.queue.cancelAll();
    this.ffmpeg.terminate();
    this.loadPromise = null;
    this.capabilitiesPromise = null;
    this.status = null;
  }
}

let singleton: FfmpegService | null = null;

export function getFfmpegService(): FfmpegService {
  if (!singleton) {
    singleton = new FfmpegService();
  }
  return singleton;
}
