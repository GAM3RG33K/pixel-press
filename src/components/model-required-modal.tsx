/**
 * ModelRequiredModal — blocking dialog for intents that exceed rule-engine
 * coverage when no local model is downloaded/ready.
 *
 * Options:
 *  1. Download the model (~270 MB) and encode with AI — encode proceeds automatically when ready.
 *  2. Best-effort with the rule engine — encode proceeds with a degraded plan + notice.
 *  3. Cancel — back to editing the intent.
 */

import { useEffect, useState } from "react";
import { BrainCircuit, Download, Loader2, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";

import { isTauri, listLlmCandidates, downloadLlm, type LlmCandidate } from "@/lib/tauri";
import { downloadModel } from "@/lib/ai/webllm";
import { savePreferences } from "@/lib/settings";
import { cn } from "@/lib/utils";

export function ModelRequiredModal({
  intent,
  onModelReady,
  onBestEffort,
  onCancel,
}: {
  /** The intent text that triggered the modal (shown for context). */
  intent: string;
  /** Called once the model is downloaded & selected as AI mode — parent re-runs resolution and encodes. */
  onModelReady: () => void;
  /** Called when the user chooses best-effort rule-engine processing. */
  onBestEffort: () => void;
  onCancel: () => void;
}) {
  const [spec, setSpec] = useState<LlmCandidate | null>(null);
  const [status, setStatus] = useState<"idle" | "downloading" | "error">("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      listLlmCandidates()
        .then((models) => setSpec(models.find((m) => m.id === "smollm2-360m") ?? null))
        .catch(() => setSpec(null));
      listen<[string, number]>("download-progress", (event) => {
        if (event.payload[0] === "llm:smollm2-360m") setProgress(event.payload[1]);
      })
        .then((fn) => { unlisten = fn; })
        .catch(() => undefined);
    }
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && status !== "downloading") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, status]);

  const startDownload = async () => {
    setStatus("downloading");
    setError(null);
    setProgress(0);
    try {
      if (isTauri()) {
        if (!spec) throw new Error("Model manifest unavailable — check Settings → Engine.");
        await downloadLlm(spec.id, { url: spec.url, sha256: spec.sha256 });
      } else {
        await downloadModel("smollm2-360m");
      }
      await savePreferences({ aiMode: "smollm2-360m" });
      onModelReady();
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Local AI model required" className="fixed inset-0 z-50 flex items-center justify-center">
      <button aria-label="Cancel" className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm" onClick={status === "downloading" ? undefined : onCancel} />
      <div className="relative mx-4 w-full max-w-md rounded-2xl border border-press-paper-edge bg-background p-5 shadow-2xl">
        {status !== "downloading" ? (
          <button type="button" onClick={onCancel} aria-label="Close" className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <X className="size-4" aria-hidden />
          </button>
        ) : null}

        <div className="flex size-11 items-center justify-center rounded-xl border border-primary/40 bg-primary/10">
          <BrainCircuit className="size-6 text-primary" aria-hidden />
        </div>
        <h2 className="mt-3 text-base font-semibold tracking-tight">This intent needs the Local AI model</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Your request goes beyond what the built-in rule engine can decide on its own:
        </p>
        <p className="mt-2 rounded-md border border-border bg-card/50 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          “{intent.length > 160 ? `${intent.slice(0, 160)}…` : intent}”
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          The on-device model (~270 MB, runs entirely on this Mac, nothing uploads) reads intents
          like yours and turns them into an exact encode recipe.
        </p>

        {status === "error" ? (
          <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Download failed: {error}
          </p>
        ) : null}

        {status === "downloading" ? (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" aria-hidden /> Downloading SmolLM2-360M…</span>
              <span className="tabular-nums">{progress !== null ? `${Math.floor(progress)}%` : ""}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? 0}>
              <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${Math.min(100, Math.max(0, progress ?? 0))}%` }} />
            </div>
            <p className="mt-1.5 text-[10.5px] text-muted-foreground">Encoding starts automatically when the download finishes.</p>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={startDownload}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
                "transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <Download className="size-4" aria-hidden />
              Download model &amp; encode
            </button>
            <button
              type="button"
              onClick={onBestEffort}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-transparent px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Skip download — best-effort with rule engine
            </button>
            <button type="button" onClick={onCancel} className="text-center text-[11px] text-muted-foreground hover:text-foreground">
              Cancel and edit the intent
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
