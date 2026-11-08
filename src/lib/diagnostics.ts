/**
 * In-app diagnostic log stream.
 *
 * Captures everything interesting that happens inside the app: service worker
 * isolation, engine load/capability probe, ffprobe, encodes, AI model loading,
 * errors. Entries are kept in memory only; they never cross the network.
 *
 * A floating Diagnostic button lets the user copy the entire log to the
 * clipboard or download it as a plain-text file for bug reports.
 */

export type DiagLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagEntry {
  /** Milliseconds since the app booted. */
  elapsedMs: number;
  wallTime: string;
  level: DiagLevel;
  scope: string;
  message: string;
  /** Optional structured payload (never contains raw video bytes). */
  details?: unknown;
}

export interface DiagSnapshot {
  version: 1;
  appVersion: string;
  userAgent: string;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  entries: DiagEntry[];
}

const MAX_ENTRIES = 500;
const entries: DiagEntry[] = [];
const start = typeof performance !== 'undefined' ? performance.now() : Date.now();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function formatWallTime(): string {
  const d = new Date();
  return d.toISOString();
}

export function diagLog(
  level: DiagLevel,
  scope: string,
  message: string,
  details?: unknown,
): void {
  const entry: DiagEntry = {
    elapsedMs: Math.round(now() - start),
    wallTime: formatWallTime(),
    level,
    scope,
    message,
    ...(details !== undefined ? { details } : {}),
  };

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }

  // Also write to the browser console so DevTools can correlate.
  const tag = `[diag:${scope}]`;
  switch (level) {
    case 'error':
      console.error(tag, message, details ?? '');
      break;
    case 'warn':
      console.warn(tag, message, details ?? '');
      break;
    default:
      console.info(tag, message, details ?? '');
  }
}

/** Convenience shortcuts. */
export const diag = {
  debug: (scope: string, message: string, details?: unknown) =>
    diagLog('debug', scope, message, details),
  info: (scope: string, message: string, details?: unknown) =>
    diagLog('info', scope, message, details),
  warn: (scope: string, message: string, details?: unknown) =>
    diagLog('warn', scope, message, details),
  error: (scope: string, message: string, details?: unknown) =>
    diagLog('error', scope, message, details),
};

/** Raw entries (newest last). */
export function getDiagEntries(): readonly DiagEntry[] {
  return entries.slice();
}

/** Clear the in-memory log. */
export function clearDiag(): void {
  entries.length = 0;
}

/** Serialise all current state + log to a downloadable JSON snapshot. */
export function buildDiagSnapshot(appVersion = '0.0.0+unknown'): DiagSnapshot {
  return {
    version: 1,
    appVersion,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    crossOriginIsolated:
      typeof window !== 'undefined' && window.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    entries: entries.slice(),
  };
}

/** Render the log as a human-readable plain-text report. */
export function renderDiagReport(snapshot: DiagSnapshot): string {
  const header = [
    'pixel-press — diagnostic report',
    `generated: ${new Date().toISOString()}`,
    `app version: ${snapshot.appVersion}`,
    `user agent: ${snapshot.userAgent}`,
    `crossOriginIsolated: ${snapshot.crossOriginIsolated}`,
    `SharedArrayBuffer: ${snapshot.sharedArrayBuffer}`,
    `entries: ${snapshot.entries.length}`,
    '',
  ].join('\n');

  const body = snapshot.entries
    .map((entry) => {
      const detail =
        entry.details !== undefined
          ? '\n    ' + JSON.stringify(entry.details, null, 2).replace(/\n/g, '\n    ')
          : '';
      return `[${String(entry.elapsedMs).padStart(6)}ms] [${entry.level.toUpperCase().padEnd(5)}] ${entry.scope}: ${entry.message}${detail}`;
    })
    .join('\n');

  return header + body;
}

/** Serialize to JSON and trigger a download. */
export function downloadDiagSnapshot(appVersion?: string): void {
  const snapshot = buildDiagSnapshot(appVersion);
  const text = renderDiagReport(snapshot);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `pixel-press-diagnostics-${Date.now()}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}