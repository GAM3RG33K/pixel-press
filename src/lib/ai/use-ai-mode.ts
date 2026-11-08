import { useEffect, useState } from "react";

import { loadPreferences, type AIMode } from "@/lib/settings";

/**
 * Subscribes to the current AI mode from settings.
 * Returns the current mode; call `refresh` to re-read after a settings change.
 */
export function useAiMode(): AIMode {
  const [mode, setMode] = useState<AIMode>('rule-engine');

  useEffect(() => {
    let cancelled = false;
    loadPreferences().then((prefs) => {
      if (!cancelled) setMode(prefs.aiMode);
    });

    const onStorage = () => {
      loadPreferences().then((prefs) => {
        if (!cancelled) setMode(prefs.aiMode);
      });
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('pixel-press:preferences-changed', onStorage);

    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pixel-press:preferences-changed', onStorage);
    };
  }, []);

  return mode;
}