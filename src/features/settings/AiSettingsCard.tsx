import { useEffect, useState } from "react";
import { BrainCircuit, CheckCircle2, Download, Trash2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  clearPreferences,
  loadPreferences,
  savePreferences,
  type AIMode,
  type UserPreferences,
} from "@/lib/settings";
import { modelManager } from "@/lib/model-manager";
import { cn } from "@/lib/utils";

const PREF_OPTIONS: { id: AIMode; title: string; body: string; badge?: string }[] = [
  {
    id: "rule-engine",
    title: "Instant Rule Mode",
    body: "Zero downloads — the deterministic rule engine picks codec/CRF from metadata. Best for hero loops and batch jobs.",
    badge: "0 MB",
  },
  {
    id: "smollm2-360m",
    title: "SmolLM2-360M (recommended)",
    body: "Small local instruct model (~220 MB). Parses natural-language intent into a validated plan; falls back to rules on failure.",
    badge: "~220 MB · WebGPU",
  },
  {
    id: "qwen2-0.5b",
    title: "Qwen2.5-0.5B (fallback)",
    body: "Stronger instruction following; larger download. For developers who need precision over speed.",
    badge: "~350 MB · WebGPU",
  },
];

export function AiSettingsCard() {
  const [prefs, setPrefs] = useState<UserPreferences>({
    aiMode: 'rule-engine',
    autoStripAudio: true,
    defaultContainer: 'webm',
    onboardingCompleted: true,
  });
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<AIMode>('rule-engine');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    loadPreferences().then((loaded) => {
      setPrefs(loaded);
      setSelected(loaded.aiMode);
    });
  }, []);

  const setMode = async (mode: AIMode) => {
    setSelected(mode);
    setPrefs((current) => ({ ...current, aiMode: mode }));
    await savePreferences({ aiMode: mode });
    setStatus(mode === 'rule-engine' ? 'Rule Mode enabled.' : 'AI model preference saved (download happens on demand).');
    window.setTimeout(() => setStatus(null), 1500);
  };

  const handleCheckModels = async () => {
    setChecking(true);
    setStatus('Checking model cache…');
    const smolState = await modelManager.getModelState('smollm2-360m');
    const qwenState = await modelManager.getModelState('qwen2-0.5b');
    setStatus(`SmolLM2-360M: ${smolState} · Qwen2.5-0.5B: ${qwenState}`);
    setChecking(false);
    window.setTimeout(() => setStatus(null), 2500);
  };

  const handleDeleteCached = async () => {
    setChecking(true);
    await modelManager.deleteModel('smollm2-360m');
    await modelManager.deleteModel('qwen2-0.5b');
    setStatus('Cached model weights removed.');
    setChecking(false);
    window.setTimeout(() => setStatus(null), 2500);
  };

  const handleReset = async () => {
    await clearPreferences();
    setPrefs({
      aiMode: 'rule-engine',
      autoStripAudio: true,
      defaultContainer: 'webm',
      onboardingCompleted: true,
    });
    setSelected('rule-engine');
    setStatus('Preferences reset to defaults.');
    window.setTimeout(() => setStatus(null), 2500);
  };

  return (
    <section
      aria-labelledby="ai-settings"
      className="rounded-xl border border-border bg-card/50 p-4 backdrop-blur"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="ai-settings" className="text-sm font-medium">
            Local AI
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose how the intent bar is interpreted. Rule Mode is instant and needs no download.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Button size="sm" variant="outline" onClick={handleCheckModels} disabled={checking}>
            {checking ? null : <CheckCircle2 className="size-4" aria-hidden />}
            Check cache
          </Button>
          <Button size="sm" variant="outline" onClick={handleDeleteCached} disabled={checking}>
            <Trash2 className="size-4" aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleReset}>
            Reset
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {PREF_OPTIONS.map((option) => {
          const active = selected === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setMode(option.id)}
              aria-pressed={active}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                active
                  ? "border-primary/60 bg-primary/10"
                  : "border-border bg-background/40 hover:border-primary/30",
              )}
            >
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                {option.id === 'rule-engine' ? (
                  <Zap className="size-3.5 text-warning" aria-hidden />
                ) : (
                  <BrainCircuit className="size-3.5 text-info" aria-hidden />
                )}
                {option.title}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{option.body}</p>
              <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-border bg-card/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                <Download className="size-3" aria-hidden />
                {option.badge}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", prefs.aiMode === 'rule-engine' ? "bg-success" : "bg-info")} aria-hidden />
        Active: {PREF_OPTIONS.find((o) => o.id === prefs.aiMode)?.title}
        <span className="ml-auto hidden sm:inline">
          Auto-strip audio preference: {prefs.autoStripAudio ? 'on' : 'off'}
        </span>
      </div>

      {status ? (
        <p className="mt-2 text-[11px] text-muted-foreground" role="status">{status}</p>
      ) : null}
    </section>
  );
}