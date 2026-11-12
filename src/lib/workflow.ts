import type { CompressionPlan } from "@/skills/compress-video-rules";
import type { ContainerFormat, TargetCodec, VideoMetadata } from "@/types/media";
import { evaluateRules } from "@/skills/compress-video-rules";
import { resolveOutputContainer, type EncodeRecipe } from "@/lib/ffmpeg/recipe";

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
    description: "Broad compatibility fallback for all devices",
    intent: "make this universally compatible, h264 mp4",
  },
  {
    id: "efficient-webm",
    label: "High-Efficiency VP9/WebM",
    description: "Smallest file size with VP9/WebM",
    intent: "make the file as small as possible, vp9 webm",
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
  container: ContainerFormat;
  codec: TargetCodec;
  requestedCodec: TargetCodec;
  crf: number;
  preset?: string | undefined;
  targetScale?: { width?: number; height?: number } | undefined;
  stripAudio: boolean;
  twoPass: boolean;
  estimatedSizeBytes: number;
  ffmpegFlags: string[];
}

/**
 * Maps a deterministic CompressionPlan to the concrete outputs the app
 * produces: a WebM (VP9) and/or MP4 (H.264/H.265) variant.
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
  const base = codec === "vp9" ? 0.42 : 0.5;
  const factor = Math.pow(base, (crf - 18) / 6);
  return Math.round(sourceBytes * Math.min(1, Math.max(0.04, factor)));
}

function ffmpegFlags(codec: TargetCodec, crf: number): string[] {
  if (codec === "vp9") {
    return ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf), "-deadline", "good", "-cpu-used", "2"];
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

/** Which outputs the current intent/plan actually asks for. */
export type VariantSelection = "mp4" | "webm" | "both";

/**
 * Decides which variants to emit from the intent text + plan codec.
 *  - intent/plan points at WebM/VP9 (and not MP4) → webm only
 *  - intent/plan points at MP4/H.264/H.265 (and not WebM) → mp4 only
 *  - anything else (no clear signal, or both mentioned) → both
 */
export function selectVariants(plan: CompressionPlan, intent?: string): VariantSelection {
  const text = (intent ?? "").toLowerCase();
  const webmSignal = /webm|vp9|av1/.test(text);
  const mp4Signal = /mp4|h\.?264|x264|h\.?265|x265|universal|compatib/.test(text);
  if (plan.targetCodec === "vp9" && !mp4Signal) return "webm";
  if (webmSignal && !mp4Signal) return "webm";
  if (mp4Signal && !webmSignal) return "mp4";
  return "both";
}

/**
 * Builds the user-facing variant set (MP4 fallback + WebM) from the rule engine
 * output. Emits MP4 and/or WebM depending on the intent + plan codec —
 * see {@link selectVariants}. Falls back to both when there is no clear signal.
 */
export function buildWorkbenchVariants(
  plan: CompressionPlan,
  sourceBytes: number,
  _metadata: VideoMetadata | null,
  baseName: string,
  intent?: string,
  recipe?: EncodeRecipe,
): VariantSet {
  const scale = recipe?.targetScale ?? plan.targetScale;
  const stripAudio = recipe
    ? recipe.audioHandling === "strip"
    : plan.audioHandling === "strip";

  const variants: PlannedVariant[] = [
    {
      label: "Universal MP4 (H.264)",
      container: "mp4",
      codec: plan.targetCodec === "vp9" ? "h264" : plan.targetCodec === "h264" ? "h264" : "h264",
      requestedCodec: plan.targetCodec,
      crf: Math.min(30, Math.max(18, plan.crf + 4)), // H.264 CRF band is higher
      targetScale: scale,
      stripAudio,
      twoPass: plan.twoPass ?? false,
      estimatedSizeBytes: estimateSizeBytes(sourceBytes, Math.min(30, Math.max(18, plan.crf + 4)), "h264"),
      ffmpegFlags: ffmpegFlags("h264", Math.min(30, Math.max(18, plan.crf + 4))),
    },
    {
      label: "High-Efficiency WebM (VP9)",
      container: "webm",
      codec: "vp9",
      requestedCodec: plan.targetCodec,
      crf: Math.min(46, Math.max(30, plan.crf + 10)),
      targetScale: scale,
      stripAudio,
      twoPass: false,
      estimatedSizeBytes: estimateSizeBytes(sourceBytes, Math.min(46, Math.max(30, plan.crf + 10)), "vp9"),
      ffmpegFlags: ffmpegFlags("vp9", Math.min(46, Math.max(30, plan.crf + 10))),
    },
  ];

  const recipeContainer = recipe ? resolveOutputContainer(recipe, _metadata) : "auto";
  const containerLabel: Record<ContainerFormat, string> = {
    mp4: "Universal MP4",
    mov: "QuickTime (.mov)",
    mkv: "Matroska (.mkv)",
    webm: "WebM",
    avi: "AVI",
  };
  const codecLabel = (codec: TargetCodec) =>
    codec === "vp9" ? "VP9" : codec === "h265" ? "H.265" : codec === "av1" ? "AV1" : "H.264";
  const singleVariant = (container: ContainerFormat, codec: TargetCodec, crf: number, keepLabel: string): VariantSet => {
    const effectiveCodec: TargetCodec = container === "webm" && codec !== "vp9" && codec !== "av1" ? "vp9" : codec;
    return {
      baseName,
      variants: [
        {
          label: `${containerLabel[container]} (${codecLabel(effectiveCodec)} · ${keepLabel})`,
          container,
          codec: effectiveCodec,
          requestedCodec: codec,
          crf,
          targetScale: scale,
          stripAudio,
          twoPass: recipe?.twoPass ?? plan.twoPass ?? false,
          estimatedSizeBytes: estimateSizeBytes(sourceBytes, crf, effectiveCodec),
          ffmpegFlags: ffmpegFlags(effectiveCodec, crf),
        },
      ],
    };
  };

  if (recipeContainer !== "auto") {
    // Recipe pinned a single container (explicit intent or preset) — emit exactly one variant.
    return singleVariant(
      recipeContainer as ContainerFormat,
      recipe!.targetCodec,
      recipe!.crf,
      recipe!.outputContainer === "same" ? "keep format" : "as requested",
    );
  }

  // 'auto' with decisive hands on the quality knobs — honor them exactly,
  // don't silently reinterpret as a dual output with shifted CRFs:
  //   VP9/AV1 codec   → single WebM
  //   H.265 codec     → single MP4 (hvc1)
  //   CRF set by hand (≠ plan) → single MP4 at exactly that CRF
  if (recipe) {
    if (recipe.targetCodec === "vp9" || recipe.targetCodec === "av1") {
      return singleVariant("webm", recipe.targetCodec, recipe.crf, "your codec");
    }
    if (recipe.targetCodec === "h265") {
      return singleVariant("mp4", "h265", recipe.crf, "your codec");
    }
    if (recipe.crf !== plan.crf) {
      return singleVariant("mp4", recipe.targetCodec, recipe.crf, "your CRF");
    }
  }

  const selection = selectVariants(plan, intent);
  const filtered =
    selection === "both"
      ? variants
      : variants.filter((v) => (selection === "webm" ? v.container === "webm" : v.container === "mp4"));

  return { baseName, variants: filtered };
}

export function isAudioKept(plan: CompressionPlan): boolean {
  return plan.audioHandling === "copy" || plan.audioHandling === "encode" || plan.audioHandling === undefined;
}
