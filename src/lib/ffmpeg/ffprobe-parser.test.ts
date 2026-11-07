import { describe, expect, it } from "vitest";
import { parseFfprobeJson } from "./ffprobe-parser";

const realisticH264AACMP4 = JSON.stringify({
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1920,
      height: 1080,
      avg_frame_rate: "30000/1001",
      pix_fmt: "yuv420p",
      bit_rate: "5000000",
    },
    {
      codec_type: "audio",
      codec_name: "aac",
    },
  ],
  format: {
    format_name: "mov,mp4,m4a,3gp,3g2,mj2",
    duration: "12.5",
    bit_rate: "5200000",
    size: "8125000",
  },
});

const noVideoAudioOnly = JSON.stringify({
  streams: [
    {
      codec_type: "audio",
      codec_name: "aac",
    },
  ],
  format: {},
});

const badJSON = "not valid json {{{";

describe("parseFfprobeJson", () => {
  it("parses a realistic H.264 + AAC MP4 JSON", () => {
    const result = parseFfprobeJson(
      realisticH264AACMP4,
      "test.mp4",
      8125000,
    );

    expect(result.fileName).toBe("test.mp4");
    expect(result.fileSize).toBe(8125000);
    expect(result.duration).toBeCloseTo(12.5);
    expect(result.videoCodec).toBe("h264");
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.fps).toBeCloseTo(29.97, 2);
    expect(result.container).toContain("mp4");
    expect(result.hasAudio).toBe(true);
    expect(result.audioCodec).toBe("aac");
  });

  it("missing audio stream -> hasAudio false, audioCodec undefined", () => {
    const result = parseFfprobeJson(
      JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
          },
        ],
        format: {},
      }),
      "test.mp4",
      0,
    );

    expect(result.hasAudio).toBe(false);
    expect(result.audioCodec).toBeUndefined();
  });

  it("uses video.duration when format.duration absent", () => {
    const result = parseFfprobeJson(
      JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            duration: "10.0",
          },
        ],
        format: {},
      }),
      "test.mp4",
      0,
    );

    expect(result.duration).toBe(10.0);
  });

  it("falls back to r_frame_rate when avg_frame_rate is 0/0", () => {
    const result = parseFfprobeJson(
      JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            avg_frame_rate: "0/0",
            r_frame_rate: "30000/1001",
          },
        ],
        format: {},
      }),
      "test.mp4",
      0,
    );

    expect(result.fps).toBeCloseTo(29.97, 2);
  });

  it("throws No video stream found when streams has only audio", () => {
    expect(() =>
      parseFfprobeJson(noVideoAudioOnly, "test.mp4", 0),
    ).toThrow("No video stream found");
  });

  it("throws ffprobe returned invalid JSON on bad JSON", () => {
    expect(() => parseFfprobeJson(badJSON, "test.mp4", 0)).toThrow(
      "ffprobe returned invalid JSON",
    );
  });

  it("fileSize argument 0 falls back to format.size", () => {
    const result = parseFfprobeJson(
      JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
          },
        ],
        format: {
          size: "4200000",
        },
      }),
      "test.mp4",
      0,
    );

    expect(result.fileSize).toBe(4200000);
  });

  it("a generated id starts with video- and is non-empty", () => {
    const result = parseFfprobeJson(
      JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
          },
        ],
        format: {},
      }),
      "test.mp4",
      0,
    );

    expect(result.id.startsWith("video-")).toBe(true);
    expect(result.id.length).toBeGreaterThan(0);
  });
});