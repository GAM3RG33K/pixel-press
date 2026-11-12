import { describe, it, expect } from "vitest";
import { isHugeFile } from "./huge-file";

describe("isHugeFile", () => {
  it("flags files larger than 500 MB", () => {
    expect(isHugeFile({ size: 500 * 1024 * 1024 + 1 })).toBe(true);
  });
  it("flags files whose ETA at 150 MB/s exceeds 1 minute", () => {
    expect(isHugeFile({ size: 150e6 * 61 })).toBe(true);
  });
  it("does not flag small files", () => {
    expect(isHugeFile({ size: 100 * 1024 * 1024 })).toBe(false);
  });
  it("respects the exact 500 MB size boundary", () => {
    expect(isHugeFile({ size: 500 * 1024 * 1024 })).toBe(false);
    expect(isHugeFile({ size: 500 * 1024 * 1024 + 1 })).toBe(true);
  });
});
