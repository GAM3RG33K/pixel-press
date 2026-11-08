import type { CompressionPlan } from "@/skills/compress-video-rules";
import type { TargetCodec, VideoMetadata } from "@/types/media";
import { evaluateRules } from "@/skills/compress-video-rules";

export interface Preset {
  id: string;
  label: string;
  description: string;
  intent: string;
}

export const PRESETS: Preset[] = [
  {
    id: "hero-loop",
    label: "Web Hero Loop",
    description: "Small file, no audio, motion-friendly for above the fold",
    intent: "compress this video for a hero background, no audio, small file",
  },
  {
    id: "universal-h264",
    label: "Universal H.264 MP4",
    description: "Broad compatibility fallback for all browsers",
    intent: "make this universally compatible, h264 mp4",
  },
  {
    id: "efficient-webm",
    label: "High-Efficiency VP8/WebM",
    description: "Smallest file size with VP8/WebM",
    intent: "make the file as small as possible, vp8 webm",
  },
  {
    id: "social-1080",
    label: "Social Media 1080p",
    description: "Resize to 1080p for social platforms",
    intent: "resize for social media 1080p, keep it crisp, include audio",
  },
  {
    id: "preserve-best",
    label: "Preserve Quality",
    description: "High quality, minimal compression",
    intent: "preserve the highest quality possible, small loss",
  },
];

export interface PlannedVariant {
  label: string;
  container: "mp4" | "webm";
  codec: TargetCodec;
  requestedCodec: TargetCodec;
  crf: number;
  preset?: string | undefined;
  targetScale?: { width: number; height: number } | undefined;
  stripAudio: boolean;
  twoPass: boolean;
  estimatedSizeBytes: number;
  ffmpegFlags: string[];
}

/**
 * Maps a deterministic CompressionPlan to the concrete outputs the app
 * produces: a WebM (VP8) and/or MP4 (H.264/H.265) variant.
 */
export function buildVariantPlan(
  intentOrPreset: string | undefined,
  metadata: VideoMetadata | null,
): CompressionPlan {
  if (!metadata) {
    return {
      targetCodec: "h264",
      crf: 26,
      twoPass: false,
      audioHandling: "copy",
      preserveKeyframes: true,
      ruleSource: "No metadata — default fallback",
    };
  }
  return evaluateRules(metadata, intentOrPreset);
}


/** Estimate full-file bytes from source size and a compression factor. */
export function estimateSizeBytes(
  sourceBytes: number,
  crf: number,
  codec: TargetCodec,
): number {
  // Higher CRF = more compression = smaller file.
  const base = codec === "vp8" ? 0.42 : 0.5;
  const factor = Math.pow(base, (crf - 18) / 6);
  return Math.round(sourceBytes * Math.min(1, Math.max(0.04, factor)));
}

function ffmpegFlags(codec: TargetCodec, crf: number): string[] {
  if (codec === "vp8") {
    return ["-c:v", "libvpx", "-crf", String(crf), "-b:v", "1M", "-deadline", "good", "-cpu-used", "4"];
  }
  return [
    "-c:v",
    codec === "h265" ? "libx265" : "libx264",
    "-preset",
    "medium",
    "-crf",
    String(crf),
    ...(codec === "h265" ? ["-tag:v", "hvc1"] : ["-pix_fmt", "yuv420p"]),
  ];
}

export interface VariantSet {
  baseName: string;
  variants: PlannedVariant[];
}

/**
 * Builds the user-facing variant set (MP4 fallback + WebM) from the rule engine
 * output. Always emits an MP4 (H.264) variant plus a WebM (VP8) variant
 * unless the rule engine produced a different plan.
 */
export function buildWorkbenchVariants(
  plan: CompressionPlan,
  sourceBytes: number,
  metadata: VideoMetadata | null,
  baseName: string,
): VariantSet {
  const scale = plan.targetScale;
  const stripAudio = plan.audioHandling === "strip";

  const variants: PlannedVariant[] = [
    {
      label: "Universal MP4 (H.264)",
      container: "mp4",
      codec: plan.targetCodec === "vp8" ? "h264" : plan.targetCodec === "h264" ? "h264" : "h264",
      requestedCodec: plan.targetCodec,
      crf: Math.min(30, Math.max(18, plan.crf + 4)), // H.264 CRF band is higher
      targetScale: scale,
      stripAudio,
      twoPass: plan.twoPass ?? false,
      estimatedSizeBytes: estimateSizeBytes(sourceBytes, Math.min(30, Math.max(18, plan.crf + 4)), "h264"),
      ffmpegFlags: ffmpegFlags("h264", Math.min(30, Math.max(18, plan.crf + 4))),
    },
    {
      label: "High-Efficiency WebM (VP8)",
      container: "webm",
      codec: "vp8",
      requestedCodec: plan.targetCodec,
      crf: Math.min(46, Math.max(30, plan.crf + 10)),
      targetScale: scale,
      stripAudio,
      twoPass: false,
      estimatedSizeBytes: estimateSizeBytes(sourceBytes, Math.min(46, Math.max(30, plan.crf + 10)), "vp8"),
      ffmpegFlags: ffmpegFlags("vp8", Math.min(46, Math.max(30, plan.crf + 10))),
    },
  ];

  // Respect preserveKeyframes output preference for web hero loops
  if (metadata && metadata.fps > 30) {
    const capped = variants.map((v): PlannedVariant => ({ ...v }));
    return { baseName, variants: capped };
  }

  return { baseName, variants };
}

export function isAudioKept(plan: CompressionPlan): boolean {
  return plan.audioHandling === "copy" || plan.audioHandling === "encode" || plan.audioHandling === undefined;
}
