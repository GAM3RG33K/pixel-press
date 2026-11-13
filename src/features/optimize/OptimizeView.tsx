import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  ArrowDownToLine,
  ArrowLeft,
  FileVideo,
  Loader2,
  ScanSearch,
  Square,
  Trash2,
  Zap,
} from "lucide-react";
import type { VideoMetadata } from "@/types/media";
import { Button } from "@/components/ui/button";
import { getFfmpegService } from "@/lib/ffmpeg/service";
import { isNativeEngine, nativeProbe, nativeEncode, nativeEncodeFile } from "@/lib/ffmpeg/native-engine";
import { isTauri, tauriApi, checkLlm } from "@/lib/tauri";
import { parseFfprobeJson } from "@/lib/ffmpeg/ffprobe-parser";
import { useAiMode } from "@/lib/ai/use-ai-mode";
import { resolveRecipe } from "@/lib/ai/plan";
import { PlanReview } from "@/components/plan-review";
import { ModelRequiredModal } from "@/components/model-required-modal";
import { useUserPresets } from "@/lib/use-user-presets";
import type { EncodeRecipe, RecipeSources } from "@/lib/ffmpeg/recipe";
import { diag, captureError } from "@/lib/diagnostics";
import { cn } from "@/lib/utils";
import { Marquee } from "@/components/marquee";
import { etaFromProgress, formatRemaining } from "@/lib/format";
import { logBeforeAfter } from "@/lib/compare-log";
import { registerTask, updateTask, completeTask, failTask, cancelTask } from "@/lib/tasks/registry";
import { estimateSizeBytes } from "@/lib/workflow";
import { parseIntentConstraints, resolveOutputContainer, extensionFor } from "@/lib/ffmpeg/recipe";
import { isModelCached } from "@/lib/ai/webllm";

interface OptimizeCandidate {
  /** Browser flow only: the picked File. */
  file?: File | undefined;
  filePath: string;
  /** Tauri flow: absolute path on disk. */
  absolutePath?: string;
  /** Tauri flow: path relative to the picked folder root. */
  relPath?: string;
  size: number;
  name: string;
  tagIndex: number;
  line: number;
  sourceFilePath: string;
  /** File media kind if this is actually a binary video file. */
  kind: "video" | "source-ref";
  /** Optional metadata if we probed this file. */
  metadata?: VideoMetadata | undefined;
  status: "pending" | "encoding" | "done" | "failed" | "skipped";
  /** 0–100 while encoding (real-time from encoder output). */
  progress?: number | undefined;
  /** When the current encode started (for remaining-time estimates). */
  encodeStartedAt?: number | undefined;
  outputFileName?: string | undefined;
  outputBlob?: Blob | undefined;
  /** Tauri flow: absolute path of the produced file. */
  outputAbsPath?: string;
  error?: string | undefined;
}

