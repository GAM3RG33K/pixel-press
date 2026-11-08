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
import { diag, captureError } from "@/lib/diagnostics";
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
  const [results, setResults] = useState<CompareResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (metadata) {
      getFfmpegService().getCapabilities().then(setCapabilities).catch(() => undefined);
    }
  }, [metadata]);

  const analyzeFile = useCallback(async (incoming: File) => {
    setFile(incoming);
    setMetadata(null);
    setResults([]);
    setStatus("probing");
    setError(null);
    try {
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
      setError(normalized.message);
      setStatus("error");
    }
  }, []);

  const runCompare = useCallback(async () => {
    if (!file || !metadata) return;
    setStatus("encoding");
    setError(null);
    setResults([]);
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const service = getFfmpegService();
      const base = file.name.replace(/\.[^./]+$/, "") || "sample";
      const out: CompareResult[] = [];

      // Build three variants: H.264 CRF 23, H.264 CRF 28, VP9 CRF 34
      const variants = [
        { label: "H.264 · CRF 23 · high quality", crf: 23, codec: "h264" as const, container: "mp4" as const },
        { label: "H.264 · CRF 28 · balanced", crf: 28, codec: "h264" as const, container: "mp4" as const },
        { label: "VP9 · CRF 30 · smallest", crf: 30, codec: "vp9" as const, container: "webm" as const },
      ];

      for (const variant of variants) {
        if (abortRef.current.signal.aborted) return;
        setCurrentLabel(variant.label);
        const outName = `${base}-${variant.codec}-${variant.crf}.${variant.container}`;
        const started = performance.now();
        const encoded = await service.encode({
          input: file,
          inputFileName: file.name,
          outputFileName: outName,
          codec: variant.codec,
          crf: variant.crf,
          ...(variant.container === "mp4" ? { faststart: true } : {}),
          durationSeconds: metadata.duration,
          stripAudio: true,
          signal: abortRef.current.signal,
        });

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

      setResults(out);
      setStatus("done");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        diag.info('compare', 'encode aborted by user');
        setStatus("ready");
        return;
      }
      const normalized = captureError(caught);
      diag.error('compare', `encode failed: ${normalized.message}`, {
        name: normalized.name,
        stack: normalized.stack,
      });
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
                <span className="max-w-[360px] truncate">{file.name}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(1)} MB
                {metadata ? ` · ${metadata.width}×${metadata.height} · ${metadata.duration.toFixed(1)}s` : ""}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setFile(null); setMetadata(null); setResults([]); setStatus("idle"); }}>
              <Trash2 className="size-4" aria-hidden />
              Clear
            </Button>
          </div>
        )}

        {status === "encoding" ? (
          <div className="rounded-xl border border-border bg-card/50 p-4 backdrop-blur">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Encoding {currentLabel}…
            </p>
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
            {status === "encoding" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <FileVideo className="size-4" aria-hidden />
            )}
            {status === "encoding" ? "Encoding variants…" : "Encode 3 variants"}
          </Button>
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