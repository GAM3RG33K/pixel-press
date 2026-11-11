import { useCallback, useEffect, useState, type DragEvent } from "react";
import { UploadCloud, Loader2, XCircle } from "lucide-react";

import { diag } from "@/lib/diagnostics";
import { isTauri } from "@/lib/tauri";

const VIDEO_EXTENSION = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "mkv":
      return "video/x-matroska";
    case "avi":
      return "video/x-msvideo";
    default:
      return "video/mp4";
  }
}

/** Minimal drop zone for the workbench views. */
export function DropZone({
  onFile,
  disabled,
  compact = false,
}: {
  onFile: (file: File, path?: string, sizeBytes?: number) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handle = useCallback(
    (file: File | undefined, source: string) => {
      if (!file) {
        diag.warn("dropzone", `no file received via ${source}`);
        return;
      }
      if (!file.type.startsWith("video/") && !VIDEO_EXTENSION.test(file.name)) {
        diag.warn("dropzone", `rejected non-video file: ${file.name} (${file.type || "unknown type"})`);
        setNotice(`"${file.name}" is not a video file pixel-press can read.`);
        window.setTimeout(() => setNotice(null), 4000);
        return;
      }
      diag.info("dropzone", `file selected via ${source}`, {
        name: file.name,
        size: file.size,
        type: file.type,
      });
      setBusy(true);
      onFile(file);
      window.setTimeout(() => setBusy(false), 600);
    },
    [onFile],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      handle(event.dataTransfer.files?.[0], "html5-drop");
    },
    [handle],
  );

  // In Tauri, Finder drops are delivered as native drag-drop events — the DOM
  // dataTransfer never carries the file. Read bytes via the fs plugin instead.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const off = await getCurrentWebview().onDragDropEvent((event) => {
        if (cancelled) return;
        const payload = event.payload;
        if (payload.type === "over" || payload.type === "enter") {
          setDragging(true);
          return;
        }
        if (payload.type === "leave") {
          setDragging(false);
          return;
        }
        if (payload.type !== "drop") return;
        setDragging(false);
        const paths: string[] = payload.paths ?? [];
        diag.info("dropzone", "native drop received", { count: paths.length, paths });
        const videoPath = paths.find((p) => VIDEO_EXTENSION.test(p));
        if (!videoPath) {
          diag.warn("dropzone", "no supported video in native drop", { paths });
          setNotice("No supported video file was in that drop (MP4 · WebM · MOV · MKV · AVI).");
          window.setTimeout(() => setNotice(null), 4000);
          return;
        }
        setBusy(true);
        (async () => {
          try {
            // Grant fs scope read access to just this dropped file (it's outside $APPDATA).
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("allow_file_path", { path: videoPath });
            const name = videoPath.split(/[/\\]/).pop() ?? "video.mp4";
            let sizeBytes = 0;
            try {
              const stat = await (await import("@tauri-apps/plugin-fs")).stat?.(videoPath);
              sizeBytes = Number(stat?.size ?? 0);
            } catch {
              sizeBytes = 0;
            }
            const placeholder = new File([], name, { type: mimeFromName(name) });
            diag.info("dropzone", "native drop source registered", { name, sizeBytes, path: videoPath });
            onFile(placeholder, videoPath, sizeBytes);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            diag.error("dropzone", `failed to handle drop ${videoPath}: ${message}`);
            setNotice(`Couldn't open the dropped file: ${message}`);
            window.setTimeout(() => setNotice(null), 5000);
          } finally {
            setBusy(false);
          }
        })();
      });
      unlisten = off;
    })().catch((error) => {
      diag.error("dropzone", `drag-drop listener failed to start: ${error instanceof Error ? error.message : String(error)}`);
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onFile]);

  if (compact) {
    return (
      <div className="relative">
        <input
          id="file-input-compact"
          type="file"
          accept="video/*,.mkv,.avi,.mov"
          className="sr-only"
          disabled={disabled || busy}
          onChange={(event) => handle(event.currentTarget.files?.[0], "input")}
        />
        <label
          htmlFor="file-input-compact"
          className={[
            "inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-press-paper-edge bg-press-paper px-4 text-sm transition-colors hover:border-primary/50",
            disabled || busy ? "pointer-events-none opacity-50" : "",
          ].join(" ")}
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Reading file…
            </>
          ) : (
            <>
              <UploadCloud className="size-4" aria-hidden />
              Choose video
            </>
          )}
        </label>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Drop a video file here or click to browse"
      aria-busy={busy}
      className={[
        "group flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center transition-colors",
        dragging
          ? "border-primary/70 bg-primary/10"
          : "border-press-paper-edge bg-press-paper hover:border-primary/50",
        disabled || busy ? "pointer-events-none opacity-60" : "",
      ].join(" ")}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          document.getElementById("file-input")?.click();
        }
      }}
      onClick={() => document.getElementById("file-input")?.click()}
    >
      {busy ? (
        <>
          <Loader2 className="size-10 animate-spin text-primary" aria-hidden />
          <p className="mt-3 text-base font-medium">Reading file…</p>
          <p className="mt-1 text-xs text-muted-foreground">Loading it into the encoder sandbox</p>
        </>
      ) : (
        <>
          <UploadCloud className="size-10 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden />
          <p className="mt-3 text-base font-medium">
            Drop a video, or{" "}
            <span className="underline underline-offset-4 decoration-primary/60">
              browse your files
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            MP4 · WebM · MOV · MKV · AVI — everything stays on your device
          </p>
        </>
      )}
      <input
        id="file-input"
        type="file"
        accept="video/*,.mkv,.avi,.mov"
        className="sr-only"
        disabled={disabled || busy}
        onChange={(event) => handle(event.currentTarget.files?.[0], "input")}
      />
      {notice ? (
        <p className="mt-3 flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive" role="alert">
          <XCircle className="size-3.5 shrink-0" aria-hidden />
          {notice}
        </p>
      ) : null}
    </div>
  );
}
