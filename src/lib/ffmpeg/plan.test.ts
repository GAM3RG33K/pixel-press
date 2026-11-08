import { describe, expect, it } from "vitest";
import {
  codecFallbackNotice,
  applyEncoderFallback,
  applyPlanFallbacks,
  uniqueFallbackNotices,
  type FallbackNotice,
} from "./plan";
import type { EncoderCapabilities, EncodeVariant, TargetCodec } from "@/types/media";

const caps = (overrides: Partial<EncoderCapabilities> = {}): EncoderCapabilities => ({
  libvpx: true,
  libx264: true,
  libx265: true,
  multiThreaded: true,
  ...overrides,
});

const variant = (overrides: Partial<EncodeVariant> = {}): EncodeVariant => ({
  label: "test-variant",
  targetContainer: "mp4",
  requestedCodec: "h265",
  actualCodec: "h265",
  crf: 23,
  preset: "medium",
  width: 1920,
  height: 1080,
  scaleFilter: "lanczos",
  fps: 30,
  stripAudio: false,
  generatePoster: false,
  estimatedSizeBytes: 50_000_000,
  ffmpegArgs: [],
  ...overrides,
});

describe("codecFallbackNotice", () => {
  it("returns null when the requested codec is available (h265 with all codecs true)", () => {
    const result = codecFallbackNotice("h265", caps({ libx265: true, libx264: true }));
    expect(result).toBeNull();
  });

  it("returns a notice with requestedCodec h265 and actualCodec h264 when libx265 is unavailable but libx264 is available", () => {
    const result = codecFallbackNotice("h265", caps({ libx265: false, libx264: true }));
    expect(result).not.toBeNull();
    const notice: FallbackNotice = result as FallbackNotice;
    expect(notice.requestedCodec).toBe("h265");
    expect(notice.actualCodec).toBe("h264");
    expect(notice.message).toContain("H.265 (HEVC)");
    expect(notice.message).toContain("H.264 (AVC)");
  });

  it("returns actualCodec h264 when vp8 is requested but libvpx is unavailable and libx264 is available", () => {
    const result = codecFallbackNotice("vp8", caps({ libvpx: false, libx264: true }));
    expect(result).not.toBeNull();
    const notice: FallbackNotice = result as FallbackNotice;
    expect(notice.requestedCodec).toBe("vp8");
    expect(notice.actualCodec).toBe("h264");
  });

  it("includes variant label in the message when variantLabel is provided ('4K variant' -> '4K variant variant')", () => {
    const result = codecFallbackNotice("h265", caps({ libx265: false, libx264: true }), "4K variant");
    expect(result).not.toBeNull();
    const notice: FallbackNotice = result as FallbackNotice;
    expect(notice.message).toContain("4K variant variant");
  });
});

describe("applyEncoderFallback", () => {
  it("returns a new variant object (not the same reference) and sets actualCodec to h264 while leaving requestedCodec as h265", () => {
    const original = variant({ requestedCodec: "h265", actualCodec: "h265" });
    const result = applyEncoderFallback(original, caps({ libx265: false, libx264: true }));
    expect(result.variant).not.toBe(original);
    expect(result.variant.actualCodec).toBe("h264");
    expect(result.variant.requestedCodec).toBe("h265");
    expect(result.notice).not.toBeNull();
    const notice: FallbackNotice = result.notice as FallbackNotice;
    expect(notice.requestedCodec).toBe("h265");
    expect(notice.actualCodec).toBe("h264");
  });

  it("does not mutate the input variant's actualCodec", () => {
    const original = variant({ requestedCodec: "h265", actualCodec: "h265" });
    const beforeActualCodec = original.actualCodec;
    applyEncoderFallback(original, caps({ libx265: false, libx264: true }));
    expect(original.actualCodec).toBe(beforeActualCodec);
  });

  it("when the codec is available, no notice is returned and actualCodec is unchanged", () => {
    const original = variant({ requestedCodec: "h265", actualCodec: "h265" });
    const result = applyEncoderFallback(original, caps({ libx265: true, libx264: true }));
    expect(result.notice).toBeNull();
    expect(result.variant.actualCodec).toBe("h265");
    expect(result.variant.requestedCodec).toBe("h265");
  });
});

describe("applyPlanFallbacks", () => {
  it("applies fallback to both variants when h265 is requested but x264 is available and vp8 is available (no fallback for vp8)", () => {
    const plan = {
      variants: [
        variant({ requestedCodec: "h265", actualCodec: "h265" }),
        variant({ requestedCodec: "vp8", actualCodec: "vp8" }),
      ],
      workflow: "compress",
      reasoning: "test reasoning",
    };
    const result = applyPlanFallbacks(plan, caps({ libx265: false, libx264: true }));
    expect((result.plan.variants[0] as EncodeVariant).actualCodec).toBe("h264");
    expect((result.plan.variants[1] as EncodeVariant).actualCodec).toBe("vp8");
    expect(result.notices).toHaveLength(1);
    expect((result.notices[0] as FallbackNotice).requestedCodec).toBe("h265");
    expect((result.notices[0] as FallbackNotice).actualCodec).toBe("h264");
  });

  it("preserves unrelated plan fields such as workflow and reasoning", () => {
    const plan = {
      variants: [variant({ requestedCodec: "h265", actualCodec: "h265" })],
      workflow: "scan-and-optimize",
      reasoning: "optimize for quality",
    };
    const result = applyPlanFallbacks(plan, caps({ libx265: false, libx264: true }));
    expect(result.plan.workflow).toBe("scan-and-optimize");
    expect(result.plan.reasoning).toBe("optimize for quality");
    expect(result.notices).toHaveLength(1);
  });
});

describe("uniqueFallbackNotices", () => {
  it("deduplicates identical notices while preserving order", () => {
    const notices: FallbackNotice[] = [
      {
        requestedCodec: "h265" as TargetCodec,
        actualCodec: "h264" as TargetCodec,
        message:
          "This plan requested H.265 (HEVC), which this browser's encoder does not provide. It will be compressed with H.264 (AVC) instead.",
      },
      {
        requestedCodec: "h265" as TargetCodec,
        actualCodec: "h264" as TargetCodec,
        message:
          "This plan requested H.265 (HEVC), which this browser's encoder does not provide. It will be compressed with H.264 (AVC) instead.",
      },
      {
        requestedCodec: "vp8" as TargetCodec,
        actualCodec: "h264" as TargetCodec,
        message:
          "This plan requested VP8, which this browser's encoder does not provide. It will be compressed with H.264 (AVC) instead.",
      },
    ];
    const unique = uniqueFallbackNotices(notices);
    // Cast needed due to noUncheckedIndexedAccess: true
    const u = unique as FallbackNotice[];
    expect(u).toHaveLength(2);
    expect((u[0] as FallbackNotice).requestedCodec).toBe("h265");
    expect((u[1] as FallbackNotice).requestedCodec).toBe("vp8");
  });
});