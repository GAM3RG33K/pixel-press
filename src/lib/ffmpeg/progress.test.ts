import { describe, expect, it } from "vitest";
import { parseTimeToSeconds, parseProgressLine, percentFromTime } from "./progress";

describe("parseTimeToSeconds", () => {
  it("parses HH:MM:SS.ms correctly", () => {
    expect(parseTimeToSeconds("00:01:23.45")).toBe(83.45);
  });

  it("parses MM:SS.ms correctly", () => {
    expect(parseTimeToSeconds("01:23.5")).toBe(83.5);
  });

  it("returns null for garbage input", () => {
    expect(parseTimeToSeconds("garbage")).toBeNull();
  });

  it("clamps negative time to 0", () => {
    expect(parseTimeToSeconds("-00:00:05.00")).toBe(0);
    expect(parseTimeToSeconds("-01:23.45")).toBe(0);
  });
});

function expectSample(line: string) {
  const r = parseProgressLine(line);
  expect(r).not.toBeNull();
  if (!r) throw new Error("no sample");
  return r;
}

describe("parseProgressLine", () => {
  it("returns null when no time= token", () => {
    expect(parseProgressLine("frame=120")).toBeNull();
    expect(parseProgressLine("fps=24.5")).toBeNull();
  });

  it("returns a ProgressSample with correct fields for a realistic line", () => {
    const line = "frame=  120 fps= 24.5 q=28.0 size=    1024kB time=00:00:12.34 bitrate=1234.5kbits/s speed=1.25x";
    const result = expectSample(line);
    expect(result.timeSeconds).toBe(12.34);
    expect(result.frame).toBe(120);
    expect(result.fps).toBe(24.5);
    expect(result.speed).toBe(1.25);
    expect(result.bitrate).toBe(1234500); // 1234.5kbits/s = 1234.5 * 1000 bits/s
    expect(result.sizeBytes).toBe(1024000); // 1024kB = 1024 * 1000 bytes
    expect(result.raw).toBe(line);
  });

  it("handles N/A values as undefined", () => {
    const line = "time=00:00:00.00 fps=N/A size=  1024kB";
    const result = expectSample(line);
    expect(result.fps).toBeUndefined();
    expect(result.sizeBytes).toBe(1024000);
  });

  it("handles MiB size case", () => {
    const line = "time=00:00:00.00 size=  1MiB";
    const result = expectSample(line);
    expect(result.sizeBytes).toBe(1048576); // 1 MiB = 1024 * 1024 bytes
  });
});

describe("percentFromTime", () => {
  it("returns 25 for 30 seconds out of 120", () => {
    expect(percentFromTime(30, 120)).toBe(25);
  });

  it("clamps >100 to 100", () => {
    expect(percentFromTime(150, 100)).toBe(100);
  });

  it("returns 0 when duration is 0", () => {
    expect(percentFromTime(30, 0)).toBe(0);
  });

  it("returns 0 when duration is negative", () => {
    expect(percentFromTime(30, -10)).toBe(0);
  });

  it("returns 0 when time is not finite", () => {
    expect(percentFromTime(NaN, 100)).toBe(0);
    expect(percentFromTime(30, NaN)).toBe(0);
  });
});
