/**
 * Parses the summary line emitted by FFmpeg's `ssim` filter.
 *
 * Example:
 * `[Parsed_ssim_0 @ 0x…] SSIM Y:0.988906 (19.549) U:0.993456 (21.838) V:0.993479 (21.853) All:0.990522 (19.979)`
 *
 * Some builds omit the parenthesised dB figure, so both shapes are accepted.
 */
export interface SsimResult {
  /** Combined SSIM, 0–1 (higher is better). */
  all: number;
  /** Combined SSIM in dB. */
  allDb: number;
  y?: number;
  u?: number;
  v?: number;
}

function clampSsim(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ssimToDb(ssim: number): number {
  if (ssim >= 1) return Infinity;
  if (ssim <= 0) return -Infinity;
  return 10 * Math.log10(ssim / (1 - ssim));
}

const CHANNEL_RE = /([YUV]):\s*([0-9.]+)(?:\s*\(([0-9.]+)\))?/g;
const ALL_RE = /All:\s*([0-9.]+)(?:\s*\(([0-9.]+)\))?/;

/** Parses every `ssim` summary line and returns the last complete result. */
export function parseSsim(output: string | readonly string[]): SsimResult | null {
  const text = typeof output === "string" ? output : output.join("\n");
  const lines = text.split(/\r?\n/);

  let result: SsimResult | null = null;
  for (const line of lines) {
    if (!/SSIM/.test(line)) continue;
    const allMatch = ALL_RE.exec(line);
    if (!allMatch) continue;

    const all = clampSsim(Number(allMatch[1]));
    if (!Number.isFinite(all)) continue;

    const parsedDb = allMatch[2] !== undefined ? Number(allMatch[2]) : NaN;
    const allDb = Number.isFinite(parsedDb) ? parsedDb : ssimToDb(all);

    const channels: Partial<Record<"y" | "u" | "v", number>> = {};
    for (const match of line.matchAll(CHANNEL_RE)) {
      const key = match[1]?.toLowerCase();
      const value = Number(match[2]);
      if ((key === "y" || key === "u" || key === "v") && Number.isFinite(value)) {
        channels[key] = clampSsim(value);
      }
    }

    result = {
      all,
      allDb,
      ...(channels.y !== undefined ? { y: channels.y } : {}),
      ...(channels.u !== undefined ? { u: channels.u } : {}),
      ...(channels.v !== undefined ? { v: channels.v } : {}),
    };
  }

  return result;
}
