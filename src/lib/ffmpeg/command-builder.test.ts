import { describe, it, expect } from "vitest";
import {
  buildEncodeArgs,
  buildPosterArgs,
  buildProbeArgs,
  codecArgs,
  audioArgs,
  containerFromPath,
  resolveScaleFilter,
} from "@/lib/ffmpeg/command-builder";

describe("codecArgs", () => {
  it("h265 uses libx265 with crf and tag hvc1", () => {
    expect(codecArgs("h265", 28, "slow")).toEqual([
      "-c:v",
      "libx265",
      "-preset",
      "slow",
      "-crf",
      "28",
      "-tag:v",
      "hvc1",
    ]);
  });

  it("h264 uses yuv420p", () => {
    const args = codecArgs("h264", 20);
    expect(args).toContain("libx264");
    expect(args).toContain("yuv420p");
  });

  it("vp9 sets CRF mode with b:v 0 and cpu-used", () => {
    const args = codecArgs("vp9", 30);
    expect(args).toContain("libvpx-vp9");
    expect(args).toContain("-b:v");
    expect(args).toContain("0");
    expect(args).toContain("-cpu-used");
  });

  it("av1 uses libsvtav1 with preset 8", () => {
    const args = codecArgs("av1", 32);
    expect(args).toContain("libsvtav1");
    expect(args).toContain("8");
  });
});

describe("audioArgs", () => {
  it("returns -an when stripping", () => {
    expect(audioArgs("mp4", true)).toEqual(["-an"]);
  });

  it("mp4 and mov use aac at 128k", () => {
    expect(audioArgs("mp4", false)).toEqual(["-c:a", "aac", "-b:a", "128k"]);
    expect(audioArgs("mov", false)).toEqual(["-c:a", "aac", "-b:a", "128k"]);
  });

  it("webm uses libopus at 96k, stereo-downmixed for 5.1(side) sources", () => {
    expect(audioArgs("webm", false)).toEqual(["-c:a", "libopus", "-b:a", "96k", "-ac", "2"]);
  });
});

describe("resolveScaleFilter", () => {
  it("returns undefined when there is nothing to scale", () => {
    expect(resolveScaleFilter({})).toBeUndefined();
  });

  it("prioritizes an explicit filter", () => {
    expect(
      resolveScaleFilter({ scaleFilter: "scale=640:-2", width: 1920 }),
    ).toBe("scale=640:-2");
  });
});

describe("buildEncodeArgs", () => {
  const base = {
    inputPath: "/in.mkv",
    outputPath: "/out.mp4",
    codec: "h264" as const,
    crf: 20,
  };

  it("starts with -i input and ends with the output path", () => {
    const out = buildEncodeArgs(base);
    expect(out.slice(0, 3)).toEqual(["-hide_banner", "-i", "/in.mkv"]);
    expect(out.at(-1)).toBe("/out.mp4");
  });

  it("omits -vf when no scaling is requested", () => {
    expect(buildEncodeArgs(base)).not.toContain("-vf");
  });

  it("includes -an when stripAudio", () => {
    expect(buildEncodeArgs({ ...base, stripAudio: true })).toContain("-an");
  });

  it("builds scale filters from width and height", () => {
    expect(buildEncodeArgs({ ...base, width: 1920, height: 1080 })).toContain(
      "scale=1920:1080",
    );
    expect(buildEncodeArgs({ ...base, width: 1280 })).toContain("scale=1280:-2");
    expect(buildEncodeArgs({ ...base, height: 720 })).toContain("scale=-2:720");
  });

  it("uses an explicit scaleFilter", () => {
    const out = buildEncodeArgs({ ...base, scaleFilter: "scale=1280:-2" });
    expect(out).toContain("-vf");
    expect(out).toContain("scale=1280:-2");
  });

  it("adds -r only for a positive fps", () => {
    expect(buildEncodeArgs(base)).not.toContain("-r");
    expect(buildEncodeArgs({ ...base, fps: 0 })).not.toContain("-r");
    expect(buildEncodeArgs({ ...base, fps: -1 })).not.toContain("-r");
    expect(buildEncodeArgs({ ...base, fps: 60 })).toContain("-r");
  });

  it("adds faststart for mp4/mov only", () => {
    const mp4 = buildEncodeArgs({ ...base, faststart: true });
    expect(mp4).toContain("-movflags");
    expect(mp4).toContain("+faststart");

    const webm = buildEncodeArgs({
      ...base,
      outputPath: "/out.webm",
      codec: "vp9",
      faststart: true,
    });
    expect(webm).not.toContain("-movflags");
  });

  it("infers the audio codec from the output extension", () => {
    expect(buildEncodeArgs(base)).toContain("aac");
    expect(
      buildEncodeArgs({ ...base, outputPath: "/out.webm", codec: "vp9" }),
    ).toContain("libopus");
  });

  it("appends extraArgs before the output path", () => {
    const out = buildEncodeArgs({ ...base, extraArgs: ["-map", "0"] });
    expect(out.indexOf("-map")).toBeGreaterThan(-1);
    expect(out.at(-1)).toBe("/out.mp4");
  });
});

