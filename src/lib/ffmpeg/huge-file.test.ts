import { describe, it, expect } from "vitest";
import { isHugeFile } from "./huge-file";

describe("isHugeFile", () => {
  it("flags files larger than 2 GB", () => {
    expect(isHugeFile({ size: 2 * 1024 * 1024 * 1024 + 1 })).toBe(true);
  });
  it("flags files whose ETA at 150 MB/s exceeds 2 minutes", () => {
    expect(isHugeFile({ size: 150e6 * 121 })).toBe(true);
  });
  it("does not flag small files", () => {
    expect(isHugeFile({ size: 100 * 1024 * 1024 })).toBe(false);
  });
  it("hits the ETA boundary exactly", () => {
    expect(isHugeFile({ size: 150e6 * 120 + 1 })).toBe(true);
    expect(isHugeFile({ size: 150e6 * 120 })).toBe(false);
  });
});
