/**
 * Persistent user preferences via IndexedDB (idb-keyval).
 *
 * Stores only non-sensitive UI prefs — never video bytes or file names
 * from user projects. Keys are namespaced under "pixel-press:*".
 */

import { createStore, get, set, del } from "idb-keyval";

export type AIMode = 'rule-engine' | 'smollm2-360m' | 'qwen2-0.5b';

export interface UserPreset {
  id: string;
  name: string;
  /** ISO-8601 creation time. */
  createdAt: string;
  /** Full recipe snapshot — applying a preset is a bundle of hand-edits. */
  recipe: import('./ffmpeg/recipe').EncodeRecipe;
}

export interface UserPreferences {
  aiMode: AIMode;
  autoStripAudio: boolean;
  defaultContainer: 'mp4' | 'webm';
  onboardingCompleted: boolean;
  /** Plan-review table rows are editable only when true. Default OFF = strictly read-only. */
  advancedUserMode: boolean;
  /** User-saved recipe presets (advanced mode). */
  presets: UserPreset[];
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  aiMode: 'rule-engine',
  autoStripAudio: true,
  defaultContainer: 'webm',
  onboardingCompleted: false,
  advancedUserMode: false,
  presets: [],
};

const store = createStore('pixel-press', 'settings');
const KEY = 'pixel-press:preferences:v1';

function notifyPreferencesChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent('pixel-press:preferences-changed'));
  } catch {
    // best effort — SSR/tests
  }
}

export async function loadPreferences(): Promise<UserPreferences> {
  try {
    const saved = await get<Partial<UserPreferences>>(KEY, store);
    return { ...DEFAULT_PREFERENCES, ...(saved ?? {}) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export async function savePreferences(
  prefs: Partial<UserPreferences>,
): Promise<void> {
  try {
    const current = await loadPreferences();
    await set(KEY, { ...current, ...prefs }, store);
    notifyPreferencesChanged();
  } catch {
    // IndexedDB unavailable — prefs simply won't persist this session
  }
}

export async function markOnboardingDone(): Promise<void> {
  await savePreferences({ onboardingCompleted: true });
}

export async function clearPreferences(): Promise<void> {
  try {
    await del(KEY, store);
  } catch {
    // best effort
  }
}