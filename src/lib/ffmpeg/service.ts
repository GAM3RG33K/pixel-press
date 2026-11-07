import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

import { getIsolationState, supportsSharedArrayBuffer } from "@/lib/coi";
import type {
  EncoderCapabilities,
  ProbeResult,
  ProgressSample,
} from "@/types/media";

import { buildProbeArgs } from "./command-builder";
import { resolveCoreSource, type FfmpegCoreSource } from "./core-config";
import { parseEncoderListing } from "./encoder-inventory";
import { parseFfprobeJson } from "./ffprobe-parser";
import { JobQueue } from "./job-queue";
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
  args: string[];
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
  if (input instanceof Uint8Array) return input;
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

  async load(): Promise<EngineLoadStatus> {
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      const preferMultithreaded =
        getIsolationState() === "isolated" && supportsSharedArrayBuffer();

      if (preferMultithreaded) {
        try {
          const coreSource = resolveCoreSource({ multithreaded: true });
          await this.loadCore(coreSource, true);
          this.status = { loaded: true, multithreaded: true, coreSource };
          return this.status;
        } catch (error) {
          console.warn(
            "[ffmpeg] multi-threaded core failed, falling back to single-threaded",
            error,
          );
        }
      }

      const coreSource = resolveCoreSource({ multithreaded: false });
      await this.loadCore(coreSource, false);
      this.status = { loaded: true, multithreaded: false, coreSource };
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
    return this.queue.add(async (signal) => {
      await this.load();

      const suffix = randomSuffix();
      const inputPath = `/probe-${suffix}-${sanitizeFileName(options.fileName)}`;
      const outputPath = `/probe-${suffix}.json`;
      const fileSize = isUint8Array(options.input)
        ? options.input.byteLength
        : options.input.size;

      await this.ffmpeg.writeFile(inputPath, await toInputData(options.input), {
        signal,
      });

      try {
        const code = await this.ffmpeg.ffprobe(
          [...buildProbeArgs(inputPath), "-o", outputPath],
          -1,
          { signal },
        );
        if (code !== 0) {
          throw new Error(`ffprobe failed with exit code ${code}`);
        }

        const raw = await this.ffmpeg.readFile(outputPath, "utf8", { signal });
        if (!isUint8Array(raw) && typeof raw !== "string") {
          throw new Error("ffprobe returned an unexpected payload");
        }
        const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
        return {
          metadata: parseFfprobeJson(text, options.fileName, fileSize),
          raw: text,
        };
      } finally {
        await this.ffmpeg.deleteFile(inputPath).catch(() => undefined);
        await this.ffmpeg.deleteFile(outputPath).catch(() => undefined);
      }
    }, options.signal ? { signal: options.signal } : {}).promise;
  }

  async encode(options: EncodeOptions): Promise<EncodeResult> {
    return this.queue.add(async (signal) => {
      await this.load();

      const suffix = randomSuffix();
      const inputPath = `/in-${suffix}-${sanitizeFileName(options.inputFileName)}`;
      const outputPath = `/out-${suffix}-${sanitizeFileName(options.outputFileName)}`;
      const startLogIndex = this.logBuffer.length;
      const startedAt = performance.now();

      const onLog = ({ message }: { message: string }) => {
        const sample = parseProgressLine(message);
        if (!sample) return;
        const progress =
          options.durationSeconds > 0
            ? percentFromTime(sample.timeSeconds, options.durationSeconds)
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

      await this.ffmpeg.writeFile(inputPath, await toInputData(options.input), {
        signal,
      });

      try {
        const code = await this.ffmpeg.exec(
          [...options.args.slice(0, -1), outputPath],
          -1,
          { signal },
        );
        if (code !== 0) {
          throw new Error(`ffmpeg exited with code ${code}`);
        }

        const data = await this.ffmpeg.readFile(outputPath, undefined, {
          signal,
        });
        if (!isUint8Array(data)) {
          throw new Error("ffmpeg returned a non-binary payload");
        }

        return {
          data,
          outputFileName: options.outputFileName,
          durationMs: Math.round(performance.now() - startedAt),
          log: this.logBuffer.slice(startLogIndex),
        };
      } finally {
        this.ffmpeg.off("log", onLog);
        this.ffmpeg.off("progress", onProgress);
        await this.ffmpeg.deleteFile(inputPath).catch(() => undefined);
        await this.ffmpeg.deleteFile(outputPath).catch(() => undefined);
      }
    }, options.signal ? { signal: options.signal } : {}).promise;
  }

  async getCapabilities(): Promise<EncoderCapabilities> {
    if (this.capabilitiesPromise) return this.capabilitiesPromise;

    this.capabilitiesPromise = this.queue
      .add(async (signal) => {
        await this.load();
        const startLogIndex = this.logBuffer.length;
        await this.ffmpeg.exec(["-hide_banner", "-encoders"], -1, { signal });
        const lines = this.logBuffer.slice(startLogIndex);
        this.capabilityLog = lines;
        return parseEncoderListing(lines, this.status?.multithreaded ?? false);
      })
      .promise;

    this.capabilitiesPromise = this.capabilitiesPromise.catch((error) => {
      this.capabilitiesPromise = null;
      throw error;
    });

    return this.capabilitiesPromise;
  }

  terminate(): void {
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
