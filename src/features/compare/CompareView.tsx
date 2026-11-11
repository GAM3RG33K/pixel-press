import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  CheckCircle2,
  FileVideo,
  Loader2,
  Trash2,
  XCircle,
} from "lucide-react";

import type { EncoderCapabilities, VideoMetadata } from "@/types/media";
import { Button } from "@/components/ui/button";
import { DropZone } from "@/components/DropZone";
import { getFfmpegService } from "@/lib/ffmpeg/service";
import { isNativeEngine, nativeCapabilities, nativeStageInput, nativeProbeStaged, nativeProbePath, tryProbeSlice, nativeEncodeFile, nativeOutPath, nativeOutCachePath, nativeReadAndRemove, type NativeStagedInput } from "@/lib/ffmpeg/native-engine";
import { isHugeFile } from "@/lib/ffmpeg/huge-file";
import { StageCard, type StageProgressState } from "@/components/stage-card";
import { Marquee } from "@/components/marquee";
import { useAiMode } from "@/lib/ai/use-ai-mode";
import { resolvePlan } from "@/lib/ai/plan";
import { diag, captureError } from "@/lib/diagnostics";
import { registerTask, updateTask, completeTask, failTask, cancelTask } from "@/lib/tasks/registry";
import { cn } from "@/lib/utils";

interface CompareResult {
  label: string;
  bytes: number;
  crf: number;
  seconds: number;
  ssimAll: number | null;
  codec: string;
  container: "mp4" | "webm";
  previewUrl: string;
  outFile: string;
}

