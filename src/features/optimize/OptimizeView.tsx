import { useCallback, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  ArrowDownToLine,
  FileCode2,
  FileVideo,
  Loader2,
  Trash2,
  Zap,
} from "lucide-react";
import type { VideoMetadata } from "@/types/media";
import { Button } from "@/components/ui/button";
import { getFfmpegService } from "@/lib/ffmpeg/service";
import { cn } from "@/lib/utils";
import { buildVideoSnippet } from "@/lib/snippet";

interface OptimizeCandidate {
  file: File;
  filePath: string;
  tagIndex: number;
  line: number;
  sourceFilePath: string;
  /** File media kind if this is actually a binary video file. */
  kind: "video" | "source-ref";
  /** Optional metadata if we probed this file. */
  metadata?: VideoMetadata | undefined;
  status: "pending" | "encoding" | "done" | "failed" | "skipped";
  outputFileName?: string | undefined;
  outputBlob?: Blob | undefined;
  error?: string | undefined;
}

export function OptimizeView() {
  const [candidates, setCandidates] = useState<OptimizeCandidate[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleDirectory = useCallback(async () => {
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
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(`Could not open directory: ${caught instanceof Error ? caught.message : String(caught)}`);
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
        tagIndex: 0,
        line: 1,
        sourceFilePath: "local asset",
        kind: "video",
        status: "pending",
      });
    }

    setCandidates(candidates);
  }, []);

  const optimizeOne = useCallback(async (index: number): Promise<void> => {
    const candidate = candidates[index];
    if (!candidate) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      setCandidates((prev) => prev.map((c, i) => (i === index ? { ...c, status: "encoding" as const } : c)));

      const service = getFfmpegService();
      const base = candidate.file.name.replace(/\.[^./]+$/, "");
      const outputName = `${base}-optimized.mp4`;
      const encoded = await service.encode({
        input: candidate.file,
        inputFileName: candidate.file.name,
        outputFileName: outputName,
        codec: "h264",
        crf: 26,
        durationSeconds: 3,
        stripAudio: true,
        faststart: true,
        signal: abortRef.current.signal,
      });

      const blob = new Blob([encoded.data as Uint8Array<ArrayBuffer>], { type: "video/mp4" });
      setCandidates((prev) =>
        prev.map((c, i) =>
          i === index
            ? { ...c, status: "done" as const, outputFileName: outputName, outputBlob: blob }
            : c,
        ),
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setCandidates((prev) =>
        prev.map((c, i) =>
          i === index ? { ...c, status: "failed" as const, error: message } : c,
        ),
      );
    }
  }, [candidates]);

  const optimizeAll = useCallback(async () => {
    setWorking(true);
    setError(null);
    try {
      for (let i = 0; i < candidates.length; i += 1) {
        if (candidates[i]?.status !== "pending") continue;
        await optimizeOne(i);
        // Trigger a fresh scan by fresh identity
        setCandidates((prev) => [...prev]);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      setWorking(false);
    }
  }, [candidates, optimizeOne]);

  const downloadZip = useCallback(async () => {
    setZipping(true);
    try {
      const zip = new JSZip();
      // Manifest of optimizations for the developer to reconcile
      const manifest: string[] = [];
      let totalInBytes = 0;
      let totalOutBytes = 0;

      for (const c of candidates) {
        totalInBytes += c.file.size;
        if (c.outputBlob) {
          totalOutBytes += c.outputBlob.size;
          zip.file(c.outputFileName ?? `${c.file.name.replace(/\.[^./]+$/, "")}-optimized.mp4`, c.outputBlob);
          manifest.push(
            `${c.filePath}\n  -> ${c.outputFileName} (${c.file.size}B -> ${c.outputBlob.size}B)`,
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

      const snippet = buildVideoSnippet(
        candidates
          .filter((c): c is OptimizeCandidate & { outputFileName: string; outputBlob: Blob } =>
            Boolean(c.outputFileName && c.outputBlob),
          )
          .map((c) => ({
            fileName: c.outputFileName,
            path: `./${c.outputFileName}`,
            container: "mp4",
            sizeBytes: c.outputBlob.size,
          })),
        {
          autoplay: true,
          loop: true,
          preload: "metadata",
        },
      );
      zip.file("video-snippet.html", snippet);
      zip.file("video-snippet.jsx", buildVideoSnippet(
        candidates
          .filter((c): c is OptimizeCandidate & { outputFileName: string; outputBlob: Blob } =>
            Boolean(c.outputFileName && c.outputBlob),
          )
          .map((c) => ({
            fileName: c.outputFileName,
            path: `./${c.outputFileName}`,
            container: "mp4",
            sizeBytes: c.outputBlob.size,
          })),
        {
          autoplay: true,
          loop: true,
          preload: "metadata",
          withJsx: true,
        },
      ));

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "pixel-press-optimized-bundle.zip";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(`Could not create zip: ${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setZipping(false);
    }
  }, [candidates]);

  const totalBytes = useMemo(() => candidates.reduce((acc, c) => acc + c.file.size, 0), [candidates]);
  const doneBytes = useMemo(() => candidates.reduce((acc, c) => acc + (c.outputBlob?.size ?? 0), 0), [candidates]);
  const doneCount = candidates.filter((c) => c.status === "done").length;
  const pendingCount = candidates.filter((c) => c.status === "pending" || c.status === "encoding").length;

  return (
    <section aria-labelledby="optimize-view" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        <h2 id="optimize-view" className="text-lg font-semibold tracking-tight">
          Scan &amp; Optimize
        </h2>
        <p className="text-sm text-muted-foreground">
          Pick your local project folder and batch-encode the videos it references. Download a zip with optimized files, a report, and ready-to-drop snippets.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleDirectory} disabled={working}>
            <FileVideo className="size-4" aria-hidden />
            Choose project folder
          </Button>
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
              {candidates.length} video(s) found · {(totalBytes / 1024 / 1024).toFixed(1)} MB total
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {candidates.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-border bg-card/50 backdrop-blur">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
              <span className="text-sm font-medium">Optimization queue</span>
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
                    <p className="truncate font-mono text-[11px]">{candidate.filePath}</p>
                    <p className="mt-0.5 tabular-nums text-muted-foreground">{(candidate.file.size / 1024 / 1024).toFixed(1)} MB</p>
                  </span>
                  <span className={cn("text-[10px] uppercase tracking-wider", statusTone(candidate.status))}>
                    {candidate.status === "encoding" ? (
                      <>
                        <Loader2 className="mr-1 inline size-3 animate-spin" aria-hidden />
                        encoding
                      </>
                    ) : candidate.status}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={candidate.status === "encoding" || working}
                    onClick={() => optimizeOne(index)}
                  >
                    <Zap className="size-4" aria-hidden />
                    Optimize
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {candidates.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={optimizeAll} disabled={working || pendingCount === 0}>
              {working ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Zap className="size-4" aria-hidden />}
              {working ? `Processing ${doneCount}/${candidates.length}…` : `Optimize all (${pendingCount} pending)`}
            </Button>
            <Button variant="outline" onClick={downloadZip} disabled={zipping || candidates.every((c) => c.status !== "done")}>
              {zipping ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowDownToLine className="size-4" aria-hidden />}
              {zipping ? "Zipping…" : `Download zip bundle`}
            </Button>
          </div>
        ) : null}
      </div>

      <aside className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-card/50 p-4 text-xs text-muted-foreground backdrop-blur">
          <h3 className="text-sm font-medium text-foreground">What you get</h3>
          <ul className="mt-2 space-y-1.5">
            <li>· Optimized <code className="font-mono">.mp4</code> per flagged video</li>
            <li>· <code className="font-mono">video-snippet.html</code> and <code className="font-mono">video-snippet.jsx</code> with sources + poster</li>
            <li>· <code className="font-mono">optimization-report.txt</code> with bytes before/after</li>
            <li>· A single <code className="font-mono">pixel-press-optimized-bundle.zip</code></li>
          </ul>
          <p className="mt-3 leading-snug">
            Everything is encoded in this browser. Nothing is uploaded.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card/50 p-4 text-xs text-muted-foreground backdrop-blur">
          <h3 className="text-sm font-medium text-foreground">Savings estimate</h3>
          <p className="mt-2 tabular-nums text-lg font-semibold text-primary">
            {totalBytes > 0 ? Math.max(0, Math.round((1 - doneBytes / totalBytes) * 100)) : 0}%
          </p>
          <p className="text-[11px] text-muted-foreground">
            based on completed encodes · {doneCount} of {candidates.length} done
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card/50 p-4 text-xs leading-snug text-muted-foreground backdrop-blur">
          <FileCode2 className="mb-1.5 size-4" aria-hidden />
          Paste the generated snippet into your components. Keep the optimized <code className="font-mono">.mp4</code> files in the same directory so relative paths keep working.
        </div>
      </aside>
    </section>
  );
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
