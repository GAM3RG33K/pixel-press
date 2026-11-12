import type { ContainerFormat, TargetCodec } from "@/types/media";
import type { AudioHandling, SubtitleHandling } from "./recipe";

export interface EncodeArgsInput {
  inputPath: string;
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
  /** Prefer `audioHandling` over `stripAudio` when both are set. */
  audioHandling?: AudioHandling;
  /** Subtitle stream handling. Defaults to `copy` (ffmpeg picks one sub stream per type). */
  subtitleHandling?: SubtitleHandling;
  /** Strip global metadata (`-map_metadata -1`). */
  stripMetadata?: boolean;
  /** Trim window in seconds (input seeking, before -i). */
  trimStart?: number;
  trimEnd?: number;
  /** Explicit subtitle stream indices to keep (from ffprobe). When set with mode "only", these are mapped — no language-specifier syntax, works on every ffmpeg build. */
  subtitleStreamIndices?: number[];
}

export function codecArgs(
  codec: TargetCodec,
  crf: number,
  preset?: string,
): string[] {
  switch (codec) {
    case "h265":
      return [
        "-c:v",
        "libx265",
        "-preset",
        preset ?? "medium",
        "-crf",
        String(crf),
        "-tag:v",
        "hvc1",
      ];
    case "h264":
      return [
        "-c:v",
        "libx264",
        "-preset",
        preset ?? "medium",
        "-crf",
        String(crf),
        "-pix_fmt",
        "yuv420p",
      ];
    case "vp9":
      return [
        "-c:v",
        "libvpx-vp9",
        "-crf",
        String(crf),
        "-b:v",
        "0",
        "-deadline",
        "good",
        "-cpu-used",
        "2",
      ];
    case "av1":
      return ["-c:v", "libsvtav1", "-crf", String(crf), "-preset", "8"];
  }
}

export function audioArgs(
  container: ContainerFormat,
  stripAudio: boolean,
  audioHandling?: AudioHandling,
): string[] {
  const handling: AudioHandling = audioHandling ?? (stripAudio ? "strip" : "encode");
  if (handling === "strip") return ["-an"];
  if (handling === "copy") return ["-c:a", "copy"];
  switch (container) {
    case "webm":
      // 5.1(side) / 7.1 inputs can't feed libopus's default mapping family;
      // always downmix to stereo — universally playable for web autoplay.
      return ["-c:a", "libopus", "-b:a", "96k", "-ac", "2"];
    case "mkv":
    case "avi":
    case "mp4":
    case "mov":
      return ["-c:a", "aac", "-b:a", "128k"];
  }
}

/** Subtitle codec per container — MP4/MOV need mov_text for text subs; others copy. */
function subtitleArgs(
  container: ContainerFormat,
  handling: SubtitleHandling,
  indices?: number[],
): string[] {
  const textSubs = container === "mp4" || container === "mov";
  const subCodec = textSubs ? "mov_text" : "copy";
  if (handling.mode === "strip") return ["-sn"];
  if (handling.mode === "copy") {
    return ["-c:s", subCodec];
  }
  // "only": keep the explicitly listed streams. Falling back to keeping all
  // subs is worse than failing loudly — but mapping everything keeps the job
  // working when indices are unavailable (never happens in the app).
  const mapped = indices ?? null;
  const args: string[] = [];
  if (mapped === null) {
    return ["-map", "0:s?", "-c:s", subCodec];
  }
  for (const index of mapped) {
    args.push("-map", `0:${index}`);
  }
  if (mapped.length > 0) {
    args.push("-c:s", subCodec);
  }
  return args;
}

/**
 * Builds a scale filter from explicit dimensions when no filter is supplied.
 * Returns `undefined` when there is nothing to scale (so no `-vf` is emitted).
 */
export function resolveScaleFilter(input: {
  width?: number;
  height?: number;
  scaleFilter?: string;
}): string | undefined {
  if (input.scaleFilter) return input.scaleFilter;

  const width = input.width && input.width > 0 ? input.width : undefined;
  const height = input.height && input.height > 0 ? input.height : undefined;

  if (width && height) return `scale=${width}:${height}`;
  if (width) return `scale=${width}:-2`;
  if (height) return `scale=-2:${height}`;
  return undefined;
}

export function containerFromPath(outputPath: string): ContainerFormat {
  const match = /\.([^./\\]+)$/.exec(outputPath.toLowerCase());
  switch (match?.[1]) {
    case "webm":
      return "webm";
    case "mov":
      return "mov";
    case "mkv":
      return "mkv";
    case "avi":
      return "avi";
    default:
      return "mp4";
  }
}

export function buildEncodeArgs(input: EncodeArgsInput): string[] {
  const container = containerFromPath(input.outputPath);
  const args: string[] = ["-hide_banner"];

  // Input seek for trim windows — fast and accurate enough for re-encodes.
  if (input.trimStart !== undefined && input.trimStart > 0) {
    args.push("-ss", String(input.trimStart));
  }

  args.push("-i", input.inputPath);

  if (input.trimEnd !== undefined) {
    const start = input.trimStart ?? 0;
    const duration = Math.max(0, input.trimEnd - start);
    if (duration > 0) args.push("-t", String(duration));
  }

  const filter = resolveScaleFilter(input);
  if (filter) {
    args.push("-vf", filter);
  }

  if (input.fps !== undefined && input.fps > 0) {
    args.push("-r", String(input.fps));
  }

  // When keeping only specific subtitle languages we must take control of the
  // stream mapping; otherwise let ffmpeg default-map video/audio/subs.
  const subHandling = input.subtitleHandling ?? { mode: "copy" as const };
  const explicitSubMap = subHandling.mode === "only";
  const audioStripped =
    input.audioHandling !== undefined
      ? input.audioHandling === "strip"
      : Boolean(input.stripAudio);
  if (explicitSubMap) {
    args.push("-map", "0:v");
    if (!audioStripped) args.push("-map", "0:a?");
  }

  args.push(...codecArgs(input.codec, input.crf, input.preset));
  args.push(...audioArgs(container, Boolean(input.stripAudio), input.audioHandling));
  args.push(...subtitleArgs(container, subHandling, input.subtitleStreamIndices));

  if (input.stripMetadata) {
    args.push("-map_metadata", "-1");
  }

  if (input.faststart && (container === "mp4" || container === "mov")) {
    args.push("-movflags", "+faststart");
  }

  if (input.extraArgs?.length) {
    args.push(...input.extraArgs);
  }

  args.push(input.outputPath);
  return args;
}

export function buildPosterArgs(
  inputPath: string,
  outputPath: string,
  atSeconds = 0,
): string[] {
  return [
    "-hide_banner",
    "-ss",
    String(atSeconds),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=-2:720",
    "-q:v",
    "3",
    outputPath,
  ];
}

export function buildProbeArgs(inputPath: string): string[] {
  return [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    inputPath,
  ];
}
