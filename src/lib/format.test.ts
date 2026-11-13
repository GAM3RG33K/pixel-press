import { describe, expect, it } from "vitest";

import { etaFromProgress, formatRemaining, formatRemainingShort, formatBytes } from "./format";

describe("formatBytes", () => {
  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536 * 1024 * 1024)).toBe("1.5 GB");
  });
});

describe("etaFromProgress", () => {
  it("computes remaining from elapsed and progress", () => {
    const start = Date.now() - 30_000; // 30s elapsed
    const eta = etaFromProgress(start, 25);
    expect(eta).not.toBeNull();
    expect(eta!).toBeGreaterThan(80);
    expect(eta!).toBeLessThan(100);
  });

  it("returns null below 2% progress", () => {
    expect(etaFromProgress(Date.now() - 5000, 0)).toBeNull();
    expect(etaFromProgress(Date.now() - 5000, 1.5)).toBeNull();
  });

  it("returns null at 100% and for invalid inputs", () => {
    expect(etaFromProgress(Date.now() - 5000, 100)).toBeNull();
    expect(etaFromProgress(undefined, 50)).toBeNull();
    expect(etaFromProgress(Date.now(), Number.NaN)).toBeNull();
  });
});

describe("formatRemaining", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatRemaining(42)).toBe("~42s left");
    expect(formatRemaining(185)).toBe("~3m 05s left");
    expect(formatRemaining(3725)).toBe("~1h 02m left");
    expect(formatRemaining(null)).toBe("estimating…");
  });

  it("formats compact variant", () => {
    expect(formatRemainingShort(42)).toBe("~42s");
    expect(formatRemainingShort(185)).toBe("~3m 05s");
    expect(formatRemainingShort(3725)).toBe("~1h 02m");
    expect(formatRemainingShort(null)).toBe("…");
  });
});
