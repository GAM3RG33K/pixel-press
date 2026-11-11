import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
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
import { StageCard } from "@/components/stage-card";
import { Marquee } from "@/components/marquee";
import { getFfmpegService } from "@/lib/ffmpeg/service";
import {
  isNativeEngine,
  nativeStageInput,
  nativeProbeStaged,
  nativeCapabilities,
  nativeEncodeFile,
  nativeOutPath,
  nativeOutCachePath,
  nativeReadAndRemove,
  nativeProbePath,
  tryProbeSlice,
  type NativeStagedInput,
} from "@/lib/ffmpeg/native-engine";
import { isHugeFile } from "@/lib/ffmpeg/huge-file";
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
import { registerTask, updateTask, completeTask, failTask, cancelTask } from "@/lib/tasks/registry";
import { resolvePlan } from "@/lib/ai/plan";
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

export function CompressView({
  initialFile,
  onBack,
  intentSeed,
  intentNonce = 0,
}: {
  /** Routed from the press home: drop 1 file → single flow, pre-loaded here. */
  initialFile?: { file: File; path?: string; sizeBytes?: number } | null;
  onBack?: () => void;
  /** Plain-language goal picked on the home (applied to the intent bar). */
  intentSeed?: string;
  intentNonce?: number;
} = {}) {
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
  const [stageProgress, setStageProgress] = useState<import("@/components/stage-card").StageProgressState | null>(null);
  /** Post-encode "Try 3 quality levels" trial (replaces the old Compare tab). */
  const [showQualityTrials, setShowQualityTrials] = useState(false);
  const [qualityTrials, setQualityTrials] = useState<{
    status: "idle" | "running" | "done" | "error";
    levels: { crf: number; bytes: number; fileName: string; blob: Blob }[];
    error?: string;
  }>({ status: "idle", levels: [] });
  /** Temp copy of the selected file, staged once per selection. */
  const stagedRef = useRef<NativeStagedInput | null>(null);
  /** Absolute source path when the file came from a native Tauri drop (never modified). */
  const sourcePathRef = useRef<string | null>(null);
  const sourceSizeRef = useRef<number | null>(null);

  // Goal chip picked on the home → seed the intent bar.
  const intentNonceRef = useRef(0);
  useEffect(() => {
    if (!intentSeed) return;
    if (intentNonceRef.current === intentNonce) return;
    intentNonceRef.current = intentNonce;
    setIntentText(intentSeed);
    setActivePresetId(null);
  }, [intentSeed, intentNonce]);

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
      resolvePlan(metadata, intentText, aiMode).then((result) => {
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
      setStageProgress(null);
      setError(normalized.message);
      setStatus("error");
    }
  }, []);

  const analyzeFile = useCallback(async (incoming: File, path?: string, sizeBytes?: number) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setFile(incoming);
    sourcePathRef.current = null;
    sourceSizeRef.current = null;
    setOutputs([]);
    setError(null);
    setProgress(0);
    setStatus("probing");
    setMetadata(null);
    setCapabilities(null);

    try {
      let metadataResult;
      if (isNativeEngine()) {
        if (stagedRef.current) {
          const oldDir = stagedRef.current.dir;
          void import("@tauri-apps/api/core").then((m) => m.invoke("cleanup_encode_dir", { path: oldDir }));
          stagedRef.current = null;
        }
        const effectiveSize = sizeBytes ?? incoming.size;
        if (path) {
          // Native drop: probe the real path directly — no copy, source untouched.
          sourcePathRef.current = path;
          sourceSizeRef.current = effectiveSize;
          metadataResult = await nativeProbePath(path, incoming.name, effectiveSize);
          setStageProgress(null);
          setCapabilities(await nativeCapabilities().catch(() => null));
          setMetadata(metadataResult.metadata);
          setStatus("ready");
          return;
        }
        // Browser pick: huge files get a slice probe from the first 40 MB.
        let sliced: { metadata: VideoMetadata; raw: string } | null = null;
        if (isHugeFile(incoming)) {
          const slice = incoming.slice(0, 40 * 1024 * 1024);
          sliced = await tryProbeSlice(slice, incoming.name, incoming.size);
        }
        const stagingStarted = performance.now();
        setStageProgress({ copied: 0, total: incoming.size, startedAt: stagingStarted });
        const staged = await nativeStageInput(
          incoming,
          `${incoming.name.replace(/\.[^./]+$/, "") || "video"}-optimized.mp4`,
          (copied, total) => setStageProgress({ copied, total, startedAt: stagingStarted }),
        );
        stagedRef.current = staged;
        metadataResult = sliced ?? (await nativeProbeStaged(staged, incoming.name, incoming.size));
        setCapabilities(await nativeCapabilities().catch(() => null));
      } else {
        const service = getFfmpegService();
        metadataResult = await service.probe({
          input: incoming,
          fileName: incoming.name,
          signal: abortRef.current.signal,
        });
        service.getCapabilities().then(setCapabilities).catch(() => undefined);
      }
      setMetadata(metadataResult.metadata);
      setStageProgress(null);
      setStatus("ready");
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

  // Route from the press home: pre-load the dropped file (re-arms per route).
  const lastHandledFileRef = useRef<typeof initialFile>(null);
  useEffect(() => {
    if (!initialFile || lastHandledFileRef.current === initialFile) return;
    lastHandledFileRef.current = initialFile;
    void analyzeFile(initialFile.file, initialFile.path, initialFile.sizeBytes);
  }, [initialFile, analyzeFile]);

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
      let taskId: string | null = null;
    const useNative = isNativeEngine();
    try {
      const service = useNative ? null : getFfmpegService();
      const encoded: OutputFile[] = [];

      for (const variant of variantsToEncode) {
        if (abortRef.current.signal.aborted) {
          if (taskId) cancelTask(taskId);
          setStatus("ready");
          return;
        }
        const outName =
          variant.container === "webm" ? `${base}-webm.webm` : `${base}-h264.mp4`;
        taskId = registerTask({
          workbench: "compress",
          label: `Compress · ${variant.label}`,
          stage: "Starting encode…",
          progress: 0,
          cancel: () => abortRef.current?.abort(),
        });
        const currentTaskId = taskId;

        let encodedResult;
        if (useNative) {
          let staged = stagedRef.current;
          if (!sourcePathRef.current && !staged) {
            staged = await nativeStageInput(file, outName);
            stagedRef.current = staged;
          }
          const inputPath = sourcePathRef.current ?? staged!.tmpPath;
          const outPath = staged ? nativeOutPath(staged, outName) : await nativeOutCachePath(outName);
          const done = await nativeEncodeFile({
            inputPath,
            outputPath: outPath,
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
            onProgress: (p) => {
              setProgress(p);
              updateTask(currentTaskId, { progress: p, stage: `${variant.label} · encoding` });
            },
            signal: abortRef.current.signal,
          });
          const bytes = await nativeReadAndRemove(outPath);
          if (!staged) {
            const outDir = outPath.replace(/[/\\][^/\\]+$/, "");
            void import("@tauri-apps/api/core").then((m) => m.invoke("cleanup_encode_dir", { path: outDir }));
          }
          encodedResult = {
            data: bytes,
            outputFileName: outName,
            durationMs: done.durationMs,
            sizeBytes: done.sizeBytes,
            log: done.log,
          };
        } else {
          encodedResult = await service!.encode({
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
            onProgress: ({ progress: p }) => {
              setProgress(p);
              updateTask(currentTaskId, { progress: p, stage: `${variant.label} · encoding` });
            },
            signal: abortRef.current.signal,
          });
        }

        if (variant.codec !== variant.requestedCodec) {
          setFallbackNotice(
            `Requested ${variant.requestedCodec.toUpperCase()}, which this build's encoder does not provide — encoded as ${variant.codec.toUpperCase()} instead.`,
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
        completeTask(currentTaskId);
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
      const aborted =
        (caught instanceof DOMException && caught.name === "AbortError") ||
        (caught instanceof Error && /abort/i.test(caught.message));
      if (aborted) {
        diag.info('compress', 'encode aborted by user');
        if (taskId) cancelTask(taskId);
        setStatus("ready");
        return;
      }
      const normalized = captureError(caught);
      diag.error('compress', `encode failed: ${normalized.message}`, {
        name: normalized.name,
        stack: normalized.stack,
      });
      if (taskId) failTask(taskId, normalized.message);
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

  const tryQualityLevels = useCallback(async () => {
    if (!file || !metadata) return;
    const base = resolvedPlan.crf;
    const crfs = Array.from(new Set([Math.max(18, base - 6), base, Math.min(36, base + 6)]));
    setQualityTrials({ status: "running", levels: [] });
    const useNative = isNativeEngine();
    const baseName = file.name.replace(/\.[^./]+$/, "") || "video";
    const levels: { crf: number; bytes: number; fileName: string; blob: Blob }[] = [];
    try {
      for (const crf of crfs) {
        if (abortRef.current?.signal.aborted) break;
        const outName = `${baseName}-q${crf}.mp4`;
        const codec = resolvedPlan.targetCodec === "h265" ? "h265" : "h264";
        if (useNative) {
          const staged = stagedRef.current;
          const inputPath = sourcePathRef.current ?? staged?.tmpPath;
          if (!inputPath) throw new Error("Source is no longer staged — re-drop the file.");
          const outPath = staged ? nativeOutPath(staged, outName) : await nativeOutCachePath(outName);
          await nativeEncodeFile({
            inputPath,
            outputPath: outPath,
            codec,
            crf,
            stripAudio: resolvedPlan.audioHandling === "strip",
            faststart: true,
            durationSeconds: metadata.duration,
            onProgress: () => undefined,
            ...(abortRef.current?.signal ? { signal: abortRef.current.signal } : {}),
          });
          const bytes = await nativeReadAndRemove(outPath);
          levels.push({ crf, bytes: bytes.byteLength, fileName: outName, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "video/mp4" }) });
        } else {
          const service = getFfmpegService();
          const encoded = await service.encode({
            input: file,
            inputFileName: file.name,
            outputFileName: outName,
            codec,
            crf,
            stripAudio: resolvedPlan.audioHandling === "strip",
            faststart: true,
            durationSeconds: metadata.duration,
            onProgress: () => undefined,
            ...(abortRef.current?.signal ? { signal: abortRef.current.signal } : {}),
          });
          levels.push({ crf, bytes: encoded.data.byteLength, fileName: outName, blob: new Blob([encoded.data as Uint8Array<ArrayBuffer>], { type: "video/mp4" }) });
        }
      }
      setQualityTrials({ status: "done", levels });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      diag.error("compress.quality", `quality trials failed: ${message}`);
      setQualityTrials((prev) => ({ ...prev, status: "error", error: message }));
    }
  }, [file, metadata, resolvedPlan]);


  return (
    <section aria-labelledby="compress-view" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back to the press
          </button>
        ) : null}
        <h2 id="compress-view" className="text-lg font-semibold tracking-tight">
          Smart Compress
        </h2>
        {!file ? (
          <p className="text-sm text-muted-foreground">
            Drop a video, tell us your goal in plain language, and the local rule
            engine (or optional AI) will pick the right codec, CRF and handling —
            then encode right here on this device.
          </p>
        ) : null}

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
        ) : null}

        {status === "probing" && file ? (
          <StageCard
            file={file}
            stageProgress={stageProgress}
          />
        ) : null}

        {file && status !== "probing" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 press-paper rounded-xl p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium">
                <FileVideo className="size-4 text-primary" aria-hidden />
                <Marquee title={file.name} className="max-w-[340px]">{file.name}</Marquee>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {((sourceSizeRef.current ?? file.size) / 1024 / 1024).toFixed(1)} MB
                {metadata ? ` · ${metadata.width}×${metadata.height} · ${metadata.duration.toFixed(1)}s · ${metadata.videoCodec}${metadata.hasAudio ? " · audio" : ""}` : " · probing…"}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => {
              if (stagedRef.current) {
                const dir = stagedRef.current.dir;
                void import("@tauri-apps/api/core").then((m) => m.invoke("cleanup_encode_dir", { path: dir }));
                stagedRef.current = null;
              }
              sourcePathRef.current = null;
              sourceSizeRef.current = null;
              setFile(null); setMetadata(null); setOutputs([]); setStatus("idle");
            }}>
              <Trash2 className="size-4" aria-hidden />
              Clear
            </Button>
          </div>
        ) : null}

        {metadata ? (
          <>
            <div className="press-paper rounded-xl p-4">
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
                  Plan:{" "}
                  <span className="cursor-help underline decoration-dotted underline-offset-2" title={resolvedPlan.ruleSource}>
                    {resolvedPlanLabel}
                  </span>
                  {removeAudioPlanned ? " · strip audio" : ""}
                </p>
              ) : null}
            </div>

            <Button
              size="lg"
              onClick={encodeNow}
              disabled={status === "encoding" || !file || !metadata}
              className="self-stretch sm:self-start sm:min-w-56"
            >
              {status === "encoding" ? (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              ) : (
                <Play className="size-5" aria-hidden />
              )}
              {status === "encoding" ? "Encoding…" : "Compress now"}
            </Button>

            <ProgressBar
              progress={progress}
              active={status === "encoding"}
              label={status === "encoding" ? "Encoding with native FFmpeg…" : status === "probing" ? "Probing with FFprobe…" : "Ready to encode"}
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

        {outputs.length > 0 ? (() => {
          const outTotal = outputs.reduce((sum, o) => sum + o.sizeBytes, 0);
          const inTotal = metadata ? metadata.fileSize * outputs.length : 0;
          const savedBytes = Math.max(0, inTotal - outTotal);
          const savedPct = inTotal > 0 ? Math.round((savedBytes / inTotal) * 100) : 0;
          const inMb = inTotal / 1024 / 1024;
          const outMb = outTotal / 1024 / 1024;
          const barPct = inMb > 0 ? Math.max(2, Math.min(100, (outMb / inMb) * 100)) : 100;
          return (
            <div className="press-paper press-field rounded-2xl px-6 py-6 text-center" role="status">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-success">
                Pressed
              </p>
              <p className="mt-2 text-[var(--text-hero)] font-semibold leading-none tracking-tighter text-foreground tabular-nums">
                −{savedPct}
                <span className="text-4xl align-top text-primary">%</span>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {(savedBytes / 1024 / 1024).toFixed(1)} MB lighter · {outputs.length} output{outputs.length === 1 ? "" : "s"} · encoded on this device
              </p>
              <div className="mx-auto mt-4 max-w-md">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                  <span>Before {inMb.toFixed(1)} MB</span>
                  <span>After {outMb.toFixed(1)} MB</span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${barPct}%` }} />
                </div>
              </div>
            </div>
          );
        })() : null}

        {outputs.length > 0 ? (
          <div className="overflow-hidden press-paper rounded-xl">
            <div className="border-b border-border/60 px-4 py-2.5 text-sm font-medium">
              Encoded outputs
              <span className="ml-2 text-xs font-normal text-muted-foreground">compressed locally · on this device</span>
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
                      <Marquee title={output.fileName} className="font-mono text-xs">{output.fileName}</Marquee>
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

        {outputs.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-border bg-card/50">
            <button
              type="button"
              onClick={() => setShowQualityTrials((v) => !v)}
              aria-expanded={showQualityTrials}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-accent/40"
            >
              Try 3 quality levels
              <ChevronDown className={cn("size-4 transition-transform", showQualityTrials && "rotate-180")} aria-hidden />
            </button>
            {showQualityTrials ? (
              <div className="border-t border-border/60 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Re-encodes this source at three CRF levels around your plan (H.264) and shows the size trade-off. Pick the one that looks right — nothing uploads.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => void tryQualityLevels()}
                  disabled={qualityTrials.status === "running"}
                >
                  {qualityTrials.status === "running" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Zap className="size-4" aria-hidden />
                  )}
                  {qualityTrials.status === "running" ? "Encoding 3 levels…" : "Encode 3 levels"}
                </Button>
                {qualityTrials.status === "error" ? (
                  <p className="mt-2 text-xs text-destructive" role="alert">{qualityTrials.error}</p>
                ) : null}
                {qualityTrials.levels.length > 0 ? (
                  <ul className="mt-3 divide-y divide-border/60 rounded-lg border border-border">
                    {qualityTrials.levels.map((level, index) => {
                      const pct = metadata && metadata.fileSize > 0
                        ? Math.round((level.bytes / metadata.fileSize) * 100)
                        : null;
                      const isMiddle = index === Math.floor(qualityTrials.levels.length / 2);
                      return (
                        <li key={level.crf} className="flex items-center gap-3 px-3 py-2 text-xs">
                          <span className="font-mono tabular-nums text-muted-foreground">CRF {level.crf}</span>
                          <span className="min-w-0 flex-1 tabular-nums">
                            {(level.bytes / 1024 / 1024).toFixed(1)} MB
                            {pct !== null ? ` · ${pct}% of source` : ""}
                            {isMiddle ? <span className="ml-2 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">recommended</span> : null}
                          </span>
                          <Button size="sm" variant="ghost" onClick={() => download({ label: `CRF ${level.crf}`, fileName: level.fileName, sizeBytes: level.bytes, durationMs: 0, blob: level.blob, container: "mp4" })}>
                            <ArrowDownToLine className="size-4" aria-hidden />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {outputs.length > 0 ? (
          <details className="rounded-xl border border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none text-sm font-medium text-foreground">
              Technical details
            </summary>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-[11px]">
              <dt className="text-muted-foreground">plan</dt><dd>{resolvedPlanLabel}</dd>
              <dt className="text-muted-foreground">codec</dt><dd>{resolvedPlan.targetCodec} · CRF {resolvedPlan.crf} · {resolvedPlan.twoPass ? "two-pass" : "single-pass"}</dd>
              <dt className="text-muted-foreground">audio</dt><dd>{removeAudioPlanned ? "stripped" : (resolvedPlan.audioHandling ?? "copy")}</dd>
              {metadata ? (
                <>
                  <dt className="text-muted-foreground">source</dt><dd>{metadata.width}×{metadata.height} · {metadata.duration.toFixed(2)}s · {metadata.videoCodec}{metadata.hasAudio ? " · audio" : ""}</dd>
                </>
              ) : null}
            </dl>
          </details>
        ) : null}
      </div>

      <aside className="flex flex-col gap-4">
        {variantSet ? (
          <div className="press-paper rounded-xl p-4">
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

        <div className="press-paper rounded-xl p-4 text-xs text-muted-foreground">
          <h3 className="text-sm font-medium text-foreground">How this works</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4">
            <li>FFprobe reads duration, dimensions, fps and audio — entirely locally.</li>
            <li>The deterministic rule engine (or the optional on-device AI) maps metadata + intent to a codec/CRF plan.</li>
            <li>Native FFmpeg encodes the chosen variants on this device.</li>
            <li>Download the results or copy production-ready markup.</li>
          </ol>
        </div>

        {capabilities ? (
          <div className="press-paper rounded-xl p-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <FileAudio className="size-4" aria-hidden />
              <h3 className="text-sm font-medium text-foreground">Encoder status</h3>
            </div>
            <ul className="mt-2 space-y-1">
              <li>H.264: {capabilities.libx264 ? "available" : "unavailable"}</li>
              <li>H.265: {capabilities.libx265 ? "available" : "unavailable"}</li>
              <li>VP9: {capabilities.libvpxVp9 ? "available" : "unavailable"}</li>
              <li>Threading: {capabilities.multiThreaded ? "multi-threaded" : "single-threaded"}</li>
            </ul>
          </div>
        ) : (
          <div className="press-paper rounded-xl p-4 text-xs text-muted-foreground">
            Probe a video first to enable encode actions.
          </div>
        )}
      </aside>
    </section>
  );
}

function ProgressBar({ progress, active, label }: { progress: number; active: boolean; label: string }) {
  return (
    <div className="press-paper rounded-xl p-4">
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
