import type { ContainerFormat, TargetCodec } from "@/types/media";

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
): string[] {
  if (stripAudio) return ["-an"];
  switch (container) {
    case "webm":
      // 5.1(side) / 7.1 inputs can't feed libopus's default mapping family;
      // always downmix to stereo — universally playable for web autoplay.
      return ["-c:a", "libopus", "-b:a", "96k", "-ac", "2"];
    case "mp4":
    case "mov":
      return ["-c:a", "aac", "-b:a", "128k"];
  }
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
    default:
      return "mp4";
  }
}

export function buildEncodeArgs(input: EncodeArgsInput): string[] {
  const container = containerFromPath(input.outputPath);
  const args: string[] = ["-hide_banner", "-i", input.inputPath];

  const filter = resolveScaleFilter(input);
  if (filter) {
    args.push("-vf", filter);
  }

  if (input.fps !== undefined && input.fps > 0) {
    args.push("-r", String(input.fps));
  }

  args.push(...codecArgs(input.codec, input.crf, input.preset));
  args.push(...audioArgs(container, Boolean(input.stripAudio)));

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
