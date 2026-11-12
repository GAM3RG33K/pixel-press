/**
 * Shared media and compression domain types.
 * These mirror the data model in the specification and are consumed by both
 * the UI and the FFmpeg service.
 */

export type ContainerFormat = "mp4" | "webm" | "mov" | "mkv" | "avi";

export type TargetCodec = "h265" | "h264" | "vp9" | "av1";

export interface SubtitleStream {
  index: number;
  codec?: string;
  /** ISO 639-2 language tag as reported by ffprobe (e.g. "eng"), if any. */
  lang?: string;
  title?: string;
}

export interface VideoMetadata {
  id: string;
  fileName: string;
  fileSize: number;
  duration: number;
  container: string;
  videoCodec: string;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  pixelFormat: string;
  hasAudio: boolean;
  audioCodec?: string;
  audioBitrate?: number;
  /** Audio stream language tags (ISO 639-2), in stream order. */
  audioLanguages?: string[];
  /** Subtitle stream summary from ffprobe — drives "keep only <lang>" subtitle handling. */
  subtitleStreams?: SubtitleStream[];
}

export interface ProgressSample {
  /** Elapsed encode time in seconds, parsed from `time=`. */
  timeSeconds: number;
  /** Frames rendered so far, parsed from `frame=`. */
  frame?: number;
  /** Frames per second, parsed from `fps=`. */
  fps?: number;
  /** Encode speed multiplier, parsed from `speed=`. */
  speed?: number;
  /** Current output bitrate in bits per second, parsed from `bitrate=`. */
  bitrate?: number;
  /** Current output size in bytes, parsed from `size=`. */
  sizeBytes?: number;
  /** The raw log line this sample came from. */
  raw: string;
}

export interface EncoderCapabilities {
  libvpxVp9: boolean;
  libx264: boolean;
  libx265: boolean;
  multiThreaded: boolean;
  /** Populated when the capability probe could not complete. */
  probeError?: string;
}

export interface EncodeVariant {
  label: string;
  targetContainer: ContainerFormat;
  /** Codec requested by the plan. May differ from `actualCodec` after fallback. */
  requestedCodec: TargetCodec;
  /** Codec actually used after capability checks. */
  actualCodec: TargetCodec;
  crf: number;
  preset?: string;
  width?: number;
  height?: number;
  scaleFilter?: string;
  fps?: number;
  stripAudio: boolean;
  generatePoster: boolean;
  estimatedSizeBytes: number;
  /**
   * Full FFmpeg args, built by the encode layer once sandbox paths are known.
   * Never build these before `applyPlanFallbacks` has resolved `actualCodec`.
   */
  ffmpegArgs?: string[];
}

export interface CompressionPlan {
  workflow: "compress" | "compare" | "audit" | "scan-and-optimize";
  reasoning: string;
  variants: EncodeVariant[];
  htmlSnippetSuggestion?: string;
}

export interface ProbeResult {
  metadata: VideoMetadata;
  /** Raw ffprobe JSON output, kept for debugging and advanced rules. */
  raw: string;
}
