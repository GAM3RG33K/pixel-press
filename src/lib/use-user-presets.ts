/**
 * Shared hook for Advanced user mode + user presets (idb-keyval backed via settings.ts).
 * Keeps Compress and folder/Optimize views in sync — presets saved in one appear in the other.
 */

import { useCallback, useEffect, useState } from "react";

import {
  loadPreferences,
  savePreferences,
  type UserPreset,
} from "@/lib/settings";
import type { EncodeRecipe, RecipeSources } from "@/lib/ffmpeg/recipe";
import { defaultRecipeSources } from "@/lib/ffmpeg/recipe";

const PRESET_FIELDS: (keyof EncodeRecipe)[] = [
  "targetCodec", "crf", "twoPass", "preserveKeyframes", "targetScale",
  "outputContainer", "audioHandling", "subtitleHandling", "stripMetadata",
  "faststart", "trimStart", "trimEnd",
];

function presetSources(): RecipeSources {
  const sources = defaultRecipeSources();
  for (const field of PRESET_FIELDS) sources[field] = "preset";
  return sources;
}

export function useUserPresets() {
  const [presets, setPresets] = useState<UserPreset[]>([]);
  const [advancedMode, setAdvancedModeState] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadPreferences().then((prefs) => {
      if (cancelled) return;
      setPresets(prefs.presets ?? []);
      setAdvancedModeState(prefs.advancedUserMode ?? false);
    });
    return () => { cancelled = true; };
  }, []);

  const setAdvancedMode = useCallback((value: boolean) => {
    setAdvancedModeState(value);
    void savePreferences({ advancedUserMode: value });
  }, []);

  const applyPreset = useCallback((preset: UserPreset) => {
    return { recipe: { ...preset.recipe }, sources: presetSources() };
  }, []);

  const savePreset = useCallback(async (name: string, recipe: EncodeRecipe): Promise<UserPreset> => {
    const preset: UserPreset = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      recipe: { ...recipe },
    };
    setPresets((current) => {
      const next = [...current, preset];
      void savePreferences({ presets: next });
      return next;
    });
    return preset;
  }, []);

  const deletePreset = useCallback((preset: UserPreset) => {
    setPresets((current) => {
      const next = current.filter((p) => p.id !== preset.id);
      void savePreferences({ presets: next });
      return next;
    });
  }, []);

  return { presets, advancedMode, setAdvancedMode, applyPreset, savePreset, deletePreset };
}