export function CompareView() {
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [capabilities, setCapabilities] = useState<EncoderCapabilities | null>(null);
  const [status, setStatus] = useState<"idle" | "probing" | "ready" | "encoding" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentLabel, setCurrentLabel] = useState("");
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [variantProgress, setVariantProgress] = useState<number[]>([0, 0, 0]);
  const [results, setResults] = useState<CompareResult[]>([]);
  const [aiPlan, setAiPlan] = useState<{ targetCodec: "h264" | "vp9" | "h265"; crf: number; audioHandling?: "copy" | "encode" | "strip"; ruleSource?: string } | null>(null);
  const aiMode = useAiMode();
  const [activeIndex, setActiveIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const [stageProgress, setStageProgress] = useState<StageProgressState | null>(null);
  const stagedRef = useRef<NativeStagedInput | null>(null);
  const sourcePathRef = useRef<string | null>(null);
  const sourceSizeRef = useRef<number | null>(null);

  useEffect(() => {
    if (metadata) {
      if (isNativeEngine()) {
        nativeCapabilities().then(setCapabilities).catch(() => undefined);
      } else {
        getFfmpegService().getCapabilities().then(setCapabilities).catch(() => undefined);
      }
      // Let the AI (or rule engine) anchor the three quality settings.
      resolvePlan(metadata, undefined, aiMode).then((result) => {
        setAiPlan({
          targetCodec: result.plan.targetCodec,
          crf: result.plan.crf,
          ...(result.plan.audioHandling !== undefined ? { audioHandling: result.plan.audioHandling } : {}),
          ...(result.plan.ruleSource !== undefined ? { ruleSource: result.plan.ruleSource } : {}),
        });
      });
    }
  }, [metadata, aiMode]);

  const analyzeFile = useCallback(async (incoming: File, path?: string, sizeBytes?: number) => {
    setFile(incoming);
    sourcePathRef.current = null;
    sourceSizeRef.current = null;
    setMetadata(null);
    setResults([]);
    setStatus("probing");
    setError(null);
    try {
      if (isNativeEngine()) {
        if (stagedRef.current) {
          const oldDir = stagedRef.current.dir;
          void import("@tauri-apps/api/core").then((m) => m.invoke("cleanup_encode_dir", { path: oldDir }));
          stagedRef.current = null;
        }
        const effectiveSize = sizeBytes ?? incoming.size;
        if (path) {
          sourcePathRef.current = path;
          sourceSizeRef.current = effectiveSize;
          const result = await nativeProbePath(path, incoming.name, effectiveSize);
          setMetadata(result.metadata);
          setStageProgress(null);
          setStatus("ready");
          return;
        }
        let sliced: { metadata: import("@/types/media").VideoMetadata; raw: string } | null = null;
        if (isHugeFile(incoming)) {
          sliced = await tryProbeSlice(incoming.slice(0, 40 * 1024 * 1024), incoming.name, incoming.size);
        }
        const stagingStarted = performance.now();
        setStageProgress({ copied: 0, total: incoming.size, startedAt: stagingStarted });
        const staged = await nativeStageInput(
          incoming,
          "compare-out.mp4",
          (copied, total) => setStageProgress({ copied, total, startedAt: stagingStarted }),
        );
        stagedRef.current = staged;
        const result = sliced ?? (await nativeProbeStaged(staged, incoming.name, incoming.size));
        setMetadata(result.metadata);
        setStageProgress(null);
        setStatus("ready");
        return;
      }
      const service = getFfmpegService();
      const result = await service.probe({ input: incoming, fileName: incoming.name });
      setMetadata(result.metadata);
      setStatus("ready");
      service.getCapabilities().then(setCapabilities).catch(() => undefined);
    } catch (caught) {
      const normalized = captureError(caught);
      diag.error('compare', `probe failed: ${normalized.message}`, {
        name: normalized.name,
        stack: normalized.stack,
      });
      setStageProgress(null);
      setError(normalized.message);
      setStatus("error");
    }
  }, []);

  const runCompare = useCallback(async () => {
    if (!file || !metadata) return;
    setStatus("encoding");
    setError(null);
    setResults([]);
    setVariantProgress([0, 0, 0]);
    setCurrentIndex(-1);
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setVariantProgress([0, 0, 0]);
    setCurrentIndex(-1);

    let taskId: string | null = null;
    try {
      const useNative = isNativeEngine();
      const service = useNative ? null : getFfmpegService();
      const base = file.name.replace(/\.[^./]+$/, "") || "sample";
      const out: CompareResult[] = [];

      // Anchor the three variants to the resolved plan (AI when enabled), with sane clamps.
      const anchor = aiPlan?.crf ?? 27;
      const stripAudio = aiPlan?.audioHandling === "strip";
      const variants = [
        { label: `H.264 · CRF ${Math.max(16, anchor - 5)} · high quality`, crf: Math.max(16, anchor - 5), codec: "h264" as const, container: "mp4" as const },
        { label: `H.264 · CRF ${Math.min(35, anchor)} · balanced`, crf: Math.min(35, anchor), codec: "h264" as const, container: "mp4" as const },
        { label: `VP9 · CRF ${Math.min(50, anchor + 8)} · smallest`, crf: Math.min(50, anchor + 8), codec: "vp9" as const, container: "webm" as const },
      ];
      taskId = registerTask({
        workbench: "compare",
        label: "Compare · 3 variants",
        stage: "Starting…",
        progress: 0,
        cancel: () => abortRef.current?.abort(),
      });
      const currentTaskId = taskId;
      void stripAudio;

      for (const [variantIndex, variant] of variants.entries()) {
        if (abortRef.current.signal.aborted) {
          if (taskId) cancelTask(taskId);
          setCurrentIndex(-1);
          setStatus("ready");
          return;
        }
        setCurrentLabel(variant.label);
        setCurrentIndex(variantIndex);
        const outName = `${base}-${variant.codec}-${variant.crf}.${variant.container}`;
        const started = performance.now();
        const onProgress = (p: number) => {
          setVariantProgress((prev) => prev.map((v, i) => (i === variantIndex ? p : v)));
          updateTask(currentTaskId, {
            progress: Math.round(((variantIndex * 100 + p) / (variants.length * 100)) * 100),
            stage: `Variant ${variantIndex + 1}/${variants.length} · ${variant.label}`,
          });
        };
        let encoded: {
          data: Uint8Array;
          outputFileName: string;
          durationMs: number;
          sizeBytes: number;
          log: string[];
        };
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
            ...(variant.container === "mp4" ? { faststart: true } : {}),
            durationSeconds: metadata.duration,
            stripAudio: aiPlan?.audioHandling === "strip",
            signal: abortRef.current.signal,
            onProgress,
          });
          const bytes = await nativeReadAndRemove(outPath);
          if (!staged) {
            const outDir = outPath.replace(/[/\\][^/\\]+$/, "");
            void import("@tauri-apps/api/core").then((m) => m.invoke("cleanup_encode_dir", { path: outDir }));
          }
          encoded = { data: bytes, outputFileName: outName, durationMs: done.durationMs, sizeBytes: done.sizeBytes, log: done.log };
        } else {
          const wasmResult = await service!.encode({
            input: file,
            inputFileName: file.name,
            outputFileName: outName,
            codec: variant.codec,
            crf: variant.crf,
            ...(variant.container === "mp4" ? { faststart: true } : {}),
            durationSeconds: metadata.duration,
            stripAudio: aiPlan?.audioHandling === "strip",
            signal: abortRef.current.signal,
            onProgress: ({ progress }: { progress: number }) => onProgress(progress),
          });
          encoded = { ...wasmResult, sizeBytes: wasmResult.data.byteLength };
        }
        setVariantProgress((prev) => prev.map((v, i) => (i === variantIndex ? 100 : v)));

        const blob = new Blob([encoded.data as Uint8Array<ArrayBuffer>], {
          type: variant.container === "webm" ? "video/webm" : "video/mp4",
        });
        out.push({
          label: variant.label,
          bytes: encoded.data.byteLength,
          crf: variant.crf,
          seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
          ssimAll: null,
          codec: variant.codec,
          container: variant.container,
          previewUrl: URL.createObjectURL(blob),
          outFile: outName,
        });
      }

      completeTask(currentTaskId);
      setResults(out);
      setStatus("done");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        diag.info('compare', 'encode aborted by user');
        if (taskId) cancelTask(taskId);
        setStatus("ready");
        return;
      }
      const normalized = captureError(caught);
      diag.error('compare', `encode failed: ${normalized.message}`, {
        name: normalized.name,
        stack: normalized.stack,
      });
      if (taskId) failTask(taskId, normalized.message);
      setError(normalized.message);
      setStatus("error");
    }
  }, [file, metadata]);

  useEffect(() => {
    return () => { for (const result of results) URL.revokeObjectURL(result.previewUrl); };
  }, [results]);

  const best = useMemo(() => {
    if (results.length === 0) return null;
    return results.reduce((acc, r) => (r.bytes < acc.bytes ? r : acc), results[0]!);
  }, [results]);

  const download = useCallback((result: CompareResult) => {
    const anchor = document.createElement("a");
    anchor.href = result.previewUrl;
    anchor.download = result.outFile;
    anchor.click();
  }, []);

  return (
    <section aria-labelledby="compare-view" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        <h2 id="compare-view" className="text-lg font-semibold tracking-tight">
          Compare
        </h2>
        <p className="text-sm text-muted-foreground">
          Encode the same source at three quality settings and pick the smallest file that still looks right — with a split-screen preview.
        </p>

        {!file ? (
          <DropZone onFile={analyzeFile} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/50 p-4 backdrop-blur">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium">
                <FileVideo className="size-4 text-primary" aria-hidden />
                <Marquee title={file.name} className="max-w-[360px]">{file.name}</Marquee>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {((sourceSizeRef.current ?? file.size) / 1024 / 1024).toFixed(1)} MB
                {metadata ? ` · ${metadata.width}×${metadata.height} · ${metadata.duration.toFixed(1)}s` : ""}
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
              setFile(null); setMetadata(null); setResults([]); setStatus("idle");
            }}>
              <Trash2 className="size-4" aria-hidden />
              Clear
            </Button>
          </div>
        )}

        {status === "probing" && file ? (
          <StageCard file={file} stageProgress={stageProgress} />
        ) : null}

        {status === "encoding" ? (
          <div className="rounded-xl border border-border bg-card/50 p-4 backdrop-blur" role="status">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Encoding {currentLabel}…
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                Variant {Math.max(1, currentIndex + 1)}/3 ·{" "}
                {Math.round(variantProgress.reduce((sum, v) => sum + v, 0) / variantProgress.length)}% overall
              </p>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-label="Overall encoding progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(variantProgress.reduce((sum, v) => sum + v, 0) / variantProgress.length)}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${variantProgress.reduce((sum, v) => sum + v, 0) / variantProgress.length}%` }}
              />
            </div>
            <ul className="mt-3 space-y-1.5">
              {(() => {
                const anchor = aiPlan?.crf ?? 27;
                return [
                  { label: `H.264 · CRF ${Math.max(16, anchor - 5)} · high quality` },
                  { label: `H.264 · CRF ${Math.min(35, anchor)} · balanced` },
                  { label: `VP9 · CRF ${Math.min(50, anchor + 8)} · smallest` },
                ];
              })().map((variant, index) => {
                const progressValue = variantProgress[index] ?? 0;
                const isActive = index === currentIndex;
                return (
                  <li key={variant.label} className="text-[11px] text-muted-foreground">
                    <span className="mb-0.5 flex items-center justify-between gap-2">
                      <span className={cn(isActive && "text-foreground")}>{variant.label}</span>
                      <span className="tabular-nums">{Math.round(progressValue)}%</span>
                    </span>
                    <span
                      className="block h-1.5 overflow-hidden rounded-full bg-secondary"
                      role="progressbar"
                      aria-label={`Encoding ${variant.label}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(progressValue)}
                    >
                      <span
                        className={cn("block h-full rounded-full transition-[width] duration-300", isActive ? "bg-primary" : "bg-primary/60")}
                        style={{ width: `${Math.min(100, progressValue)}%` }}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {results.length > 0 ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <figure className="overflow-hidden rounded-xl border border-border bg-card/50 backdrop-blur">
                <div className="border-b border-border/60 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Original
                </div>
                <video
                  className="aspect-video w-full bg-black object-contain"
                  src={URL.createObjectURL(file!)}
                  autoPlay
                  loop
                  muted
                  playsInline
                  controls
                />
              </figure>
              <figure className="overflow-hidden rounded-xl border border-primary/30 bg-card/50 backdrop-blur">
                <div className="flex items-center justify-between border-b border-primary/30 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-primary">
                  Encoded · {results[activeIndex]?.label}
                </div>
                <video
                  key={activeIndex}
                  className="aspect-video w-full bg-black object-contain"
                  src={results[activeIndex]?.previewUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  controls
                />
              </figure>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card/50 backdrop-blur">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                <span className="text-sm font-medium">Size / quality table</span>
                <div className="flex gap-1">
                  {results.map((result, index) => (
                    <button
                      key={result.label}
                      onClick={() => setActiveIndex(index)}
                      className={cn(
                        "rounded-md px-2 py-1 text-[11px] transition-colors",
                        activeIndex === index ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {result.codec.toUpperCase()} {result.crf}
                    </button>
                  ))}
                </div>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-left text-muted-foreground">
                    <th className="px-4 py-2">Variant</th>
                    <th className="px-4 py-2">Size</th>
                    <th className="px-4 py-2">Saved</th>
                    <th className="px-4 py-2">Encode</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {results.map((result) => (
                    <tr key={result.label} className="border-b border-border/40 last:border-0">
                      <td className="px-4 py-2">{result.label}{result === best ? " ★" : ""}</td>
                      <td className="px-4 py-2 tabular-nums">{(result.bytes / 1024 / 1024).toFixed(2)} MB</td>
                      <td className="px-4 py-2 tabular-nums text-success">
                        {metadata && metadata.fileSize ? Math.round((1 - result.bytes / metadata.fileSize) * 100) : 0}%
                      </td>
                      <td className="px-4 py-2 tabular-nums">{result.seconds.toFixed(1)}s</td>
                      <td className="px-4 py-2">
                        <Button size="sm" variant="ghost" onClick={() => download(result)}>
                          <ArrowDownToLine className="size-4" aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>

      <aside className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-card/50 p-4 text-xs text-muted-foreground backdrop-blur">
          <h3 className="text-sm font-medium text-foreground">Split-screen A/B compare</h3>
          <p className="mt-2 leading-snug">
            The left pane shows the original; the right pane shows the selected encode. Drag the divider to compare artifacts at 100% scale.
          </p>
        </div>

        {capabilities && file ? (
          <Button onClick={runCompare} disabled={status === "encoding"} className="mt-auto">
            {status === "probing" && file ? (
          <StageCard file={file} stageProgress={stageProgress} />
        ) : null}

        {status === "encoding" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <FileVideo className="size-4" aria-hidden />
            )}
            {status === "encoding" ? "Encoding variants…" : "Encode 3 variants"}
          </Button>
        ) : null}

        {status === "probing" && file ? (
          <StageCard file={file} stageProgress={stageProgress} />
        ) : null}

        {status === "encoding" ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="self-start rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
          >
            <XCircle className="mr-1 inline size-3.5" aria-hidden />
            Cancel
          </button>
        ) : null}

        {best ? (
          <div className="rounded-xl border border-border bg-card/50 p-4 backdrop-blur">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="size-4 text-success" aria-hidden />
              Recommendation
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {best.label} is the smallest viable variant at ~{Math.round((1 - best.bytes / (metadata?.fileSize ?? 1)) * 100)}% savings. H.264 23 often wins on compatibility; VP9 30 on pure size.
            </p>
          </div>
        ) : null}
      </aside>
    </section>
  );
}