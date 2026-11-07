import type { ProgressSample } from "@/types/media";

/** Suffix multipliers for size tokens such as `1024kB` or `1MiB`. */
const SIZE_MULTIPLIERS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  kib: 1024,
  mb: 1e6,
  mib: 1024 * 1024,
  gb: 1e9,
  gib: 1024 * 1024 * 1024,
};

/** Suffix multipliers for bitrate tokens such as `1234.5kbits/s`. */
const BITRATE_MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  m: 1e6,
};

/**
 * Parses an FFmpeg time value (e.g. "00:01:23.45", "01:23.5") into seconds.
 * Returns null for empty or invalid input. Negative prefixes are clamped to 0.
 */
export function parseTimeToSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const negative = trimmed.startsWith("-");
  const magnitude = negative ? trimmed.slice(1) : trimmed;
  const parts = magnitude.split(":");
  if (parts.length === 0 || parts.length > 3) return null;

  const values: number[] = [];
  for (const part of parts) {
    const p = part.trim();
    const dotIndex = p.indexOf(".");
    const intStr = dotIndex === -1 ? p : p.slice(0, dotIndex);
    const fracStr = dotIndex === -1 ? "" : p.slice(dotIndex + 1);

    if (!/^\d+$/.test(intStr)) return null;

    let value = Number(intStr);
    if (fracStr.length > 0) {
      if (!/^\d+$/.test(fracStr)) return null;
      value += Number(`0.${fracStr}`);
    }
    if (!Number.isFinite(value)) return null;
    values.push(value);
  }

  let totalSeconds: number;
  if (values.length === 3) {
    totalSeconds = (values[0] ?? 0) * 3600 + (values[1] ?? 0) * 60 + (values[2] ?? 0);
  } else if (values.length === 2) {
    totalSeconds = (values[0] ?? 0) * 60 + (values[1] ?? 0);
  } else {
    totalSeconds = values[0] ?? 0;
  }

  const signed = negative ? -totalSeconds : totalSeconds;
  return Math.max(0, signed);
}

/**
 * Parses a size token such as `1024kB`, `1MiB`, `1024B` into raw bytes.
 * Returns undefined when the token cannot be parsed.
 */
function parseSize(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)$/i.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const multiplier = unit ? SIZE_MULTIPLIERS[unit] : undefined;
  if (multiplier === undefined || !Number.isFinite(amount)) return undefined;
  return amount * multiplier;
}

/**
 * Parses a bitrate token such as `1234.5kbits/s` into bits per second.
 * Returns undefined when the token cannot be parsed.
 */
function parseBitrate(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*([km])?bits\/s$/i.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix ? BITRATE_MULTIPLIERS[suffix] : 1;
  if (multiplier === undefined || !Number.isFinite(amount)) return undefined;
  return amount * multiplier;
}

function parseFiniteNumber(value: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parses a single FFmpeg stderr line into a ProgressSample.
 * Returns null when the line has no `time=` token OR when time is invalid.
 */
export function parseProgressLine(line: string): ProgressSample | null {
  const timeMatch = /time=\s*(\S+)/i.exec(line);
  const timeToken = timeMatch?.[1];
  if (!timeToken) return null;

  const timeSeconds = parseTimeToSeconds(timeToken);
  if (timeSeconds === null) return null;

  const sample: ProgressSample = { timeSeconds, raw: line };

  const kvRegex = /([a-zA-Z_]+)\s*=\s*(\S+)/gi;
  for (const match of line.matchAll(kvRegex)) {
    const key = match[1]?.toLowerCase();
    const val = match[2];
    if (!key || val === undefined) continue;
    if (key === "time") continue;

    switch (key) {
      case "frame": {
        const frame = parseFiniteNumber(val);
        if (frame !== undefined) sample.frame = Math.trunc(frame);
        break;
      }
      case "fps": {
        if (val !== "N/A") {
          const fps = parseFiniteNumber(val);
          if (fps !== undefined) sample.fps = fps;
        }
        break;
      }
      case "speed": {
        if (val !== "N/A") {
          const speed = parseFiniteNumber(val.replace(/x$/i, ""));
          if (speed !== undefined) sample.speed = speed;
        }
        break;
      }
      case "bitrate": {
        const bitrate = parseBitrate(val);
        if (bitrate !== undefined) sample.bitrate = bitrate;
        break;
      }
      case "size": {
        const sizeBytes = parseSize(val);
        if (sizeBytes !== undefined) sample.sizeBytes = sizeBytes;
        break;
      }
    }
  }

  return sample;
}

/**
 * Computes the percentage of completion given elapsed and total time.
 * Returns 0 when duration <= 0 or inputs are not finite.
 * Clamps result to [0, 100].
 */
export function percentFromTime(
  timeSeconds: number,
  durationSeconds: number,
): number {
  if (
    durationSeconds <= 0 ||
    !Number.isFinite(timeSeconds) ||
    !Number.isFinite(durationSeconds)
  ) {
    return 0;
  }
  const percent = (timeSeconds / durationSeconds) * 100;
  return Math.max(0, Math.min(100, percent));
}
