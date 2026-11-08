import { describe, expect, it } from "vitest";
import { parseEncoderListing, resolveFallbackCodec } from "./encoder-inventory";

const encodersWithH264H265VP9 = [
  "V..... = Video",
  "------",
  "V....D libx264              libx264 H.264 / AVC",
  "V....D libx265              libx265 H.265 / HEVC",
  "V....D libvpx-vp9           libvpx VP9",
].join("\n");

const encodersWithoutH265 = [
  "V..... = Video",
  "------",
  "V....D libx264              libx264 H.264 / AVC",
].join("\n");

const encodersNotMatchingLibx264 = [
  "notlibx264foo",
  "libx264rgb",
].join("\n");

describe("parseEncoderListing", () => {
  it("asserts libx264/libx265/libvpxVp9 true and multiThreaded passthrough (both true and false)", () => {
    const caps = parseEncoderListing(
      encodersWithH264H265VP9.split("\n"),
      true,
    );
    expect(caps.libx264).toBe(true);
    expect(caps.libx265).toBe(true);
    expect(caps.libvpxVp9).toBe(true);
    expect(caps.multiThreaded).toBe(true);

    const capsFalse = parseEncoderListing(
      encodersWithH264H265VP9.split("\n"),
      false,
    );
    expect(capsFalse.multiThreaded).toBe(false);
  });

  it("a listing without libx265 yields libx265 false while libx264 true", () => {
    const caps = parseEncoderListing(
      encodersWithoutH265.split("\n"),
      true,
    );
    expect(caps.libx264).toBe(true);
    expect(caps.libx265).toBe(false);
  });

  it("a substring like x264 inside another name does not falsely match libx264", () => {
    // "notlibx264foo" should NOT count as libx264 — no whitespace boundary around "libx264"
    const caps1 = parseEncoderListing([encodersNotMatchingLibx264], true);
    expect(caps1.libx264).toBe(false);

    // "libx264rgb" should NOT count as libx264 — "libx264" is followed by non-whitespace
    const caps2 = parseEncoderListing([encodersNotMatchingLibx264], true);
    expect(caps2.libx264).toBe(false);
  });
});

describe("resolveFallbackCodec", () => {
  it("requested h265 available -> {codec:h265, fellBack:false}", () => {
    const caps = parseEncoderListing(
      encodersWithH264H265VP9.split("\n"),
      true,
    );
    const result = resolveFallbackCodec("h265", caps);
    expect(result).toEqual({ codec: "h265", fellBack: false });
  });

  it("requested h265 unavailable, libx264 available -> {codec:h264, fellBack:true}", () => {
    const caps = parseEncoderListing(
      encodersWithoutH265.split("\n"),
      true,
    );
    const result = resolveFallbackCodec("h265", caps);
    expect(result).toEqual({ codec: "h264", fellBack: true });
  });

  it("requested h264 available -> no fallback", () => {
    const caps = parseEncoderListing(
      encodersWithH264H265VP9.split("\n"),
      true,
    );
    const result = resolveFallbackCodec("h264", caps);
    expect(result).toEqual({ codec: "h264", fellBack: false });
  });

  it("requested vp9 unavailable, libx264 available -> h264 fallback", () => {
    const caps = parseEncoderListing(
      encodersWithoutH265.split("\n"),
      true,
    );
    const result = resolveFallbackCodec("vp9", caps);
    expect(result).toEqual({ codec: "h264", fellBack: true });
  });
});