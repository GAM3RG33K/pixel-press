import { describe, expect, it } from "vitest";
import { normalizeOpfsPath, OPFS_MAX_AGE_MS } from "./opfs";

describe("opfs constants", () => {
  it("OPFS_MAX_AGE_MS equals 86400000", () => {
    expect(OPFS_MAX_AGE_MS).toBe(86400000);
  });
});

describe("normalizeOpfsPath", () => {
  it("passes through already-normalized paths", () => {
    expect(normalizeOpfsPath("a/b")).toBe("a/b");
  });

  it("strips leading/trailing and duplicate slashes", () => {
    expect(normalizeOpfsPath("//a//b/")).toBe("a/b");
  });

  it("throws on parent-directory segment", () => {
    expect(() => normalizeOpfsPath("a/../b")).toThrow();
  });

  it("throws on current-directory segment", () => {
    expect(() => normalizeOpfsPath("./a")).toThrow();
  });

  it("throws on backslashes", () => {
    expect(() => normalizeOpfsPath("a\\b")).toThrow();
  });

  it("returns empty string for root path", () => {
    expect(normalizeOpfsPath("/")).toBe("");
  });
});