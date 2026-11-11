import { useCallback, useEffect, useState, type DragEvent } from "react";
import { Loader2, FolderOpen, XCircle } from "lucide-react";

import { diag } from "@/lib/diagnostics";
import { isTauri, tauriApi } from "@/lib/tauri";

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

export type PressRoute =
  | { kind: "single"; file: File; path?: string; sizeBytes?: number }
  | { kind: "folder"; files: File[]; tauriPath?: string; tauriPaths?: string[] };

/** Collect files dropped via HTML5 entries, walking directories. */
async function collectEntryFiles(entry: FileSystemEntry, prefix: string): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject);
    });
    const rel = `${prefix}${file.name}`;
    try {
      // webkitRelativePath is what the folder flow keys on.
      Object.defineProperty(file, "webkitRelativePath", { value: rel });
    } catch {
      /* read-only in some engines — name still routes correctly */
    }
    return [file];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children = await new Promise<FileSystemEntry[]>((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
  const nested = await Promise.all(
    children.map((child) => collectEntryFiles(child, `${prefix}${entry.name}/`)),
  );
  return nested.flat();
}

/**
 * Unified drop surface: one video routes to the single-file flow, a folder or
 * multiple videos route to the folder flow. Infers intent — no tabs, no modes.
 */
export function PressDropZone({ onRoute }: { onRoute: (route: PressRoute) => void }) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const flashNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 4200);
  }, []);

  const routeFiles = useCallback(
    (files: File[]) => {
      const videos = files.filter((f) => /video\//.test(f.type) || VIDEO_EXTENSION.test(f.name));
      if (videos.length === 0) {
        flashNotice("No supported video in that drop (MP4 · WebM · MOV · MKV · AVI).");
        return;
      }
      if (videos.length === 1) {
        onRoute({ kind: "single", file: videos[0]! });
      } else {
        onRoute({ kind: "folder", files: videos });
      }
    },
    [onRoute, flashNotice],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      const items = Array.from(event.dataTransfer.items ?? []);
      const entries = items
        .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
        .filter((e): e is FileSystemEntry => Boolean(e));

      if (entries.length > 0 && entries.some((e) => e.isDirectory)) {
        setBusy(true);
        Promise.all(entries.map((e) => collectEntryFiles(e, "")))
          .then((nested) => routeFiles(nested.flat()))
          .catch((error: unknown) => {
            diag.error("press", "directory walk failed", {
              error: error instanceof Error ? error.message : String(error),
            });
            flashNotice("Couldn't read that folder — try the folder picker instead.");
          })
          .finally(() => setBusy(false));
        return;
      }
      routeFiles(Array.from(event.dataTransfer.files ?? []));
    },
    [routeFiles, flashNotice],
  );

  // Tauri: native drops carry paths, not File objects. Directories route to the folder flow.
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
        diag.info("press", "native drop received", { count: paths.length, paths });

        void (async () => {
          // Split into directories and video files.
          const dirs: string[] = [];
          const videos: string[] = [];
          for (const p of paths) {
            if (VIDEO_EXTENSION.test(p)) {
              videos.push(p);
              continue;
            }
            try {
              const entries = await tauriApi.fsReadDir(p);
              if (Array.isArray(entries) && entries.length >= 0) {
                const nested = entries.filter((e) => e.kind === "file" && VIDEO_EXTENSION.test(e.path));
                if (nested.length > 0) dirs.push(p);
              }
            } catch {
              diag.warn("press", "dropped path is not a readable directory", { path: p });
            }
          }

          if (dirs.length > 0 || videos.length > 1) {
            // Folder flow: scan the first dropped directory (or treat loose videos as a batch).
            if (dirs.length > 0) {
              onRoute({ kind: "folder", files: [], tauriPath: dirs[0]! });
              return;
            }
            setBusy(true);
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              for (const p of videos) {
                await invoke("allow_file_path", { path: p }).catch(() => undefined);
              }
              onRoute({ kind: "folder", files: [], tauriPaths: videos });
            } finally {
              setBusy(false);
            }
            return;
          }

          const only = videos[0];
          if (!only) {
            flashNotice("No supported video file was in that drop (MP4 · WebM · MOV · MKV · AVI).");
            return;
          }
          setBusy(true);
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("allow_file_path", { path: only });
            const name = only.split(/[/\\]/).pop() ?? "video.mp4";
            let sizeBytes = 0;
            try {
              const stat = await (await import("@tauri-apps/plugin-fs")).stat?.(only);
              sizeBytes = Number(stat?.size ?? 0);
            } catch {
              sizeBytes = 0;
            }
            const placeholder = new File([], name, { type: mimeFromName(name) });
            onRoute({ kind: "single", file: placeholder, path: only, sizeBytes });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            diag.error("press", `failed to handle native drop: ${message}`);
            flashNotice(`Couldn't open the dropped file: ${message}`);
          } finally {
            setBusy(false);
          }
        })();
      });
      unlisten = off;
    })().catch((error) => {
      diag.error("press", `drag-drop listener failed to start: ${error instanceof Error ? error.message : String(error)}`);
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onRoute, flashNotice]);

  const pickFolder = useCallback(() => {
    if (isTauri()) {
      tauriApi.pickFolder().then((dir) => {
        if (dir) onRoute({ kind: "folder", files: [], tauriPath: dir });
      }).catch((error: unknown) => {
        diag.error("press", "folder pick failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }
    document.getElementById("press-folder-input")?.click();
  }, [onRoute]);

  return (
    <div className="flex w-full flex-col items-center">
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop a video or a folder here, or press Enter to browse"
        aria-busy={busy}
        className={[
          "press-field group relative flex aspect-[16/10] w-full max-w-2xl cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border transition-colors",
          dragging
            ? "border-primary/70 bg-primary/10"
            : "border-press-paper-edge bg-press-paper hover:border-primary/50",
          busy ? "pointer-events-none opacity-70" : "",
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
            document.getElementById("press-file-input")?.click();
          }
        }}
        onClick={() => document.getElementById("press-file-input")?.click()}
      >
        {busy ? (
          <>
            <Loader2 className="size-10 animate-spin text-primary" aria-hidden />
            <p className="mt-4 text-base font-medium">Reading your drop…</p>
          </>
        ) : (
          <>
            <img
              src="/icon.svg"
              alt=""
              aria-hidden
              className="size-16 opacity-90 drop-shadow-[0_0_18px_oklch(0.72_0.19_300/0.35)] transition-transform duration-300 group-hover:scale-105"
            />
            <p className="mt-5 text-xl font-semibold tracking-tight">
              Drop a video <span className="text-muted-foreground">or a folder</span>
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              One file → smallest sensible encode · many files → one-pass folder shrink
            </p>
            <p className="mt-4 rounded-full border border-border bg-background/60 px-3 py-1 text-[11px] text-muted-foreground">
              MP4 · WebM · MOV · MKV · AVI — everything stays on this device
            </p>
          </>
        )}
        <input
          id="press-file-input"
          type="file"
          accept="video/*,.mkv,.avi,.mov"
          multiple
          className="sr-only"
          onChange={(event) => routeFiles(Array.from(event.target.files ?? []))}
        />
        <input
          id="press-folder-input"
          type="file"
          // @ts-expect-error – non-standard but universally supported for folder picks
          webkitdirectory=""
          directory=""
          multiple
          className="sr-only"
          onChange={(event) => routeFiles(Array.from(event.target.files ?? []))}
        />
      </div>

      <button
        type="button"
        onClick={pickFolder}
        className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
      >
        <FolderOpen className="size-3.5" aria-hidden />
        or pick a folder to shrink
      </button>

      {notice ? (
        <p
          role="alert"
          className="mt-3 flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
        >
          <XCircle className="size-3.5 shrink-0" aria-hidden />
          {notice}
        </p>
      ) : null}
    </div>
  );
}
