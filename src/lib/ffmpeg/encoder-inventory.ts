import type { EncoderCapabilities } from "@/types/media";

/**
 * Parses FFmpeg's `-encoders` listing (as emitted on stderr) and reports the
 * encoder families the app cares about.
 */
export function parseEncoderListing(
  lines: string[],
  multiThreaded: boolean,
): EncoderCapabilities {
  const text = lines.join("\n");
  const has = (name: string): boolean =>
    new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "m").test(
      text,
    );

  return {
    libvpxVp9: has("libvpx-vp9"),
    libx264: has("libx264"),
    libx265: has("libx265"),
    multiThreaded,
  };
}

/**
 * Chooses the last-resort codec when the requested one is unavailable.
 * H.265 is preferred; H.264 is the guaranteed fallback.
 */
export function resolveFallbackCodec(
  requested: "h265" | "h264" | "vp9" | "av1",
  capabilities: EncoderCapabilities,
): { codec: "h265" | "h264" | "vp9" | "av1"; fellBack: boolean } {
  const available = {
    h265: capabilities.libx265,
    h264: capabilities.libx264,
    vp9: capabilities.libvpxVp9,
    av1: true,
  } as const;

  if (available[requested]) {
    return { codec: requested, fellBack: false };
  }

  if (capabilities.libx264) {
    return { codec: "h264", fellBack: requested !== "h264" };
  }

  return { codec: requested, fellBack: false };
}
