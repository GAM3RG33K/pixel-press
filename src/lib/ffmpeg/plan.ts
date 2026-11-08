import type {
  EncodeVariant,
  EncoderCapabilities,
  TargetCodec,
} from "@/types/media";

import { resolveFallbackCodec } from "./encoder-inventory";

/**
 * Describes the downgrade from a requested codec to the one the engine can
 * actually encode. Used to surface a user-visible notice (D-013).
 */
export interface FallbackNotice {
  requestedCodec: TargetCodec;
  actualCodec: TargetCodec;
  /** Human-readable one-liner suitable for inline UI. */
  message: string;
}

export const CODEC_LABELS: Record<TargetCodec, string> = {
  h265: "H.265 (HEVC)",
  h264: "H.264 (AVC)",
  vp9: "VP9",
  av1: "AV1",
};

/**
 * Builds a fallback notice for a requested codec, or `null` when the codec is
 * available (or when there is no better fallback).
 */
export function codecFallbackNotice(
  requested: TargetCodec,
  capabilities: EncoderCapabilities,
  variantLabel?: string,
): FallbackNotice | null {
  const { codec, fellBack } = resolveFallbackCodec(requested, capabilities);
  if (!fellBack || codec === requested) return null;

  const subject = variantLabel ? `${variantLabel} variant` : "This plan";
  return {
    requestedCodec: requested,
    actualCodec: codec,
    message: `${subject} requested ${CODEC_LABELS[requested]}, which this build's encoder does not provide. It will be compressed with ${CODEC_LABELS[codec]} instead.`,
  };
}

/**
 * Applies capability fallback to a single plan variant. `ffmpegArgs` is
 * intentionally not built here — callers build args after this step so they
 * always match `actualCodec`.
 */
export function applyEncoderFallback(
  variant: EncodeVariant,
  capabilities: EncoderCapabilities,
): { variant: EncodeVariant; notice: FallbackNotice | null } {
  const { codec, fellBack } = resolveFallbackCodec(
    variant.requestedCodec,
    capabilities,
  );
  const updated: EncodeVariant = { ...variant, actualCodec: codec };

  if (!fellBack || codec === variant.requestedCodec) {
    return { variant: updated, notice: null };
  }

  return {
    variant: updated,
    notice: {
      requestedCodec: variant.requestedCodec,
      actualCodec: codec,
      message: `${variant.label} requested ${CODEC_LABELS[variant.requestedCodec]}, which this build's encoder does not provide. It will be compressed with ${CODEC_LABELS[codec]} instead.`,
    },
  };
}

/**
 * Applies fallback resolution to every variant in a plan and returns the
 * resulting notices (usually zero or one per distinct downgrade).
 */
export function applyPlanFallbacks<T extends { variants: EncodeVariant[] }>(
  plan: T,
  capabilities: EncoderCapabilities,
): { plan: T; notices: FallbackNotice[] } {
  const notices: FallbackNotice[] = [];
  const variants = plan.variants.map((variant) => {
    const applied = applyEncoderFallback(variant, capabilities);
    if (applied.notice) notices.push(applied.notice);
    return applied.variant;
  });

  return { plan: { ...plan, variants }, notices };
}

/** Collapses duplicate notices (same codec pair + message) for display. */
export function uniqueFallbackNotices(
  notices: FallbackNotice[],
): FallbackNotice[] {
  const seen = new Set<string>();
  return notices.filter((notice) => {
    const key = `${notice.requestedCodec}->${notice.actualCodec}:${notice.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

