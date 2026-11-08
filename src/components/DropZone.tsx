import { useCallback, useState, type DragEvent } from "react";
import { UploadCloud } from "lucide-react";

/** Minimal drop zone for the workbench views. */
export function DropZone({
  onFile,
  disabled,
  compact = false,
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [dragging, setDragging] = useState(false);

  const handle = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("video/")) return;
      onFile(file);
    },
    [onFile],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      handle(event.dataTransfer.files?.[0]);
    },
    [handle],
  );

  if (compact) {
    return (
      <div className="relative">
        <input
          id="file-input-compact"
          type="file"
          accept="video/*,.mkv,.avi,.mov"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => handle(event.currentTarget.files?.[0])}
        />
        <label
          htmlFor="file-input-compact"
          className={[
            "inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-card/60 px-4 text-sm backdrop-blur transition-colors hover:bg-accent",
            disabled ? "pointer-events-none opacity-50" : "",
          ].join(" ")}
        >
          <UploadCloud className="size-4" aria-hidden />
          Choose video
        </label>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Drop a video file here or click to browse"
      className={[
        "group flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center transition-colors",
        dragging
          ? "border-primary/70 bg-primary/10"
          : "border-border bg-card/40 hover:border-primary/40 hover:bg-card/60",
        disabled ? "pointer-events-none opacity-50" : "",
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
      <input
        id="file-input"
        type="file"
        accept="video/*,.mkv,.avi,.mov"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => handle(event.currentTarget.files?.[0])}
      />
    </div>
  );
}