export function OptimizeView({
  onBack,
  initialFolder,
  folderNonce = 0,
}: {
  onBack?: () => void;
  /** Routed from the press home: the dropped folder or loose files. */
  initialFolder?: { files?: File[]; tauriPath?: string; tauriPaths?: string[] } | null;
  folderNonce?: number;
} = {}) {
  const [candidates, setCandidates] = useState<OptimizeCandidate[]>([]);
  const [checkUp, setCheckUp] = useState<"idle" | "running" | "done">("idle");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [optimizeIntent, setOptimizeIntent] = useState("");
  const [pickedDir, setPickedDir] = useState<string | null>(null);
  const [outputRoot, setOutputRoot] = useState<string | null>(null);
  const pickedDirRef = useRef<string | null>(null);
  const outputRootRef = useRef<string | null>(null);
  const aiMode = useAiMode();
  const { presets: userPresets, advancedMode, setAdvancedMode, applyPreset, savePreset, deletePreset } = useUserPresets();
  const [recipeResult, setRecipeResult] = useState<import("@/lib/ai/plan").ResolvedRecipeResult | null>(null);
  const [override, setOverride] = useState<{ recipe: EncodeRecipe; sources: RecipeSources } | null>(null);
  const [showModelModal, setShowModelModal] = useState(false);
  const bestEffortRef = useRef(false);
  const batchStartedAtRef = useRef<number | null>(null);
  const pendingModelActionRef = useRef<(() => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Set when the user cancels a bulk run; checked between queue iterations. */
  const bulkCancelledRef = useRef(false);
  /** Registry batch task id + counters for a bulk run (null for single-file encodes). */
  const batchTaskRef = useRef<string | null>(null);
  const batchDoneRef = useRef(0);
  const batchTotalRef = useRef(0);
  const batchFailedRef = useRef(0);

  const loadFromPath = useCallback(async (dir: string) => {
    if (!isTauri()) return;
    pickedDirRef.current = dir;
    setPickedDir(dir);
    outputRootRef.current = null;
    setOutputRoot(null);

    const entries = await tauriApi.fsReadDir(dir);
    const sep = dir.includes(String.fromCharCode(92)) ? String.fromCharCode(92) : "/";
    const normDir = dir.endsWith(sep) ? dir : dir + sep;
    const videos = entries.filter(
      (entry) => entry.kind === "file" && /\.(mp4|webm|mov|mkv|avi)$/i.test(entry.path),
    );
    const built: OptimizeCandidate[] = videos.map((entry) => {
      const rel = entry.path.startsWith(normDir) ? entry.path.slice(normDir.length) : entry.path;
      const name = entry.path.split(/[/\\]/).pop() ?? entry.path;
      return {
        filePath: rel,
        relPath: rel,
        absolutePath: entry.path,
        size: entry.size,
        name,
        tagIndex: 0,
        line: 1,
        sourceFilePath: "local asset",
        kind: "video" as const,
        status: "pending" as const,
      };
    });
    bulkCancelledRef.current = false;
    setCheckUp("idle");
    setCandidates(built);
  }, []);

  const loadFromPaths = useCallback(async (paths: string[]) => {
    const built: OptimizeCandidate[] = [];
    for (const p of paths) {
      const name = p.split(/[/\\]/).pop() ?? p;
      let size = 0;
      try {
        const stat = await (await import("@tauri-apps/plugin-fs")).stat?.(p);
        size = Number(stat?.size ?? 0);
      } catch {
        size = 0;
      }
      built.push({
        filePath: name,
        relPath: name,
        absolutePath: p,
        size,
        name,
        tagIndex: 0,
        line: 1,
        sourceFilePath: "local asset",
        kind: "video" as const,
        status: "pending" as const,
      });
    }
    bulkCancelledRef.current = false;
    setCheckUp("idle");
    setCandidates(built);
  }, []);

  // Route from the press home: dropped folder / loose files load once per route.
  const lastFolderNonceRef = useRef(0);
  useEffect(() => {
    if (!initialFolder || lastFolderNonceRef.current === folderNonce) return;
    lastFolderNonceRef.current = folderNonce;
    if (initialFolder.tauriPath) {
      loadFromPath(initialFolder.tauriPath).catch((caught: unknown) => {
        const normalized = captureError(caught);
        diag.error('optimize', `native directory scan failed: ${normalized.message}`, { stack: normalized.stack });
        setError(`Could not scan folder: ${normalized.message}`);
      });
      return;
    }
    if (initialFolder.tauriPaths?.length) {
      void loadFromPaths(initialFolder.tauriPaths);
      return;
    }
    if (initialFolder.files?.length) collectCandidates(initialFolder.files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFolder, folderNonce, loadFromPath, loadFromPaths]);

  const handleDirectory = useCallback(async () => {
    if (isTauri()) {
      try {
        const dir = await tauriApi.pickFolder();
        if (!dir) return;
        await loadFromPath(dir);
        return;
      } catch (caught) {
        const normalized = captureError(caught);
        diag.error('optimize', `native directory scan failed: ${normalized.message}`, { stack: normalized.stack });
        setError(`Could not scan folder: ${normalized.message}`);
        return;
      }
    }

    const picker = (window as unknown as {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;

    if (!picker) {
      const input = document.getElementById("optimize-directory-input") as HTMLInputElement | null;
      input?.click();
      return;
    }

    try {
      const handle = await picker();
      const collected: File[] = [];
      async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
        for await (const [name, child] of (dir as FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
          if (child.kind === "file") {
            const file = await (child as FileSystemFileHandle).getFile();
            // @ts-expect-error – webkitRelativePath is read-only in TS lib
            file.webkitRelativePath = `${prefix}${name}`;
            collected.push(file);
          } else if (child.kind === "directory") {
            await walk(child as FileSystemDirectoryHandle, `${prefix}${name}/`);
          }
        }
      }
      await walk(handle, "");
      collectCandidates(collected);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        diag.info('optimize', 'directory pick aborted by user');
        return;
      }
      const normalized = captureError(caught);
      diag.error('optimize', `directory open failed: ${normalized.message}`, { stack: normalized.stack });
      setError(`Could not open directory: ${normalized.message}`);
    }
  }, []);

  const collectCandidates = useCallback((incoming: File[]) => {
    // Map video files by path
    const videos = new Map<string, File>();
    for (const f of incoming) {
      if (/\.(mp4|webm|mov|mkv|avi)$/i.test(f.name)) {
        videos.set(f.webkitRelativePath || f.name, f);
      }
    }

    const candidates: OptimizeCandidate[] = [];
    for (const [path, f] of videos.entries()) {
      candidates.push({
        file: f,
        filePath: path,
        size: f.size,
        name: f.name,
        tagIndex: 0,
        line: 1,
        sourceFilePath: "local asset",
        kind: "video",
        status: "pending",
      });
    }

    bulkCancelledRef.current = false;
    setCheckUp("idle");
    setCandidates(candidates);
  }, []);

  // Display recipe for the review table — resolved from the first probed candidate.
  // Encode resolves per file (AI may tailor per file); user hand-edits/presets apply uniformly via `override`.
  const firstProbed = useMemo(() => candidates.find((c) => c.metadata)?.metadata ?? null, [candidates]);
  useEffect(() => {
    if (!firstProbed) {
      setRecipeResult(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      resolveRecipe(firstProbed, optimizeIntent.trim() || undefined, aiMode).then((result) => {
        if (!cancelled) setRecipeResult(result);
      });
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [firstProbed, optimizeIntent, aiMode]);

  // Intent edit releases the preset/hand-edit override
  const lastOptimizeIntentRef = useRef(optimizeIntent);
  useEffect(() => {
    if (lastOptimizeIntentRef.current !== optimizeIntent) {
      lastOptimizeIntentRef.current = optimizeIntent;
      setOverride(null);
      bestEffortRef.current = false;
    }
  }, [optimizeIntent]);

  const effectiveRecipe: EncodeRecipe = override?.recipe ?? recipeResult?.recipe ?? {
    targetCodec: "h264",
    crf: 26,
    outputContainer: "auto",
    audioHandling: "copy",
    subtitleHandling: { mode: "copy" },
    stripMetadata: false,
    faststart: true,
  };
  const effectiveSources: RecipeSources = override?.sources ?? recipeResult?.sources ?? {};

  /** Folder Check-Up: probe every candidate so rows can show codec/res/bitrate and an estimated saving. */
  const runCheckUp = useCallback(async () => {
    setCheckUp("running");
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (!candidate || candidate.metadata) continue;
      try {
        let metadata: VideoMetadata | null = null;
        if (candidate.absolutePath && isTauri()) {
          const raw = await tauriApi.ffprobeJson(candidate.absolutePath);
          metadata = parseFfprobeJson(raw, candidate.name, candidate.size);
        } else if (candidate.file) {
          if (isNativeEngine()) {
            const probe = await nativeProbe(candidate.file, candidate.name);
            metadata = probe.metadata;
          } else {
            const probe = await getFfmpegService().probe({ input: candidate.file, fileName: candidate.name });
            metadata = probe.metadata;
          }
        }
        const found = metadata;
        if (found) {
          setCandidates((prev) =>
            prev.map((c, idx) => (idx === i ? { ...c, metadata: found } : c)),
          );
        }
      } catch (caught) {
        diag.warn("optimize.checkup", "probe failed for candidate", {
          index: i,
          error: caught instanceof Error ? caught.message : String(caught),
        });
      }
    }
    setCheckUp("done");
  }, [candidates]);

  /** True when intent demands beyond rule-engine coverage and no local model is available. */
  const shouldAskForModel = useCallback(async (): Promise<boolean> => {
    if (bestEffortRef.current || override) return false;
    const constraints = parseIntentConstraints(optimizeIntent.trim(), null);
    if (!constraints.unhandled) return false;
    if (aiMode === "rule-engine") return true;
    try {
      if (isTauri()) {
        const status = await checkLlm("smollm2-360m");
        return !status.ready;
      }
      return !(await isModelCached("smollm2-360m"));
    } catch {
      return true;
    }
  }, [aiMode, optimizeIntent, override]);

  const optimizeOne = useCallback(async (index: number, bulk: boolean = false): Promise<void> => {
    const candidate = candidates[index];
    if (!candidate) return;

    let singleTaskId: string | null = null;
    if (!bulk && !batchTaskRef.current) {
      singleTaskId = registerTask({
        workbench: "optimize",
        label: `Optimize · ${candidate.name}`,
        stage: "Encoding…",
        progress: 0,
        cancel: () => abortRef.current?.abort(),
      });
    }
    const activeTaskId = batchTaskRef.current ?? singleTaskId;

    if (await shouldAskForModel()) {
      pendingModelActionRef.current = () => void optimizeOne(index, bulk);
      setShowModelModal(true);
      return;
    }
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const setItemProgress = (progress: number) => {
      const clamped = Math.max(0, Math.min(100, progress));
      if (activeTaskId) {
        if (batchTaskRef.current) {
          const total = batchTotalRef.current || 1;
          const overall = Math.round(((batchDoneRef.current + clamped / 100) / total) * 100);
          updateTask(activeTaskId, {
            stage: `${batchDoneRef.current + 1} of ${total} · ${candidate.name}`,
            progress: overall,
          });
        } else {
          updateTask(activeTaskId, { progress: clamped, stage: `Encoding ${candidate.name}` });
        }
      }
      setCandidates((prev) =>
        prev.map((c, i) => (i === index ? { ...c, progress: clamped } : c)),
      );
    };

    try {
      setCandidates((prev) =>
        prev.map((c, i) =>
          i === index ? { ...c, status: "encoding" as const, progress: 0, encodeStartedAt: Date.now() } : c,
        ),
      );

      const fileName = candidate.name;
      const base = fileName.replace(/\.[^./]+$/, "");
      const useNative = isNativeEngine();
      const isFileMode = useNative && Boolean(candidate.absolutePath);

      // Probe duration up front so percent progress is accurate (native ffprobe when available).
      let durationSeconds = 3;
      let metadata: import("@/types/media").VideoMetadata | null = null;
      try {
        if (isFileMode) {
          const absPath = candidate.absolutePath!;
          const raw = await tauriApi.ffprobeJson(absPath);
          metadata = parseFfprobeJson(raw, fileName, candidate.size);
          durationSeconds = Math.max(0.1, metadata.duration);
        } else if (useNative && candidate.file) {
          const probe = await nativeProbe(candidate.file, fileName);
          metadata = probe.metadata;
          durationSeconds = Math.max(0.1, probe.metadata.duration);
        } else if (candidate.file) {
          const probe = await getFfmpegService().probe({
            input: candidate.file,
            fileName,
            signal: abortRef.current.signal,
          });
          metadata = probe.metadata;
          durationSeconds = Math.max(0.1, probe.metadata.duration);
        }
      } catch (probeError) {
        diag.warn("optimize", "duration probe failed — progress will be approximate", {
          index,
          error: probeError instanceof Error ? probeError.message : String(probeError),
        });
      }

      // AI (when enabled) decides the recipe per file; rule engine otherwise.
      let codec: "h264" | "vp9" | "h265" = "h264";
      let crf = 26;
      let recipe: EncodeRecipe = {
        targetCodec: "h264",
        crf: 26,
        outputContainer: "auto",
        audioHandling: "strip",
        subtitleHandling: { mode: "copy" },
        stripMetadata: false,
        faststart: true,
      };
      if (metadata) {
        if (override) {
          recipe = { ...override.recipe };
        } else {
          const resolved = await resolveRecipe(metadata, optimizeIntent.trim() || undefined, aiMode);
          recipe = resolved.recipe;
        }
        codec = recipe.targetCodec === "vp9" ? "vp9" : recipe.targetCodec === "h265" ? "h265" : "h264";
        crf = recipe.crf;
      }
      const subIndices =
        recipe.subtitleHandling.mode === "only" && metadata
          ? (metadata.subtitleStreams ?? [])
              .filter((s) =>
                recipe.subtitleHandling.mode === "only" &&
                recipe.subtitleHandling.languages.includes((s.lang ?? "").toLowerCase()),
              )
              .map((s) => s.index)
          : undefined;
      const effectiveDuration =
        recipe.trimEnd !== undefined
          ? Math.max(0.1, recipe.trimEnd - (recipe.trimStart ?? 0))
          : durationSeconds;
      const recipeContainer = resolveOutputContainer(recipe, metadata);
      const ext = recipeContainer === "auto" ? (codec === "vp9" ? "webm" : "mp4") : extensionFor(recipeContainer);
      const faststart = recipe.faststart && (ext === "mp4" || ext === "mov");
      const planOutputName = `${base}_optimized.${ext}`;

      if (isFileMode) {
        // Bulk: folder mirror (pixel-pressed-{timestamp}/). Single: file_optimized.ext next to the source.
        const rel = candidate.relPath ?? fileName;
        const relDirOf = (p: string) =>
          p.includes("/")
            ? p.slice(0, p.lastIndexOf("/"))
            : p.includes(String.fromCharCode(92))
              ? p.slice(0, p.lastIndexOf(String.fromCharCode(92)))
              : "";
        let outAbsPath: string;
        let displayOut = planOutputName;
        const getFinalPath = async (p: string) => {
          const { invoke } = await import("@tauri-apps/api/core");
          return invoke<string>("next_available_path", { path: p });
        };
        if (bulk) {
          const root = ensurePixelPressedRoot(pickedDirRef.current, outputRootRef.current);
          outputRootRef.current = root;
          setOutputRoot(root);
          outAbsPath = await getFinalPath(joinRelative(root, rel, planOutputName));
          const relDir = relDirOf(rel);
          const finalName = outAbsPath.split(/[/\\]/).pop() ?? planOutputName;
          displayOut = relDir ? `${relDir}/${finalName}` : finalName;
        } else {
          const absPath = candidate.absolutePath!;
          const dir = absPath.includes(String.fromCharCode(92))
            ? absPath.slice(0, absPath.lastIndexOf(String.fromCharCode(92)))
            : absPath.slice(0, absPath.lastIndexOf("/"));
          const sep = absPath.includes(String.fromCharCode(92)) ? String.fromCharCode(92) : "/";
          outAbsPath = await getFinalPath(`${dir}${sep}${planOutputName}`);
          displayOut = outAbsPath.split(/[/\\]/).pop() ?? planOutputName;
        }
        const done = await nativeEncodeFile({
          inputPath: candidate.absolutePath!,
          outputPath: outAbsPath,
          codec,
          crf,
          durationSeconds: effectiveDuration,
          stripAudio: recipe.audioHandling === "strip",
          audioHandling: recipe.audioHandling,
          subtitleHandling: recipe.subtitleHandling,
          ...(subIndices !== undefined ? { subtitleStreamIndices: subIndices } : {}),
          stripMetadata: recipe.stripMetadata,
          ...(recipe.trimStart !== undefined ? { trimStart: recipe.trimStart } : {}),
          ...(recipe.trimEnd !== undefined ? { trimEnd: recipe.trimEnd } : {}),
          faststart,
          signal: abortRef.current.signal,
          onProgress: setItemProgress,
        });
        const encodedBytes = await (await import("@tauri-apps/plugin-fs")).readFile(outAbsPath);
        logBeforeAfter({
          label: `Optimize · ${candidate.name}`,
          inputFileName: candidate.name,
          inputBytes: candidate.size,
          outputBytes: encodedBytes.byteLength,
          codec,
          crf,
          container: ext,
          encodeMs: done.durationMs,
          metadata: metadata ?? candidate.metadata ?? null,
          outputScale: recipe.targetScale,
          audioHandling: recipe.audioHandling,
          subtitleHandling: recipe.subtitleHandling,
          stripMetadata: recipe.stripMetadata,
        });
        if (batchTaskRef.current) {
          batchDoneRef.current += 1;
          updateTask(batchTaskRef.current, {
            stage: `${batchDoneRef.current} of ${batchTotalRef.current} · done`,
          });
        } else if (singleTaskId) {
          completeTask(singleTaskId);
        }
        setCandidates((prev) =>
          prev.map((c, i) =>
            i === index
              ? { ...c, status: "done" as const, progress: 100, outputFileName: displayOut, outputAbsPath: outAbsPath, outputBlob: new Blob([encodedBytes.buffer as ArrayBuffer]) }
              : c,
          ),
        );
        diag.info("optimize", "file encoded to pixel-pressed folder", { input: candidate.absolutePath, output: outAbsPath });
        return;
      }

      const encodeArgs = {
        input: candidate.file as Blob,
        inputFileName: fileName,
        outputFileName: planOutputName,
        codec,
        crf,
        durationSeconds: effectiveDuration,
        stripAudio: recipe.audioHandling === "strip",
        audioHandling: recipe.audioHandling,
        subtitleHandling: recipe.subtitleHandling,
        ...(subIndices !== undefined ? { subtitleStreamIndices: subIndices } : {}),
        stripMetadata: recipe.stripMetadata,
        ...(recipe.trimStart !== undefined ? { trimStart: recipe.trimStart } : {}),
        ...(recipe.trimEnd !== undefined ? { trimEnd: recipe.trimEnd } : {}),
        faststart,
        signal: abortRef.current.signal,
      };

      const encoded = useNative
        ? await nativeEncode({ ...encodeArgs, onProgress: setItemProgress })
        : await getFfmpegService().encode({
            ...encodeArgs,
            onProgress: ({ progress }: { progress: number }) => setItemProgress(progress),
          });

      const MIME: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", webm: "video/webm", avi: "video/x-msvideo" };
      logBeforeAfter({
        label: `Optimize · ${candidate.name}`,
        inputFileName: candidate.name,
        inputBytes: candidate.size,
        outputBytes: encoded.data.byteLength,
        codec,
        crf,
        container: ext,
        encodeMs: encoded.durationMs,
        metadata: metadata ?? candidate.metadata ?? null,
        outputScale: recipe.targetScale,
        audioHandling: recipe.audioHandling,
        subtitleHandling: recipe.subtitleHandling,
        stripMetadata: recipe.stripMetadata,
      });
      const blob = new Blob([encoded.data as Uint8Array<ArrayBuffer>], { type: MIME[ext] ?? "video/mp4" });
      if (batchTaskRef.current) {
        batchDoneRef.current += 1;
        updateTask(batchTaskRef.current, {
          stage: `${batchDoneRef.current} of ${batchTotalRef.current} · done`,
        });
      } else if (singleTaskId) {
        completeTask(singleTaskId);
      }
      setCandidates((prev) =>
        prev.map((c, i) =>
          i === index
            ? { ...c, status: "done" as const, progress: 100, outputFileName: planOutputName, outputBlob: blob }
            : c,
        ),
      );
    } catch (caught) {
      const aborted =
        (caught instanceof DOMException && caught.name === "AbortError") ||
        (caught instanceof Error && /abort/i.test(caught.message));
      if (aborted) {
        diag.info("optimize", "candidate encode cancelled", { index });
        setCandidates((prev) =>
          prev.map((c, i) =>
            i === index ? { ...c, status: "skipped" as const, progress: undefined } : c,
          ),
        );
        if (batchTaskRef.current) {
          batchDoneRef.current += 1;
        } else if (singleTaskId) {
          cancelTask(singleTaskId);
        }
        return;
      }
      const normalized = captureError(caught);
      const message = normalized.message;
      if (batchTaskRef.current) {
        batchFailedRef.current += 1;
        batchDoneRef.current += 1;
      } else if (singleTaskId) {
        failTask(singleTaskId, message);
      }
      diag.error('optimize', `candidate encode failed: ${normalized.message}`, {
        index,
        stack: normalized.stack,
      });
      setCandidates((prev) =>
        prev.map((c, i) =>
          i === index ? { ...c, status: "failed" as const, progress: undefined, error: message } : c,
        ),
      );
    }
  }, [candidates, aiMode, override, optimizeIntent, shouldAskForModel]);

  const optimizeAll = useCallback(async () => {
    const ask = await shouldAskForModel();
    if (ask) {
      pendingModelActionRef.current = () => void optimizeAll();
      setShowModelModal(true);
      return;
    }
    bulkCancelledRef.current = false;
    batchStartedAtRef.current = Date.now();
    setWorking(true);
    setError(null);
    const pendingCountLocal = candidates.filter(
      (c) => c.status === "pending" || c.status === "skipped" || c.status === "failed",
    ).length;
    batchDoneRef.current = 0;
    batchFailedRef.current = 0;
    batchTotalRef.current = pendingCountLocal;
    batchTaskRef.current = registerTask({
      workbench: "optimize",
      label: "Optimize · batch",
      stage: `0 of ${pendingCountLocal} · starting…`,
      progress: 0,
      cancel: () => cancelAll(),
    });
    try {
      for (let i = 0; i < candidates.length; i += 1) {
        if (bulkCancelledRef.current) {
          diag.info("optimize", "bulk run cancelled by user");
          break;
        }
        const st = candidates[i]?.status;
        if (st !== "pending" && st !== "skipped" && st !== "failed") continue;
        await optimizeOne(i, true);
        // Trigger a fresh scan by fresh identity
        setCandidates((prev) => [...prev]);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      const id = batchTaskRef.current;
      batchTaskRef.current = null;
      if (id) {
        if (bulkCancelledRef.current) cancelTask(id);
        else if (batchFailedRef.current > 0) failTask(id, `${batchFailedRef.current} file(s) failed`);
        else completeTask(id);
      }
      setWorking(false);
    }
  }, [candidates, optimizeOne, shouldAskForModel]);

  const cancelCurrent = useCallback(() => {
    diag.info("optimize", "cancel requested for current encode");
    abortRef.current?.abort();
  }, []);

  const cancelAll = useCallback(() => {
    bulkCancelledRef.current = true;
    diag.info("optimize", "cancel-all requested");
    abortRef.current?.abort();
  }, []);

  const downloadZip = useCallback(async () => {
    setZipping(true);
    const zipTaskId = registerTask({
      workbench: "optimize",
      label: "Optimize · packaging zip",
      stage: "Writing zip bundle…",
      progress: null,
      cancel: null,
    });
    try {
      const zip = new JSZip();
      // Manifest of optimizations for the developer to reconcile
      const manifest: string[] = [];
      let totalInBytes = 0;
      let totalOutBytes = 0;

      for (const c of candidates) {
        totalInBytes += c.size;
        const outName = c.outputFileName ?? `${c.name.replace(/\.[^./]+$/, "")}_optimized.mp4`;
        if (c.outputBlob) {
          totalOutBytes += c.outputBlob.size;
          zip.file(outName, c.outputBlob);
          manifest.push(
            `${c.filePath}\n  -> ${outName} (${c.size}B -> ${c.outputBlob.size}B)`,
          );
        }
      }

      zip.file(
        "optimization-report.txt",
        [
          "pixel-press — optimization report",
          `Total inputs: ${candidates.length}`,
          `Total size before: ${(totalInBytes / 1024 / 1024).toFixed(1)} MB`,
          `Total size after:  ${(totalOutBytes / 1024 / 1024).toFixed(1)} MB`,
          `Estimated saving:  ${totalInBytes > 0 ? Math.round((1 - totalOutBytes / totalInBytes) * 100) : 0}%`,
          "",
          "Per-file detail:",
          ...manifest,
        ].join("\n"),
      );

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "pixel-press-optimized-bundle.zip";
      anchor.click();
      URL.revokeObjectURL(url);
      completeTask(zipTaskId);
    } catch (caught) {
      const normalized = captureError(caught);
      failTask(zipTaskId, normalized.message);
      diag.error('optimize', `zip creation failed: ${normalized.message}`, { stack: normalized.stack });
      setError(`Could not create zip: ${normalized.message}`);
    } finally {
      setZipping(false);
    }
  }, [candidates]);

  const totalBytes = useMemo(() => candidates.reduce((acc, c) => acc + c.size, 0), [candidates]);
  const doneBytes = useMemo(() => candidates.reduce((acc, c) => acc + (c.outputBlob?.size ?? 0), 0), [candidates]);
  const doneCount = candidates.filter((c) => c.status === "done").length;
  const finishedCount = candidates.filter(
    (c) => c.status === "done" || c.status === "failed" || c.status === "skipped",
  ).length;
  const overallProgress = candidates.length
    ? candidates.reduce(
        (sum, c) =>
          sum +
          (c.status === "done" || c.status === "failed" || c.status === "skipped"
            ? 100
            : c.status === "encoding"
              ? c.progress ?? 0
              : 0),
        0,
      ) / candidates.length
    : 0;
  const pendingCount = candidates.filter(
    (c) => c.status === "pending" || c.status === "encoding" || c.status === "skipped" || c.status === "failed",
  ).length;

  return (
    <section aria-labelledby="optimize-view" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
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
        <h2 id="optimize-view" className="text-lg font-semibold tracking-tight">
          Folder shrink
        </h2>
        <p className="text-sm text-muted-foreground">
          Run the Check-Up to see what each video is made of, then press them all in one pass. Output mirrors the folder into <code className="font-mono">pixel-pressed-…/</code> next to the source.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleDirectory} disabled={working}>
            <FileVideo className="size-4" aria-hidden />
            Choose folder
          </Button>
          {showModelModal ? (
          <ModelRequiredModal
            intent={optimizeIntent}
            onModelReady={() => {
              setShowModelModal(false);
              bestEffortRef.current = false;
              const action = pendingModelActionRef.current;
              pendingModelActionRef.current = null;
              action?.();
            }}
            onBestEffort={() => {
              setShowModelModal(false);
              bestEffortRef.current = true;
              const action = pendingModelActionRef.current;
              pendingModelActionRef.current = null;
              action?.();
            }}
            onCancel={() => setShowModelModal(false)}
          />
        ) : null}

        {candidates.length > 0 ? (
            <Button variant="secondary" onClick={() => void runCheckUp()} disabled={working || checkUp === "running"}>
              {checkUp === "running"
                ? <Loader2 className="size-4 animate-spin" aria-hidden />
                : <ScanSearch className="size-4" aria-hidden />}
              {checkUp === "running" ? "Checking…" : checkUp === "done" ? "Check-Up refreshed" : "Run folder Check-Up"}
            </Button>
          ) : null}
          <input
            id="optimize-directory-input"
            type="file"
            // @ts-expect-error – webkitdirectory is non-standard but HTML standard
            webkitdirectory=""
            multiple
            className="sr-only"
            onChange={(event) => {
              const list = event.currentTarget.files;
              if (!list) return;
              const collected = Array.from(list);
              collectCandidates(collected);
            }}
          />
          {candidates.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {pickedDir ? (
                <Marquee title={pickedDir} className="mr-2 max-w-[520px] font-mono text-[10px] text-muted-foreground/80">{pickedDir}</Marquee>
              ) : null}
              {candidates.length} video(s) found · {(totalBytes / 1024 / 1024).toFixed(1)} MB total
            </p>
          ) : null}
        </div>

        {outputRoot ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
            <span className="min-w-0 break-all font-mono text-[11px]">{outputRoot}</span>
            <button
              type="button"
              className="ml-auto rounded-md border border-info/40 bg-info/10 px-2 py-1 text-[11px] hover:bg-info/20"
              onClick={() => { void import("@tauri-apps/api/core").then((m) => m.invoke("reveal_path", { path: outputRoot })); }}
            >
              Reveal in Finder
            </button>
          </div>
        ) : null}

        <div className="max-w-xl">
          <label htmlFor="optimize-intent" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Intent (optional — AI picks codec/CRF/audio)
          </label>
          <input
            id="optimize-intent"
            value={optimizeIntent}
            onChange={(event) => setOptimizeIntent(event.target.value)}
            placeholder='e.g. "keep the .mkv, strip audio" or "keep only english subs, smallest file"'
            className="mt-1 w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {firstProbed ? (
          <div className="max-w-xl">
            <PlanReview
              recipe={effectiveRecipe}
              sources={effectiveSources}
              advancedMode={advancedMode}
              onAdvancedModeChange={setAdvancedMode}
              onRecipeChange={(next, changed) =>
                setOverride({ recipe: next, sources: { ...effectiveSources, [changed]: "you" } })
              }
              userPresets={userPresets}
              onApplyPreset={(preset) => setOverride(applyPreset(preset))}
              onDeletePreset={deletePreset}
              onSavePreset={(name) => {
                void savePreset(name, effectiveRecipe);
              }}
              metadata={firstProbed}
              intentNotes={override ? [] : (recipeResult?.intentNotes ?? [])}
            />
            {recipeResult?.error && recipeResult.used === "rule-engine" ? (
              <p className="mt-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning" role="status">
                AI plan unavailable — used the rule engine ({recipeResult.error})
              </p>
            ) : null}
          </div>
        ) : (
          <p className="max-w-xl text-[11px] text-muted-foreground">Run Check-Up to see the plan review table — it shows exactly what will happen before anything encodes.</p>
        )}

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {candidates.length > 0 ? (
          <div className="overflow-hidden press-paper rounded-xl">
            <div className="border-b border-border/60 px-4 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Overall progress</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {finishedCount}/{candidates.length} files · {Math.round(overallProgress)}%
                  {working && batchStartedAtRef.current
                    ? ` · ${formatRemaining(etaFromProgress(batchStartedAtRef.current, overallProgress))}`
                    : ""}
                </span>
              </div>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-label="Overall optimization progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(overallProgress)}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${Math.min(100, overallProgress)}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2">
              <span className="text-sm font-medium">Check-Up list</span>
              <button
                type="button"
                onClick={() => setCandidates([])}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="mr-1 inline size-3" aria-hidden />
                Clear
              </button>
            </div>
            <ul className="max-h-[460px] divide-y divide-border/60 overflow-y-auto">
              {candidates.map((candidate, index) => (
                <li key={candidate.filePath} className="flex flex-wrap items-center gap-3 px-4 py-3 text-xs">
                  <span className="flex-1 min-w-0">
                    <Marquee title={candidate.filePath} className="font-mono text-[11px]">{candidate.filePath}</Marquee>
                    <p className="mt-0.5 tabular-nums text-muted-foreground">
                      {(candidate.size / 1024 / 1024).toFixed(1)} MB
                      {candidate.metadata ? ` · ${candidate.metadata.videoCodec} · ${candidate.metadata.width}×${candidate.metadata.height} · ${candidate.metadata.bitrate ? `${Math.round(candidate.metadata.bitrate / 1000)} kbps` : ""}` : ""}
                      {candidate.metadata ? ` · ~${Math.max(0, Math.round((1 - estimateSizeBytes(candidate.size, 26, "h264") / candidate.size) * 100))}% savable` : ""}
                    </p>
                    {candidate.status === "encoding" ? (
                      <span className="mt-1.5 block">
                        <span
                          className="block h-1.5 overflow-hidden rounded-full bg-secondary"
                          role="progressbar"
                          aria-label={`Encoding ${candidate.filePath}`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(candidate.progress ?? 0)}
                        >
                          <span
                            className="block h-full rounded-full bg-primary transition-[width] duration-300"
                            style={{ width: `${Math.min(100, candidate.progress ?? 0)}%` }}
                          />
                        </span>
                        <span className="mt-0.5 block text-[10px] tabular-nums text-muted-foreground">
                          {Math.round(candidate.progress ?? 0)}%
                          {" · "}
                          {formatRemaining(etaFromProgress(candidate.encodeStartedAt, candidate.progress))}
                        </span>
                      </span>
                    ) : null}
                  </span>
                  <span className={cn("text-[10px] uppercase tracking-wider", statusTone(candidate.status))}>
                    {candidate.status === "encoding" ? (
                      <>
                        <Loader2 className="mr-1 inline size-3 animate-spin" aria-hidden />
                        encoding
                      </>
                    ) : candidate.status}
                  </span>
                  {candidate.status === "encoding" ? (
                    <Button size="sm" variant="destructive" onClick={cancelCurrent}>
                      <Square className="size-4" aria-hidden />
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={working}
                      onClick={() => {
                        void shouldAskForModel().then((ask) => {
                          if (ask) {
                            pendingModelActionRef.current = () => void optimizeOne(index);
                            setShowModelModal(true);
                          } else {
                            void optimizeOne(index);
                          }
                        });
                      }}
                    >
                      <Zap className="size-4" aria-hidden />
                      Press
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {candidates.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={optimizeAll} disabled={working || pendingCount === 0}>
              {working ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Zap className="size-4" aria-hidden />}
              {working
                ? `Pressing ${finishedCount}/${candidates.length} · ${Math.round(overallProgress)}%`
                : `Press all (${pendingCount} videos)`}
            </Button>
            {working ? (
              <Button variant="destructive" onClick={cancelAll}>
                <Square className="size-4" aria-hidden />
                Cancel all
              </Button>
            ) : null}
            <Button variant="outline" onClick={downloadZip} disabled={zipping || candidates.every((c) => c.status !== "done")}>
              {zipping ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowDownToLine className="size-4" aria-hidden />}
              {zipping ? "Zipping…" : `Download zip bundle`}
            </Button>
          </div>
        ) : null}
      </div>

      <aside className="flex flex-col gap-4">
        <div className="press-paper rounded-xl p-4 text-xs text-muted-foreground">
          <h3 className="text-sm font-medium text-foreground">What you get</h3>
          <ul className="mt-2 space-y-1.5">
            <li>· Optimized <code className="font-mono">.mp4</code> per video in the folder</li>
            <li>· <code className="font-mono">optimization-report.txt</code> with bytes before/after</li>
            <li>· A single <code className="font-mono">pixel-press-optimized-bundle.zip</code></li>
          </ul>
          <p className="mt-3 leading-snug">
            Everything is encoded on this device. Nothing is uploaded.
          </p>
        </div>

        <div className="press-paper rounded-xl p-4 text-xs text-muted-foreground">
          <h3 className="text-sm font-medium text-foreground">Savings estimate</h3>
          <p className="mt-2 tabular-nums text-lg font-semibold text-primary">
            {totalBytes > 0 ? Math.max(0, Math.round((1 - doneBytes / totalBytes) * 100)) : 0}%
          </p>
          <p className="text-[11px] text-muted-foreground">
            based on completed encodes · {doneCount} of {candidates.length} done
          </p>
        </div>

      </aside>
    </section>
  );
}

function ensurePixelPressedRoot(dir: string | null, current: string | null): string {
  if (current) return current;
  const base = dir ?? ".";
  const sep = base.includes(String.fromCharCode(92)) ? String.fromCharCode(92) : "/";
  const trimmed = base.replace(/[\\/]+$/, "");
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${trimmed}${sep}pixel-pressed-${ts}`;
}

function joinRelative(root: string, relPath: string, fileName: string): string {
  const sep = root.includes(String.fromCharCode(92)) ? String.fromCharCode(92) : "/";
  const rel = relPath.replace(/[\\/]+/g, sep);
  const dir = rel.includes(sep) ? rel.slice(0, rel.lastIndexOf(sep)) : "";
  return dir ? `${root}${sep}${dir}${sep}${fileName}` : `${root}${sep}${fileName}`;
}

function statusTone(status: OptimizeCandidate["status"]): string {
  switch (status) {
    case "done": return "text-success";
    case "failed": return "text-destructive";
    case "encoding": return "text-info";
    case "skipped": return "text-warning";
    default: return "text-muted-foreground";
  }
}
