import { describe, it, expect } from "vitest";
import { parseSsim } from "./ssim";

describe("parseSsim", () => {
  describe("full FFmpeg line", () => {
    it("parses SSIM Y, U, V, all, and allDb with parenthesised dB", () => {
      const output =
        "[Parsed_ssim_0 @ 0x123] SSIM Y:0.988906 (19.549) U:0.993456 (21.838) V:0.993479 (21.853) All:0.990522 (19.979)";
      const result = parseSsim(output);
      expect(result).not.toBeNull();
      expect(result).toEqual({
        all: 0.990522,
        allDb: 19.979,
        y: 0.988906,
        u: 0.993456,
        v: 0.993479,
      });
    });
  });

  describe("line without parenthesised dB", () => {
    it("computes allDb via 10*log10(all/(1-all))", () => {
      const output = "SSIM Y:0.99 U:0.98 V:0.97 All:0.985";
      const result = parseSsim(output);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty("all", 0.985);
      // 10 * log10(0.985 / 0.015) ≈ 18.187
      expect(result!.allDb).toBeCloseTo(18.173, 3);
      expect(result).toHaveProperty("y", 0.99);
      expect(result).toHaveProperty("u", 0.98);
      expect(result).toHaveProperty("v", 0.97);
    });
  });

  describe("array of log lines", () => {
    it("finds the SSIM line among unrelated lines", () => {
      const output = [
        "some unrelated line",
        "[Parsed_ssim_0 @ 0x123] SSIM Y:0.988906 (19.549) U:0.993456 (21.838) V:0.993479 (21.853) All:0.990522 (19.979)",
        "another unrelated line",
      ];
      const result = parseSsim(output);
      expect(result).not.toBeNull();
      expect(result!.all).toBeCloseTo(0.990522, 6);
    });
  });

  describe("no SSIM summary", () => {
    it("returns null when no SSIM summary is present", () => {
      const output = ["unrelated line 1", "unrelated line 2"];
      const result = parseSsim(output);
      expect(result).toBeNull();
    });
  });

  describe("All:1 behavior", () => {
    it("yields all=1 and allDb=Infinity instead of null", () => {
      const output = "SSIM Y:1 U:1 V:1 All:1";
      const result = parseSsim(output);
      expect(result).not.toBeNull();
      expect(result).toEqual({
        all: 1,
        allDb: Infinity,
        y: 1,
        u: 1,
        v: 1,
      });
    });
  });

  describe("multiple SSIM lines", () => {
    it("returns the LAST one", () => {
      const output = [
        "[Parsed_ssim_0 @ 0x1] SSIM Y:0.5 U:0.5 V:0.5 All:0.5 (5.0)",
        "[Parsed_ssim_1 @ 0x2] SSIM Y:0.8 U:0.8 V:0.8 All:0.8 (1.0)",
      ];
      const result = parseSsim(output);
      expect(result).not.toBeNull();
      expect(result?.all).toBeCloseTo(0.8, 1);
      expect(result?.allDb).toBeCloseTo(1.0, 1);
    });
  });

  describe("clamping values", () => {
    it("clamps All:1.5 to all===1", () => {
      const output = "SSIM Y:1.5 U:1.5 V:1.5 All:1.5";
      const result = parseSsim(output);
      expect(result).not.toBeNull();
      expect(result?.all).toBe(1);
      // allDb: since all=1, ssimToDb(1) = Infinity
      expect(result?.allDb).toBe(Infinity);
    });

    it("clamps channel values exceeding 1", () => {
      const output = "SSIM Y:1.2 U:0.8 V:0.7 All:0.9";
      const result = parseSsim(output);
      expect(result).not.toBeNull();
      expect(result?.y).toBe(1);
      expect(result?.u).toBe(0.8);
      expect(result?.v).toBe(0.7);
    });
  });

  describe("CRLF line endings", () => {
    it("handles Windows CRLF line endings", () => {
      const output =
        "[Parsed_ssim_0 @ 0x123] SSIM Y:0.988906 (19.549) U:0.993456 (21.838) V:0.993479 (21.853) All:0.990522 (19.979)\r\n";
      const result = parseSsim(output);
      expect(result).not.toBeNull();
      expect(result?.all).toBeCloseTo(0.990522, 6);
    });
  });
});