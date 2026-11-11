import { describe, expect, it } from "vitest";
import { compareReleaseTags, isUpdateAvailable } from "./release";

describe("compareReleaseTags", () => {
  it("orders patch versions", () => {
    expect(compareReleaseTags("v0.1.0", "v0.1.1")).toBe(-1);
    expect(compareReleaseTags("v0.1.1", "v0.1.0")).toBe(1);
  });
  it("treats equal tags as equal", () => {
    expect(compareReleaseTags("v0.1.0", "v0.1.0")).toBe(0);
    expect(compareReleaseTags("v0.1.1", "v0.1.1")).toBe(0);
  });
  it("ranks a dev prerelease below the release", () => {
    expect(compareReleaseTags("v0.1.1-dev", "v0.1.1")).toBe(-1);
  });
  it("orders dev prereleases by numbers", () => {
    expect(compareReleaseTags("v0.1.1-dev", "v0.1.2-dev")).toBe(-1);
  });
});

describe("isUpdateAvailable", () => {
  it("is true when latest is newer", () => {
    expect(isUpdateAvailable("0.1.0", "0.1.1")).toBe(true);
  });
  it("is true when a dev build can move to the release", () => {
    expect(isUpdateAvailable("0.1.1-dev", "0.1.1")).toBe(true);
  });
  it("is false when running is newer or equal", () => {
    expect(isUpdateAvailable("0.1.2", "0.1.1")).toBe(false);
    expect(isUpdateAvailable("0.1.1", "0.1.1")).toBe(false);
  });
});
