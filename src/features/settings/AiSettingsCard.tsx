import { useEffect, useState } from "react";
import { BrainCircuit, Download, Loader2, Trash2, Zap } from "lucide-react";
import { listen } from "@tauri-apps/api/event";

import { Button } from "@/components/ui/button";
import {
  clearPreferences,
  loadPreferences,
  savePreferences,
  type AIMode,
  type UserPreferences,
} from "@/lib/settings";
import { isTauri, listLlmCandidates, downloadLlm, checkLlm, planWithNativeLlm, type LlmCandidate } from "@/lib/tauri";
import { downloadModel, isModelCached, deleteModelFromCache } from "@/lib/ai/webllm";
import { cn } from "@/lib/utils";
import { registerTask, completeTask, failTask, updateTask } from "@/lib/tasks/registry";

const PREF_OPTIONS: { id: AIMode; title: string; body: string; badge?: string }[] = [
  {
    id: "rule-engine",
    title: "Instant Rule Mode",
    body: "Zero downloads — deterministic rule engine picks codec/CRF from metadata. Best for hero loops and batch jobs.",
    badge: "0 MB",
  },
  {
    id: "smollm2-360m",
    title: "SmolLM2-360M (recommended)",
    body: "Small local instruct model (~270 MB). Parses natural-language intent into a validated plan.",
    badge: "~270 MB",
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
  const [llmReady, setLlmReady] = useState<boolean | null>(null);
  const [llmSpec, setLlmSpec] = useState<LlmCandidate | null>(null);
  const [isInferring, setIsInferring] = useState(false);
  const [inferencePlan, setInferencePlan] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");

  useEffect(() => {
    loadPreferences().then((loaded) => {
      setPrefs(loaded);
      setSelected(loaded.aiMode);
    });
    refresh();
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      listen<[string, number]>("download-progress", (event) => {
        if (event.payload[0] === "llm:smollm2-360m") {
          setDownloadProgress(event.payload[1]);
        }
      }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    }
    return () => { unlisten?.(); };
  }, []);

  const refresh = async () => {
    if (isTauri()) {
      try {
        const models = await listLlmCandidates();
        const smollm = models.find((m) => m.id === 'smollm2-360m');
        if (smollm) setLlmSpec(smollm);
        const stat = await checkLlm('smollm2-360m');
        setLlmReady(stat.ready);
      } catch {
        setLlmReady(null);
      }
    } else {
      setLlmReady(await isModelCached('smollm2-360m'));
    }
  };

  const setMode = async (mode: AIMode) => {
    setSelected(mode);
    setPrefs((current) => ({ ...current, aiMode: mode }));
    await savePreferences({ aiMode: mode });
    setStatus(mode === 'rule-engine' ? 'Rule Mode enabled.' : 'AI model preference saved.');
    window.setTimeout(() => setStatus(null), 1500);
  };

  const handleDownload = async () => {
    if (isTauri() && llmSpec) {
      setIsDownloading(true);
      setStatus('Downloading model…');
      setDownloadProgress(0);
      const taskId = registerTask({
        workbench: "ai",
        label: "Local AI · SmolLM2-360M",
        stage: "Downloading model…",
        progress: null,
        cancel: null,
      });
      try {
        await downloadLlm(llmSpec.id, { url: llmSpec.url, sha256: llmSpec.sha256 });
        await refresh();
        completeTask(taskId);
        setStatus('Model cached and ready.');
      } catch (e) {
        failTask(taskId, e instanceof Error ? e.message : String(e));
        setStatus(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
        setIsDownloading(false);
        setDownloadProgress(null);
        return; // keep the error visible; do not auto-clear
      }
      setIsDownloading(false);
      setDownloadProgress(null);
      window.setTimeout(() => setStatus(null), 2500);
      return;
    }

    // Fallback: WebLLM path (web-only build)
    setIsDownloading(true);
    setStatus('Downloading model…');
    const taskId = registerTask({
      workbench: "ai",
      label: "Local AI · WebLLM model",
      stage: "Downloading model…",
      progress: null,
      cancel: null,
    });
    try {
      const result = await downloadModel('smollm2-360m', ({ progress, text }) => {
        setDownloadProgress(progress);
        updateTask(taskId, { progress, stage: text ?? `Downloading model · ${progress}%` });
      });
      await refresh();
      if (result.ok) completeTask(taskId); else failTask(taskId, result.error ?? 'unknown error');
      setStatus(result.ok ? 'Model cached and ready.' : `Download failed: ${result.error ?? 'unknown error'}`);
    } catch (e) {
      failTask(taskId, e instanceof Error ? e.message : String(e));
      setStatus(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsDownloading(false);
      setDownloadProgress(null);
      window.setTimeout(() => setStatus(null), 2500);
    }
  };

  const handleDelete = async () => {
    if (isTauri() && llmSpec) {
      const mod = await import("@tauri-apps/api/core");
      const modelPath = `${(await mod.invoke<string>("get_app_config_dir"))}/models/smollm2-360m.gguf`;
      const ok = await mod.invoke<boolean>("remove_file", { path: modelPath }).catch(() => false);
      setStatus(ok ? 'Model removed.' : 'Could not delete model.');
      await refresh();
    } else {
      await deleteModelFromCache('smollm2-360m');
      setStatus('Model removed.');
      await refresh();
    }
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

  const showModelPanel = selected !== 'rule-engine';
  const totalBytes = llmSpec?.size_bytes ?? 270590880;
  const readyLabel = llmReady === true ? 'Model cached and ready.' : llmReady === false ? 'Model not downloaded yet.' : 'Checking…';

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
            Choose how intent is interpreted. Rule Mode needs no download.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={handleReset}>
          Reset
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                {option.id === 'rule-engine'
                  ? <Zap className="size-3.5 text-warning" aria-hidden />
                  : <BrainCircuit className="size-3.5 text-info" aria-hidden />}
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

      {showModelPanel ? (
        <div className={cn(
          "mt-3 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-[11px]",
          llmReady ? "border-success/30 bg-success/5 text-success" : "border-warning/30 bg-warning/5 text-warning",
        )}>
          <span className="font-medium">{readyLabel}</span>
          {llmReady ? (
            <>
              <span className="opacity-90">{llmSpec?.source_url ?? 'Model on disk.'}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  setIsInferring(true);
                  setInferencePlan(null);
                  setStreamText("");
                  setStatus(null);
                  try {
                    const plan = await planWithNativeLlm({
                      id: "test-1",
                      fileName: "sample.mp4",
                      fileSize: 1024 * 1024 * 50,
                      duration: 30,
                      container: "mp4",
                      videoCodec: "h264",
                      width: 1280,
                      height: 720,
                      fps: 30,
                      bitrate: 4_000_000,
                      pixelFormat: "yuv420p",
                      hasAudio: true,
                    }, "compress for web", (piece) => {
                      setStreamText((prev) => prev + piece);
                    });
                    setInferencePlan(JSON.stringify(plan, null, 2));
                  } catch (e) {
                    setStatus(`Inference failed: ${e instanceof Error ? e.message : String(e)}`);
                  } finally {
                    setIsInferring(false);
                  }
                }}
                disabled={!llmReady || isInferring}
              >
                {isInferring ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Running inference…
                  </>
                ) : (
                  'Try inference'
                )}
              </Button>
            <Button size="sm" variant="outline" onClick={handleDelete}>
                <Trash2 className="size-4" aria-hidden />
                Remove
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={handleDownload} disabled={isDownloading}>
              {isDownloading
                ? <Loader2 className="size-4 animate-spin" aria-hidden />
                : <Download className="size-4" aria-hidden />}
              {isDownloading
                ? downloadProgress !== null
                  ? `Downloading… ${Math.round((downloadProgress / totalBytes) * 100)}%`
                  : 'Starting download…'
                : `Download ${Math.round(totalBytes / 1024 / 1024)} MB`}
            </Button>
          )}
        </div>
      ) : null}

      {isInferring ? (
        <div className="mt-2 rounded-lg border border-border bg-background/60 p-2">
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Live model output
          </p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-muted-foreground">
            {streamText || "…"}
          </pre>
        </div>
      ) : null}

      {inferencePlan ? (
        <div className="mt-2 rounded-lg border border-border bg-background/60 p-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            LLM proposed plan
          </p>
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-foreground">
            {inferencePlan}
          </pre>
        </div>
      ) : null}

      {isDownloading && downloadProgress !== null ? (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${Math.min(100, Math.round((downloadProgress / totalBytes) * 100))}%` }}
          />
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", prefs.aiMode === 'rule-engine' ? "bg-success" : "bg-info")} aria-hidden />
        Active: {PREF_OPTIONS.find((o) => o.id === prefs.aiMode)?.title}
        <span className="ml-auto hidden sm:inline">
          Auto-strip audio: {prefs.autoStripAudio ? 'on' : 'off'}
        </span>
      </div>

      {status ? (
        <p className="mt-2 break-words text-[11px] text-muted-foreground" role="status">{status}</p>
      ) : null}
    </section>
  );
}