describe("buildPosterArgs", () => {
  it("seeks, takes one frame, scales to 720p, and writes the output", () => {
    expect(buildPosterArgs("/in.mkv", "/out.jpg", 5)).toEqual([
      "-hide_banner",
      "-ss",
      "5",
      "-i",
      "/in.mkv",
      "-frames:v",
      "1",
      "-vf",
      "scale=-2:720",
      "-q:v",
      "3",
      "/out.jpg",
    ]);
  });

  it("defaults atSeconds to 0", () => {
    expect(buildPosterArgs("/in.mkv", "/out.jpg")[2]).toBe("0");
  });
});

describe("buildProbeArgs", () => {
  it("requests JSON format and stream info", () => {
    expect(buildProbeArgs("/in.mp4")).toEqual([
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      "/in.mp4",
    ]);
  });
});

describe("containerFromPath", () => {
  it("maps known extensions case-insensitively", () => {
    expect(containerFromPath("/out.mp4")).toBe("mp4");
    expect(containerFromPath("/out.webm")).toBe("webm");
    expect(containerFromPath("/out.MOV")).toBe("mov");
    expect(containerFromPath("/out.WEBM")).toBe("webm");
  });

  it("maps known extensions and defaults unknown to mp4", () => {
    expect(containerFromPath("/out.avi")).toBe("avi");
    expect(containerFromPath("/out.mkv")).toBe("mkv");
    expect(containerFromPath("/out.webm")).toBe("webm");
    expect(containerFromPath("/out.mov")).toBe("mov");
    expect(containerFromPath("out")).toBe("mp4");
  });
});

describe("container & subtitle/audio handling", () => {
  const base = { inputPath: "/in.mkv", outputPath: "/out.mkv", codec: "h264" as const, crf: 26 };

  it("emits mkv container args with audio copy", () => {
    const args = buildEncodeArgs({ ...base, audioHandling: "copy" });
    expect(args).toContain("-c:a");
    expect(args).toContain("copy");
    expect(args[args.length - 1]).toBe("/out.mkv");
  });

  it("strips subtitles with -sn", () => {
    const args = buildEncodeArgs({ ...base, subtitleHandling: { mode: "strip" } });
    expect(args).toContain("-sn");
  });

  it("copies subtitles with container-appropriate codec (mkv → copy, mp4 → mov_text)", () => {
    expect(buildEncodeArgs({ ...base, subtitleHandling: { mode: "copy" } })).toContain("copy");
    const mp4 = buildEncodeArgs({ ...base, outputPath: "/out.mp4", subtitleHandling: { mode: "copy" } });
    expect(mp4).toContain("mov_text");
  });

  it("maps only the requested subtitle stream indices (never language-specifier syntax)", () => {
    const args = buildEncodeArgs({
      ...base,
      outputPath: "/out.mkv",
      subtitleHandling: { mode: "only", languages: ["eng"] },
      subtitleStreamIndices: [2],
    });
    expect(args).toContain("0:2");
    expect(args).not.toContain("0:s:m:language:eng?");
    // stripped audio ⇒ no audio mapping, even with explicit subtitle map
    const withStrip = buildEncodeArgs({
      ...base,
      outputPath: "/out.mkv",
      audioHandling: "strip",
      subtitleHandling: { mode: "only", languages: ["eng"] },
      subtitleStreamIndices: [2],
    });
    expect(withStrip).not.toContain("0:a?");
    expect(withStrip).toContain("-an");
    expect(withStrip).toContain("0:v");
  });

  it("explicit subtitle map does not reference audio when stripped", () => {
    const args = buildEncodeArgs({
      ...base,
      outputPath: "/out.mp4",
      audioHandling: "strip",
      subtitleHandling: { mode: "only", languages: ["eng"] },
      subtitleStreamIndices: [2, 3],
    });
    expect(args).not.toContain("0:a?");
    expect(args).toContain("mov_text");
  });

  it("strips metadata with -map_metadata -1", () => {
    const args = buildEncodeArgs({ ...base, stripMetadata: true });
    const i = args.indexOf("-map_metadata");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("-1");
  });

  it("trims with input seek -ss and -t duration", () => {
    const args = buildEncodeArgs({ ...base, trimStart: 30, trimEnd: 90 });
    const ss = args.indexOf("-ss");
    expect(ss).toBeGreaterThan(-1);
    expect(args[ss + 1]).toBe("30");
    const t = args.indexOf("-t");
    expect(t).toBeGreaterThan(-1);
    expect(args[t + 1]).toBe("60");
  });

  it("does not emit -ss/-t for full-length encodes", () => {
    const args = buildEncodeArgs(base);
    expect(args).not.toContain("-ss");
    expect(args).not.toContain("-t");
  });
});
