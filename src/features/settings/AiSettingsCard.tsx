import { useEffect, useState } from "react";
import { BrainCircuit, CheckCircle2, Download, Loader2, Trash2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  clearPreferences,
  loadPreferences,
  savePreferences,
  type AIMode,
  type UserPreferences,
} from "@/lib/settings";
import { downloadModel, isModelCached, deleteModelFromCache } from "@/lib/ai/webllm";
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
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [modelCached, setModelCached] = useState<{ smollm2?: boolean; qwen2?: boolean }>({});

  useEffect(() => {
    loadPreferences().then((loaded) => {
      setPrefs(loaded);
      setSelected(loaded.aiMode);
    });
    refreshCacheStates();
  }, []);

  const modelCachedFor = (mode: AIMode): boolean =>
    mode === 'smollm2-360m' ? Boolean(modelCached.smollm2) : mode === 'qwen2-0.5b' ? Boolean(modelCached.qwen2) : false;

  const refreshCacheStates = async () => {
    const [smol, qwen] = await Promise.all([
      isModelCached('smollm2-360m'),
      isModelCached('qwen2-0.5b'),
    ]);
    setModelCached({ smollm2: smol, qwen2: qwen });
  };

  const setMode = async (mode: AIMode) => {
    setSelected(mode);
    setPrefs((current) => ({ ...current, aiMode: mode }));
    await savePreferences({ aiMode: mode });
    setStatus(mode === 'rule-engine' ? 'Rule Mode enabled.' : 'AI model preference saved (download happens on demand).');
    window.setTimeout(() => setStatus(null), 1500);
    if (mode !== 'rule-engine') {
      void refreshCacheStates();
    }
  };

  const handleCheckModels = async () => {
    setChecking(true);
    setStatus('Checking WebLLM cache…');
    const smol = await isModelCached('smollm2-360m');
    const qwen = await isModelCached('qwen2-0.5b');
    setModelCached({ smollm2: smol, qwen2: qwen });
    setStatus(`SmolLM2-360M: ${smol ? 'cached' : 'not cached'} · Qwen2.5-0.5B: ${qwen ? 'cached' : 'not cached'}`);
    setChecking(false);
    window.setTimeout(() => setStatus(null), 2500);
  };

  const handleDeleteCached = async () => {
    setIsDeleting(true);
    setStatus('Deleting cached models…');
    const okSmol = await deleteModelFromCache('smollm2-360m');
    const okQwen = await deleteModelFromCache('qwen2-0.5b');
    setModelCached({ smollm2: !okSmol ? (modelCached.smollm2 ?? true) : false, qwen2: !okQwen ? (modelCached.qwen2 ?? true) : false });
    setStatus(`Removed: ${[okSmol ? 'SmolLM2' : null, okQwen ? 'Qwen2.5' : null].filter(Boolean).join(' · ')}`.trim() || 'Model cache clear done.');
    setIsDeleting(false);
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

      {selected !== 'rule-engine' ? (
        <div className={cn(
          "mt-3 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-[11px]",
          modelCachedFor(selected)
            ? "border-success/30 bg-success/5 text-success"
            : "border-warning/30 bg-warning/5 text-warning",
        )}>
          <span className="font-medium">
            {modelCachedFor(selected)
              ? "Model cached and ready."
              : "Model not downloaded yet."}
          </span>
          {modelCachedFor(selected) ? (
            <>
              <span className="text-[11px] opacity-90">WebLLM verified in cache.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  setIsDeleting(true);
                  const ok = await deleteModelFromCache(selected as 'smollm2-360m' | 'qwen2-0.5b');
                  await refreshCacheStates();
                  setStatus(ok ? 'Model removed from cache.' : 'Could not delete model.');
                  setIsDeleting(false);
                  window.setTimeout(() => setStatus(null), 2000);
                }}
                disabled={isDeleting}
              >
                {isDeleting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
                Remove model
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                setIsDownloading(true);
                setStatus('Downloading model to browser cache…');
                setDownloadProgress(0);
                const result = await downloadModel(selected as 'smollm2-360m' | 'qwen2-0.5b', ({ progress, text }) => {
                  setDownloadProgress(progress);
                  setStatus(text);
                });
                setIsDownloading(false);
                setDownloadProgress(null);
                if (result.ok) {
                  await refreshCacheStates();
                  setStatus('Model cached and ready.');
                } else {
                  setStatus(`Download failed: ${result.error ?? 'unknown error'}`);
                }
                window.setTimeout(() => setStatus(null), 2500);
              }}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              {isDownloading
                ? downloadProgress !== null
                  ? `Downloading… ${Math.round(downloadProgress * 100)}%`
                  : 'Starting download…'
                : `Download ${PREF_OPTIONS.find((o) => o.id === selected)?.title.split(' ')[0] ?? 'model'}`}
            </Button>
          )}
        </div>
      ) : null}

      {downloadProgress !== null ? (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${Math.round(downloadProgress * 100)}%` }}
          />
        </div>
      ) : null}

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