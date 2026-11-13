/**
 * Before/after encode comparison logging — diagnostic logs only, never shown in the UI.
 * The downloadable diagnostic file includes these entries verbatim.
 */

import { diag } from "./diagnostics";
import type { TargetCodec, VideoMetadata, ContainerFormat } from "@/types/media";
import type { AudioHandling, SubtitleHandling } from "./ffmpeg/recipe";

export interface BeforeAfterInput {
  label: string;
  inputFileName: string;
  inputBytes: number;
  outputBytes: number;
  codec: TargetCodec;
  requestedCodec?: TargetCodec;
  crf: number;
  container: ContainerFormat | string;
  encodeMs: number;
  metadata: VideoMetadata | null;
  outputScale?: { width?: number; height?: number } | undefined;
  audioHandling: AudioHandling;
  subtitleHandling: SubtitleHandling;
  stripMetadata: boolean;
}

export function logBeforeAfter(input: BeforeAfterInput): void {
  const { metadata } = input;
  const savedBytes = Math.max(0, input.inputBytes - input.outputBytes);
  const savedPct =
    input.inputBytes > 0
      ? Math.round((1 - input.outputBytes / input.inputBytes) * 1000) / 10
      : null;
  diag.info("compare", "input vs output", {
    label: input.label,
    inputFile: input.inputFileName,
    inputBytes: input.inputBytes,
    outputBytes: input.outputBytes,
    savedBytes,
    savedPct,
    ratio: input.inputBytes > 0 ? Math.round((input.outputBytes / input.inputBytes) * 1000) / 1000 : null,
    codec: input.codec,
    requestedCodec: input.requestedCodec ?? input.codec,
    crf: input.crf,
    container: input.container,
    encodeMs: input.encodeMs,
    input: metadata
      ? {
          width: metadata.width,
          height: metadata.height,
          fps: Math.round(metadata.fps * 100) / 100,
          codec: metadata.videoCodec,
          pixelFormat: metadata.pixelFormat,
          durationS: Math.round(metadata.duration * 100) / 100,
          bitrateKbps: metadata.bitrate ? Math.round(metadata.bitrate / 1000) : null,
          hadAudio: metadata.hasAudio,
          audioCodec: metadata.audioCodec ?? null,
          subtitleStreams: metadata.subtitleStreams?.length ?? 0,
        }
      : null,
    output: {
      width: input.outputScale?.width ?? metadata?.width ?? null,
      height: input.outputScale?.height ?? metadata?.height ?? null,
      audio: input.audioHandling === "strip" ? "stripped" : input.audioHandling,
      subtitles:
        input.subtitleHandling.mode === "only"
          ? `only:${input.subtitleHandling.languages.join(",")}`
          : input.subtitleHandling.mode,
      metadata: input.stripMetadata ? "stripped" : "kept",
    },
  });
}
