/**
 * Backup & restore — export/import the entire user config as one versioned
 * JSON file (`pixel-press-config.json`, `schemaVersion: 1`).
 *
 * Included: AI/engine prefs, Advanced user mode flag, cache/update-relevant
 * prefs, and user presets. Excluded: model weights (re-downloadable),
 * diagnostics logs, encode history, machine-local paths.
 *
 * Import never destroys data:
 *  - preset name collisions are auto-renamed (`name (imported)`, `name (imported 2)`…)
 *  - other settings are replaced only after the caller confirms the preview diff
 */

import {
  loadPreferences,
  savePreferences,
  type AIMode,
  type UserPreferences,
  type UserPreset,
} from "./settings";

export const CONFIG_SCHEMA_VERSION = 1;
export const CONFIG_FILE_NAME = "pixel-press-config.json";

export interface ConfigFile {
  schemaVersion: number;
  exportedAt: string;
  app: "pixel-press";
  preferences: Omit<UserPreferences, "presets"> & { presets: UserPreset[] };
}

export interface ImportPreview {
  ok: boolean;
  error?: string;
  /** Presets that will be added (already collision-renamed). */
  presetsToAdd: UserPreset[];
  /** Scalar preferences that will be replaced. */
  preferencesToApply: Partial<Omit<UserPreferences, "presets">>;
  /** Human-readable rename notes for the UI ("My preset → My preset (imported)"). */
  renamedPresets: string[];
  /** True when nothing at all would change. */
  noop: boolean;
}

const AI_MODES: AIMode[] = ["rule-engine", "smollm2-360m", "qwen2-0.5b"];
const CONTAINERS = new Set(["mp4", "webm"]);

function sanitizePreset(raw: unknown): UserPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<UserPreset>;
  if (typeof p.name !== "string" || p.name.trim().length === 0) return null;
  if (!p.recipe || typeof p.recipe !== "object") return null;
  const recipe = p.recipe as unknown as Record<string, unknown>;
  if (!["h264", "h265", "vp9", "av1"].includes(String(recipe["targetCodec"]))) return null;
  const crf = Number(recipe["crf"]);
  if (!Number.isFinite(crf)) return null;
  return {
    id: typeof p.id === "string" && p.id ? p.id : `preset-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: p.name.trim().slice(0, 80),
    createdAt: typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString(),
    recipe: { ...(recipe as unknown as UserPreset["recipe"]), crf: Math.min(51, Math.max(0, crf)) },
  };
}

/** Build a non-destructive import preview against the current preferences. Pure — does not persist. */
export function buildImportPreview(raw: unknown, existing: UserPreferences): ImportPreview {
  const fail = (error: string): ImportPreview => ({
    ok: false,
    error,
    presetsToAdd: [],
    preferencesToApply: {},
    renamedPresets: [],
    noop: true,
  });

  if (!raw || typeof raw !== "object") return fail("Not a JSON object — expected a pixel-press config file.");
  const doc = raw as Partial<ConfigFile>;
  if (doc.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    return fail(`Unsupported schemaVersion ${String(doc.schemaVersion)} — expected ${CONFIG_SCHEMA_VERSION}.`);
  }
  if (doc.app !== "pixel-press") {
    return fail("This JSON was not exported from pixel-press.");
  }
  const prefs = doc.preferences;
  if (!prefs || typeof prefs !== "object") return fail("Missing `preferences` in config file.");

  // Scalar prefs — accept known-good values, but only surface ones that differ
  // from what is already stored (import preview = honest diff).
  const preferencesToApply: Partial<Omit<UserPreferences, "presets">> = {};
  const scalars: Partial<Omit<UserPreferences, "presets">> = {};
  if (typeof prefs.aiMode === "string" && AI_MODES.includes(prefs.aiMode as AIMode)) {
    scalars.aiMode = prefs.aiMode as AIMode;
  }
  if (typeof prefs.autoStripAudio === "boolean") scalars.autoStripAudio = prefs.autoStripAudio;
  if (typeof prefs.defaultContainer === "string" && CONTAINERS.has(prefs.defaultContainer)) {
    scalars.defaultContainer = prefs.defaultContainer as "mp4" | "webm";
  }
  if (typeof prefs.onboardingCompleted === "boolean") scalars.onboardingCompleted = prefs.onboardingCompleted;
  if (typeof prefs.advancedUserMode === "boolean") scalars.advancedUserMode = prefs.advancedUserMode;
  for (const [key, value] of Object.entries(scalars) as [keyof typeof scalars, unknown][]) {
    if (existing[key] !== value) {
      (preferencesToApply as Record<string, unknown>)[key] = value;
    }
  }

  // Presets — sanitize, then collision-rename against existing names.
  const rawPresets = Array.isArray(prefs.presets) ? prefs.presets : [];
  const existingNames = new Set(existing.presets.map((p) => p.name.toLowerCase()));
  const taken = new Set(existingNames);
  const presetsToAdd: UserPreset[] = [];
  const renamedPresets: string[] = [];
  for (const rawPreset of rawPresets) {
    const preset = sanitizePreset(rawPreset);
    if (!preset) continue;
    let name = preset.name;
    if (taken.has(name.toLowerCase())) {
      const original = name;
      let candidate = `${original} (imported)`;
      let n = 2;
      while (taken.has(candidate.toLowerCase())) {
        candidate = `${original} (imported ${n})`;
        n += 1;
      }
      name = candidate;
      renamedPresets.push(`${original} → ${candidate}`);
    }
    taken.add(name.toLowerCase());
    presetsToAdd.push({ ...preset, name });
  }

  const noop = presetsToAdd.length === 0 && Object.keys(preferencesToApply).length === 0;
  return { ok: true, presetsToAdd, preferencesToApply, renamedPresets, noop };
}

/** Serialize current preferences as pretty JSON for download. */
export async function exportConfigJson(): Promise<string> {
  const prefs = await loadPreferences();
  const doc: ConfigFile = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    app: "pixel-press",
    preferences: prefs,
  };
  return JSON.stringify(doc, null, 2);
}

/** Parse + preview an imported file. Does NOT persist anything. */
export async function previewImportJson(json: string): Promise<ImportPreview> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return {
      ok: false,
      error: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      presetsToAdd: [],
      preferencesToApply: {},
      renamedPresets: [],
      noop: true,
    };
  }
  const existing = await loadPreferences();
  return buildImportPreview(raw, existing);
}

/** Persist an approved import preview. */
export async function applyImportPreview(preview: ImportPreview): Promise<void> {
  if (!preview.ok) return;
  const existing = await loadPreferences();
  const merged: UserPreferences = {
    ...existing,
    ...preview.preferencesToApply,
    presets: [...existing.presets, ...preview.presetsToAdd],
  };
  await savePreferences(merged);
}
