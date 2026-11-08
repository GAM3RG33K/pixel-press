import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  CheckCircle2,
  Clipboard,
  FileAudio,
  FileVideo,
  Loader2,
  Play,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import type { EncoderCapabilities, VideoMetadata } from "@/types/media";
import { Button } from "@/components/ui/button";
import { DropZone } from "@/components/DropZone";
import { getFfmpegService } from "@/lib/ffmpeg/service";
import {
  buildVideoSnippet,
  buildPosterPath,
} from "@/lib/snippet";
import {
  PRESETS,
  buildVariantPlan,
  buildWorkbenchVariants,
  estimateSizeBytes,
} from "@/lib/workflow";
import { useAiMode } from "@/lib/ai/use-ai-mode";
import { planWithAI } from "@/lib/ai/webllm";
import { fetchSampleClip } from "@/lib/sample";
import { diag, captureError } from "@/lib/diagnostics";
import { cn } from "@/lib/utils";

interface OutputFile {
  label: string;
  fileName: string;
  sizeBytes: number;
  durationMs: number;
  blob: Blob;
  container: "mp4" | "webm";
}

export function CompressView() {
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [capabilities, setCapabilities] = useState<EncoderCapabilities | null>(null);
  const [intentText, setIntentText] = useState("");
  const [activePresetId, setActivePresetId] = useState<string | null>("hero-loop");
  const [status, setStatus] = useState<
    "idle" | "probing" | "ready" | "encoding" | "done" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [copied, setCopied] = useState<"html" | "jsx" | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const currentPlan = useMemo(() => buildVariantPlan(intentText, metadata), [intentText, metadata]);
  const aiMode = useAiMode();
  const [aiPlan, setAiPlan] = useState<{ plan: typeof currentPlan; used: "ai" | "rule-engine" } | null>(null);

  useEffect(() => {
    if (!metadata || !intentText.trim() || aiMode === 'rule-engine') {
      setAiPlan(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      planWithAI(metadata, intentText, aiMode).then((result) => {
        if (!cancelled) {
          setAiPlan({ plan: result.plan, used: result.used });
        }
      });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [metadata, intentText, aiMode]);

  const resolvedPlan = aiPlan?.plan ?? currentPlan;
  const resolvedPlanLabel = aiPlan?.used === 'ai' ? `AI plan: ${resolvedPlan.ruleSource}` : resolvedPlan.ruleSource;
  const variantSet = useMemo(() => {
    if (!metadata) return null;
    return buildWorkbenchVariants(resolvedPlan, metadata.fileSize, metadata, "optimized");
  }, [resolvedPlan, metadata]);

  // Pre-load engine when the user has a file so probe feels instant
  useEffect(() => {
    if (metadata) {
      getFfmpegService()
        .getCapabilities()
        .then(setCapabilities)
        .catch(() => undefined);
    }
  }, [metadata]);

  const loadSample = useCallback(async () => {
    setError(null);
    setStatus("probing");
    try {
      const sample = await fetchSampleClip();
      await analyzeFile(sample);
    } catch (caught) {
      const normalized = captureError(caught);
      diag.error('compress.sample', `sample fetch/analysis failed: ${normalized.message}`, {
        name: normalized.name,
        stack: normalized.stack,
      });
      setError(normalized.message);
      setStatus("error");
    }
  }, []);

  const analyzeFile = useCallback(async (incoming: File) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setFile(incoming);
    setOutputs([]);
    setError(null);
    setProgress(0);
    setStatus("probing");
    setMetadata(null);
    setCapabilities(null);

    try {
      const service = getFfmpegService();
      const result = await service.probe({
        input: incoming,
        fileName: incoming.name,
        signal: abortRef.current.signal,
      });
      setMetadata(result.metadata);
      setStatus("ready");

      service.getCapabilities().then(setCapabilities).catch(() => undefined);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        diag.info('compress', 'probe aborted by user');
        return;
      }
      const normalized = captureError(caught);
      diag.error('compress', `probe failed: ${normalized.message}`, {
        name: normalized.name,
        stack: normalized.stack,
      });
      setError(normalized.message);
      setStatus("error");
    }
  }, []);

  const encodeNow = useCallback(async () => {
    if (!file || !metadata) return;
    setStatus("encoding");
    setError(null);
    setProgress(0);
    setOutputs([]);
    setFallbackNotice(null);

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const base = file.name.replace(/\.[^./]+$/, "") || "video";

    const variantsToEncode = variantSet?.variants ?? [];
    try {
      const service = getFfmpegService();
      const encoded: OutputFile[] = [];

      for (const variant of variantsToEncode) {
        if (abortRef.current.signal.aborted) return;
        const outName =
          variant.container === "webm" ? `${base}-webm.webm` : `${base}-h264.mp4`;
        const encodedResult = await service.encode({
          input: file,
          inputFileName: file.name,
          outputFileName: outName,
          codec: variant.codec,
          crf: variant.crf,
          ...(variant.targetScale
            ? {
                width: variant.targetScale.width,
                height: variant.targetScale.height,
              }
            : {}),
          stripAudio: variant.stripAudio,
          faststart: variant.container === "mp4",
          durationSeconds: metadata.duration,
          onProgress: ({ progress: p }) => setProgress(p),
          signal: abortRef.current.signal,
        });

        if (variant.codec !== variant.requestedCodec) {
          setFallbackNotice(
            `Requested ${variant.requestedCodec.toUpperCase()} but this browser only supports H.264 — encoded as H.264.`,
          );
        }

        encoded.push({
          label: variant.label,
          fileName: encodedResult.outputFileName,
          sizeBytes: encodedResult.data.byteLength,
          durationMs: encodedResult.durationMs,
          blob: new Blob([encodedResult.data as Uint8Array<ArrayBuffer>], {
            type: variant.container === "webm" ? "video/webm" : "video/mp4",
          }),
          container: variant.container,
        });
        setProgress(0);

        diag.info('compress', `variant encoded: ${variant.label}`, {
          bytes: encodedResult.data.byteLength,
          durationMs: encodedResult.durationMs,
          crf: variant.crf,
          codec: variant.codec,
        });
      }

      setOutputs(encoded);
      setStatus("done");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        diag.info('compress', 'encode aborted by user');
        setStatus("ready");
        return;
      }
      const normalized = captureError(caught);
      diag.error('compress', `encode failed: ${normalized.message}`, {
        name: normalized.name,
        stack: normalized.stack,
      });
      setError(normalized.message);
      setStatus("error");
    }
  }, [file, metadata, variantSet]);

  const download = useCallback((output: OutputFile) => {
    const url = URL.createObjectURL(output.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = output.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const copySnippet = useCallback(
    async (kind: "html" | "jsx") => {
      if (outputs.length === 0) return;
      const snippet = buildVideoSnippet(
        outputs.map((output) => ({
          fileName: output.fileName,
          path: `./${output.fileName}`,
          container: output.container,
          sizeBytes: output.sizeBytes,
        })),
        {
          posterFileName: `${(file?.name ?? "video").replace(/\.[^./]+$/, "")}-poster.webp`,
          posterPath: buildPosterPath(
            (file?.name ?? "video").replace(/\.[^./]+$/, ""),
          ),
          autoplay: currentPlan.audioHandling === "strip" && currentPlan.ruleSource !== "R7: Default fallback",
          loop: true,
          preload: "metadata",
          withJsx: kind === "jsx",
        },
      );
      await navigator.clipboard.writeText(snippet);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1800);
    },
    [outputs, resolvedPlan, file],
  );

  const removeAudioPlanned = resolvedPlan.audioHandling === "strip";

  return (
    <section aria-labelledby="compress-view" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        <h2 id="compress-view" className="text-lg font-semibold tracking-tight">
          Smart Compress
        </h2>
        <p className="text-sm text-muted-foreground">
          Drop a video, tell us your goal in plain language, and the local rule
          engine (or optional AI) will pick the right codec, CRF and handling —
          then encode right here in your browser.
        </p>

        {!file ? (
          <>
            <DropZone onFile={analyzeFile} />
            <button
              type="button"
              onClick={loadSample}
              className="self-start rounded-md border border-info/40 bg-info/10 px-3 py-1.5 text-xs text-info transition-colors hover:bg-info/20"
            >
              Try with a sample clip (downloads from Wikimedia, ~1.8 MB)
            </button>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/50 p-4 backdrop-blur">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium">
                <FileVideo className="size-4 text-primary" aria-hidden />
                <span className="max-w-[340px] truncate">{file.name}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(1)} MB
                {metadata ? ` · ${metadata.width}×${metadata.height} · ${metadata.duration.toFixed(1)}s · ${metadata.videoCodec}${metadata.hasAudio ? " · audio" : ""}` : " · probing…"}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setFile(null); setMetadata(null); setOutputs([]); setStatus("idle"); }}>
              <Trash2 className="size-4" aria-hidden />
              Clear
            </Button>
          </div>
        )}

        {metadata ? (
          <>
            <div className="rounded-xl border border-border bg-card/50 p-4 backdrop-blur">
              <label htmlFor="intent-bar" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Intent (optional)
              </label>
              <input
                id="intent-bar"
                value={intentText}
                onChange={(event) => setIntentText(event.target.value)}
                placeholder='e.g. "hero background video under 5MB, no audio" or "social media 1080p"'
                className="mt-2 w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setActivePresetId(preset.id);
                      setIntentText(preset.intent);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs transition-colors",
                      activePresetId === preset.id
                        ? "border-primary/60 bg-primary/15 text-primary"
                        : "border-border bg-card/40 text-muted-foreground hover:text-foreground",
                    )}
                    title={preset.description}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {resolvedPlan.ruleSource ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  <Zap className="mr-1 inline size-3 text-warning" aria-hidden />
                  Plan: {resolvedPlanLabel}
                  {removeAudioPlanned ? " · strip audio" : ""}
                </p>
              ) : null}
            </div>

            <ProgressBar
              progress={progress}
              active={status === "encoding"}
              label={status === "encoding" ? "Encoding with FFmpeg WASM…" : status === "probing" ? "Probing with FFprobe…" : "Ready to encode"}
            />
          </>
        ) : null}

        {status === "encoding" ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="self-start rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/20"
          >
            <XCircle className="mr-1 inline size-3.5" aria-hidden />
            Cancel encode
          </button>
        ) : null}

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {fallbackNotice ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" role="status">
            {fallbackNotice}
          </p>
        ) : null}

        {outputs.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-border bg-card/50 backdrop-blur">
            <div className="border-b border-border/60 px-4 py-2.5 text-sm font-medium">
              Encoded outputs
              <span className="ml-2 text-xs font-normal text-muted-foreground">compressed locally · in this browser</span>
            </div>
            <ul className="divide-y divide-border/60">
              {outputs.map((output) => {
                const saved = metadata && metadata.fileSize > 0
                  ? Math.round((1 - output.sizeBytes / metadata.fileSize) * 100)
                  : null;
                return (
                  <li key={output.fileName} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <FileVideo className={cn("size-5", output.container === "webm" ? "text-success" : "text-info")} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs">{output.fileName}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {(output.sizeBytes / 1024 / 1024).toFixed(1)} MB
                        {saved !== null && saved >= 0 ? ` · ${saved}% smaller` : ""} · {Math.round(output.durationMs / 1000)}s encode
                      </p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => download(output)}>
                      <ArrowDownToLine className="size-4" aria-hidden />
                      Download
                    </Button>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3">
              <span className="text-xs text-muted-foreground">Copy &lt;video&gt; markup:</span>
              <Button size="sm" variant="outline" onClick={() => copySnippet("html")}>
                {copied === "html" ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Clipboard className="size-4" aria-hidden />}
                HTML {copied === "html" && "· copied!"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => copySnippet("jsx")}>
                {copied === "jsx" ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Clipboard className="size-4" aria-hidden />}
                JSX {copied === "jsx" && "· copied!"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <aside className="flex flex-col gap-4">
        {variantSet ? (
          <div className="rounded-xl border border-border bg-card/50 p-4 backdrop-blur">
            <h3 className="text-sm font-medium">Planned output</h3>
            <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
              {variantSet.variants.map((variant) => (
                <li key={variant.label} className="flex items-center justify-between gap-2">
                  <span>{variant.label}</span>
                  <span className="tabular-nums">
                    ~{Math.round(estimateSizeBytes(metadata?.fileSize ?? 0, variant.crf, variant.codec) / 1024 / 1024 * 10) / 10} MB
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
              Estimates assume the WebM and H.264 variants. WebM typically wins on size; H.264 wins on device compatibility.
            </p>
          </div>
        ) : null}

        <div className="rounded-xl border border-border bg-card/50 p-4 text-xs text-muted-foreground backdrop-blur">
          <h3 className="text-sm font-medium text-foreground">How this works</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4">
            <li>FFprobe reads duration, dimensions, fps and audio — entirely locally.</li>
            <li>The deterministic rule engine (or optional WebLLM) maps metadata + intent to a codec/CRF plan.</li>
            <li>FFmpeg WASM encodes the chosen variants in a Web Worker.</li>
            <li>Download the results or copy production-ready markup.</li>
          </ol>
        </div>

        {capabilities ? (
          <div className="rounded-xl border border-border bg-card/50 p-4 text-xs text-muted-foreground backdrop-blur">
            <div className="flex items-center gap-2">
              <FileAudio className="size-4" aria-hidden />
              <h3 className="text-sm font-medium text-foreground">Encoder status</h3>
            </div>
            <ul className="mt-2 space-y-1">
              <li>H.264: {capabilities.libx264 ? "available" : "unavailable"}</li>
              <li>H.265: {capabilities.libx265 ? "available" : "unavailable"}</li>
              <li>VP8: {capabilities.libvpx ? "available" : "unavailable"}</li>
              <li>Threading: {capabilities.multiThreaded ? "multi-threaded" : "single-threaded"}</li>
            </ul>
            <Button className="mt-3 w-full" variant="outline" size="sm" onClick={encodeNow} disabled={status === "encoding" || !file || !metadata}>
              {status === "encoding" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
              {status === "encoding" ? "Encoding…" : "Compress now"}
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card/50 p-4 text-xs text-muted-foreground backdrop-blur">
            Probe a video first to enable encode actions.
          </div>
        )}
      </aside>
    </section>
  );
}

function ProgressBar({ progress, active, label }: { progress: number; active: boolean; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{Math.round(progress)}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-150"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
      {active ? null : <span className="sr-only">Encoding in progress</span>}
    </div>
  );
}
