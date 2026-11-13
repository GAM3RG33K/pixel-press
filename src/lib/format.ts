export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes as number;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = value >= 10 ? value.toFixed(0) : value.toFixed(value >= 1 ? 1 : 2);
  return `${formatted} ${units[unit]}`;
}

/**
 * ETA from an elapsed wall-clock start and a 0–100 progress percentage.
 * Assumes progress is roughly linear in time (true for ffmpeg's time-based
 * progress and for byte-copied staging). Returns null while the estimate is
 * meaningless (under 2% progress or non-finite inputs).
 */
export function etaFromProgress(startedAtMs: number | undefined, progressPct: number | undefined): number | null {
  if (startedAtMs === undefined || progressPct === undefined) return null;
  if (!Number.isFinite(progressPct) || progressPct < 2 || progressPct >= 100) return null;
  const elapsedS = (Date.now() - startedAtMs) / 1000;
  if (!Number.isFinite(elapsedS) || elapsedS <= 0) return null;
  const remaining = elapsedS * (100 / progressPct - 1);
  return Number.isFinite(remaining) ? Math.max(0, remaining) : null;
}

/** Human remaining-time label: "~42s left" / "~3m 05s left" / "~1h 12m left". */
export function formatRemaining(seconds: number | null): string {
  if (seconds === null) return "estimating…";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `~${total}s left`;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes < 60) return `~${minutes}m ${String(secs).padStart(2, "0")}s left`;
  const hours = Math.floor(minutes / 60);
  return `~${hours}h ${String(minutes % 60).padStart(2, "0")}m left`;
}

/** Compact variant for tight spots: "~42s" / "~3m 05s" / "~1h 12m". */
export function formatRemainingShort(seconds: number | null): string {
  if (seconds === null) return "…";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `~${total}s`;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes < 60) return `~${minutes}m ${String(secs).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `~${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Cap a large blob of text for diagnostic logs (keeps head + truncation note). */
export function clipText(text: string, max = 16000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}
