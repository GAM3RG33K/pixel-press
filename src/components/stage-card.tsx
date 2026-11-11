import { Loader2 } from "lucide-react";
import { Marquee } from "@/components/marquee";

/** Progress + ETA card for the staged-read phase ("Reading 1.4 GB… ~11s left"). */
export interface StageProgressState {
  copied: number;
  total: number;
  startedAt: number;
}

export function StageCard({
  file,
  stageProgress,
}: {
  file: File;
  stageProgress: StageProgressState | null;
}) {
  const copied = stageProgress?.copied ?? 0;
  const total = stageProgress?.total ?? file.size;
  const elapsedMs = stageProgress ? performance.now() - stageProgress.startedAt : 0;
  const elapsedS = Math.max(elapsedMs / 1000, 0.001);
  const rate = copied > 0 ? copied / elapsedS / (1024 * 1024) : 0;
  const remainingS = copied > 0 && total > copied ? (total - copied) / (copied / elapsedS) : null;
  const pct = total > 0 ? Math.min(100, Math.round((copied / total) * 100)) : 0;
  const gb = (n: number) => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(2)} GB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
  return (
    <div className="press-paper rounded-xl p-4" role="status">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
          <Marquee title={file.name} className="font-medium">
            {stageProgress ? `Reading ${file.name}` : `Analyzing ${file.name}`}
          </Marquee>
        </p>
        {stageProgress ? (
          <p className="text-xs tabular-nums text-muted-foreground">
            {pct}% · {rate.toFixed(0)} MB/s
            {remainingS !== null ? ` · ~${remainingS >= 10 ? Math.round(remainingS) : remainingS.toFixed(1)}s left` : ""}
          </p>
        ) : null}
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-label="Reading input file"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
        {gb(copied)} of {gb(total)} · everything stays on this device
      </p>
    </div>
  );
}
