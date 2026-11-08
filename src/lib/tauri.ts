/**
 * Tauri bridge — detects whether the app is running inside a Tauri shell
 * and exposes typed invoke wrappers. Falls back to browser-only behavior
 * (and `null` returns) when running under a regular browser.
 */

/** True when running inside a Tauri webview. */
export const isTauri = (): boolean =>
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in window;

/** Raw invoke — avoid in views; use the typed wrappers below. */
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const mod = await import("@tauri-apps/api/core");
  return mod.invoke<T>(command, args);
}

export interface FsEntry {
  path: string;
  kind: "file" | "directory";
  size: number;
  last_modified: number;
}

export const tauriApi = {
  /** Runs `ffprobe -show_format -show_streams -of json FILE`. */
  ffprobeJson: (inputPath: string): Promise<string> =>
    invoke<string>("ffprobe_json", { inputPath }),

  /** Probes raw bytes by writing a temp file and invoking ffprobe. */
  ffprobeBytes: (bytes: Uint8Array, fileName: string): Promise<string> =>
    invoke<string>("ffprobe_bytes", { bytes: Array.from(bytes), fileName }),

  /** Writes a 1-second 320×240 test clip and returns its path. */
  generateTestClip: (): Promise<string> =>
    invoke<string>("generate_test_clip"),

  /** Recursive directory listing, depth-capped at 16. */
  fsReadDir: (path: string): Promise<FsEntry[]> =>
    invoke<FsEntry[]>("fs_read_dir", { path }),

  /** Reads a text file (for audit scans). */
  readFileText: (path: string): Promise<string> =>
    invoke<string>("read_file_text", { path }),

  /** Opens a native folder picker; returns absolute path or null if cancelled. */
  pickFolder: (): Promise<string | null> =>
    invoke<string | null>("pick_folder"),

  /** Returns the app's per-user data directory (manifests, binaries, models). */
  getAppConfigDir: (): Promise<string> =>
    invoke<string>("get_app_config_dir"),

  /** Checks if ffmpeg/ffprobe are on PATH or in the app config bin dir. */
  checkForFFmpeg: (): Promise<FfmpegStatus> =>
    invoke<FfmpegStatus>("check_for_ffmpeg"),

  /** Returns basic host information (os, arch, tauri version). */
  platformInfo: (): Promise<{ os: string; arch: string; tauri: string }> =>
    invoke<{ os: string; arch: string; tauri: string }>("platform_info"),
};

export interface FfmpegStatus {
  ffmpeg_present: boolean;
  ffprobe_present: boolean;
  ffmpeg_version: string | null;
  ffprobe_version: string | null;
}