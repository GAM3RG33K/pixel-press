import { describe, expect, it } from "vitest";

import {
  applyIntentConstraints,
  parseIntentConstraints,
  recipeFromPlan,
  resolveOutputContainer,
  type ResolvedRecipe,
} from "./recipe";
import type { VideoMetadata } from "@/types/media";

const meta = (overrides: Partial<VideoMetadata> = {}): VideoMetadata => ({
  id: "video-test-1",
  fileName: "input.mkv",
  fileSize: 10 * 1024 * 1024,
  duration: 100,
  container: "matroska,webm",
  videoCodec: "h264",
  width: 1920,
  height: 800,
  fps: 24,
  bitrate: 1_600_000,
  pixelFormat: "yuv420p",
  hasAudio: true,
  subtitleStreams: [
    { index: 2, codec: "subrip", lang: "eng" },
    { index: 3, codec: "ass", lang: "hin" },
  ],
  ...overrides,
});

const baseResolved = (): ResolvedRecipe =>
  recipeFromPlan(
    { targetCodec: "h264", crf: 26, audioHandling: "copy", ruleSource: "R7: Default fallback" },
    "rule-engine",
  );

describe("parseIntentConstraints", () => {
  it("returns nothing for plain quality intents", () => {
    const result = parseIntentConstraints("make it look good", meta());
    expect(result.notes.length).toBe(0);
    expect(result.unhandled).toBe(false);
  });

  it("keeps the source container when asked to keep the .mkv", () => {
    const result = parseIntentConstraints("keep the .mkv, strip audio", meta());
    expect(result.recipe.outputContainer).toBe("same");
    expect(result.recipe.audioHandling).toBe("strip");
    expect(result.unhandled).toBe(false);
  });

  it("maps 'keep the container/extension' generically", () => {
    expect(parseIntentConstraints("retain the original container", meta()).recipe.outputContainer).toBe("same");
    expect(parseIntentConstraints("keep the extension please", meta()).recipe.outputContainer).toBe("same");
  });

  it("converts when explicitly asked", () => {
    expect(parseIntentConstraints("convert to webm", meta()).recipe.outputContainer).toBe("webm");
    expect(parseIntentConstraints("export as mp4", meta()).recipe.outputContainer).toBe("mp4");
    expect(parseIntentConstraints("convert it to a .mkv", meta()).recipe.outputContainer).toBe("mkv");
  });

  it("understands strip audio / no audio / mute", () => {
    expect(parseIntentConstraints("no audio", meta()).recipe.audioHandling).toBe("strip");
    expect(parseIntentConstraints("mute this thing", meta()).recipe.audioHandling).toBe("strip");
    expect(parseIntentConstraints("strip the audio track", meta()).recipe.audioHandling).toBe("strip");
  });

  it("keeps audio on request", () => {
    expect(parseIntentConstraints("keep the audio", meta()).recipe.audioHandling).toBe("copy");
  });

  it("strips and keeps subtitles", () => {
    expect(parseIntentConstraints("strip all subs", meta()).recipe.subtitleHandling).toEqual({ mode: "strip" });
    expect(parseIntentConstraints("keep subtitles", meta()).recipe.subtitleHandling).toEqual({ mode: "copy" });
    expect(parseIntentConstraints("remove the subtitles", meta()).recipe.subtitleHandling).toEqual({ mode: "strip" });
  });

  it("keeps only english subs via alias expansion", () => {
    expect(parseIntentConstraints("keep only english subs", meta()).recipe.subtitleHandling).toEqual({ mode: "only", languages: ["eng"] });
    expect(parseIntentConstraints("keep only eng subtitles", meta()).recipe.subtitleHandling).toEqual({ mode: "only", languages: ["eng"] });
  });

  it("keep subs except <lang> keeps everything else", () => {
    const result = parseIntentConstraints("subs except eng", meta());
    // eng excluded → remaining stream is hin
    expect(result.recipe.subtitleHandling).toEqual({ mode: "only", languages: ["hin"] });
  });

  it("strips metadata on request", () => {
    expect(parseIntentConstraints("strip metadata", meta()).recipe.stripMetadata).toBe(true);
  });

  it("parses trim windows", () => {
    expect(parseIntentConstraints("trim 0:30 to 1:00", meta()).recipe).toMatchObject({ trimStart: 30, trimEnd: 60 });
    expect(parseIntentConstraints("trim 1:00:00 to 1:05:30", meta()).recipe).toMatchObject({ trimStart: 3600, trimEnd: 3930 });
    expect(parseIntentConstraints("first 30 seconds", meta()).recipe).toMatchObject({ trimStart: 0, trimEnd: 30 });
    expect(parseIntentConstraints("first 2 minutes", meta()).recipe).toMatchObject({ trimStart: 0, trimEnd: 120 });
  });

  it("flags unhandled customization keywords", () => {
    expect(parseIntentConstraints("make it exactly 42 megabytes", meta()).unhandled).toBe(true);
    expect(parseIntentConstraints("rotate 90 degrees", meta()).unhandled).toBe(true);
  });

  it("does not flag fully-handled customizations", () => {
    expect(parseIntentConstraints("keep the .mkv", meta()).unhandled).toBe(false);
  });
});

describe("applyIntentConstraints", () => {
  it("intent wins over AI/rule output and stamps source 'you'", () => {
    const base = baseResolved();
    base.recipe.audioHandling = "copy";
    const result = applyIntentConstraints(base, "strip audio, keep the .mkv", meta());
    expect(result.recipe.audioHandling).toBe("strip");
    expect(result.recipe.outputContainer).toBe("same");
    expect(result.sources.audioHandling).toBe("you");
    expect(result.sources.outputContainer).toBe("you");
    expect(result.sources.crf).toBe("rule"); // untouched
  });

  it("keeps AI codec decisions when intent is silent on them", () => {
    const base = baseResolved();
    base.recipe.targetCodec = "vp9";
    base.sources.targetCodec = "ai";
    const result = applyIntentConstraints(base, "strip audio", meta());
    expect(result.recipe.targetCodec).toBe("vp9");
    expect(result.sources.targetCodec).toBe("ai");
  });

  it("resolveOutputContainer maps source matroska to mkv", () => {
    const { recipe } = applyIntentConstraints(baseResolved(), "keep the .mkv", meta());
    expect(resolveOutputContainer(recipe, meta())).toBe("mkv");
  });

  it("resolveOutputContainer passes explicit containers through", () => {
    const { recipe } = applyIntentConstraints(baseResolved(), "convert to webm", meta());
    expect(resolveOutputContainer(recipe, meta())).toBe("webm");
  });
});
