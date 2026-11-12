import { describe, expect, it } from "vitest";

import { buildImportPreview, CONFIG_SCHEMA_VERSION } from "./config-backup";
import { DEFAULT_PREFERENCES, type UserPreferences } from "./settings";
import type { EncodeRecipe } from "./ffmpeg/recipe";

const recipe = (overrides: Partial<EncodeRecipe> = {}): EncodeRecipe => ({
  targetCodec: "h264",
  crf: 26,
  outputContainer: "same",
  audioHandling: "copy",
  subtitleHandling: { mode: "copy" },
  stripMetadata: false,
  faststart: true,
  ...overrides,
});

const prefs = (overrides: Partial<UserPreferences> = {}): UserPreferences => ({
  ...DEFAULT_PREFERENCES,
  presets: [],
  ...overrides,
});

const doc = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: CONFIG_SCHEMA_VERSION,
  app: "pixel-press",
  exportedAt: "2026-11-12T00:00:00.000Z",
  preferences: {
    aiMode: "smollm2-360m",
    autoStripAudio: false,
    defaultContainer: "mp4",
    onboardingCompleted: true,
    advancedUserMode: true,
    presets: [
      { id: "p1", name: "Archival MKV", createdAt: "2026-11-12T00:00:00.000Z", recipe: recipe() },
    ],
  },
  ...overrides,
});

describe("buildImportPreview", () => {
  it("rejects non-pixel-press JSON", () => {
    expect(buildImportPreview(null, prefs()).ok).toBe(false);
    expect(buildImportPreview({ schemaVersion: 1, app: "other-app" }, prefs()).ok).toBe(false);
    expect(buildImportPreview({ schemaVersion: 99, app: "pixel-press" }, prefs()).ok).toBe(false);
  });

  it("imports scalars and presets cleanly", () => {
    const preview = buildImportPreview(doc(), prefs());
    expect(preview.ok).toBe(true);
    expect(preview.preferencesToApply).toMatchObject({ aiMode: "smollm2-360m", advancedUserMode: true, defaultContainer: "mp4" });
    expect(preview.presetsToAdd).toHaveLength(1);
    expect(preview.renamedPresets).toEqual([]);
    expect(preview.noop).toBe(false);
  });

  it("renames colliding presets on import", () => {
    const existing = prefs({
      presets: [{ id: "x", name: "Archival MKV", createdAt: "2026-01-01T00:00:00.000Z", recipe: recipe() }],
    });
    const preview = buildImportPreview(doc(), existing);
    expect(preview.presetsToAdd[0]?.name).toBe("Archival MKV (imported)");
    expect(preview.renamedPresets.length).toBe(1);
  });

  it("skips malformed presets but keeps valid ones", () => {
    const raw = doc();
    (raw.preferences.presets as unknown[]).push({ name: "", recipe: null }, { name: "Broken", recipe: { targetCodec: "vp9", crf: "high" } });
    const preview = buildImportPreview(raw, prefs());
    expect(preview.presetsToAdd.map((p) => p.name)).toEqual(["Archival MKV"]);
  });

  it("ignores unknown/invalid scalar values", () => {
    const raw = doc();
    (raw.preferences as Record<string, unknown>)["aiMode"] = "gpt-9000";
    (raw.preferences as Record<string, unknown>)["defaultContainer"] = "avi";
    const preview = buildImportPreview(raw, prefs());
    expect(preview.preferencesToApply.aiMode).toBeUndefined();
    expect(preview.preferencesToApply.defaultContainer).toBeUndefined();
  });

  it("reports noop when nothing would change", () => {
    const raw = doc({
      preferences: { aiMode: "rule-engine", presets: [] },
    });
    const preview = buildImportPreview(raw, prefs());
    expect(preview.noop).toBe(true);
  });
});
