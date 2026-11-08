import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, RefreshCw, Terminal } from "lucide-react";
import type { FfmpegStatus } from "@/lib/tauri";
import { tauriApi } from "@/lib/tauri";
import { Button } from "@/components/ui/button";

const INSTALL_HINTS: Record<string, { title: string; cmd: string; pkg_url: string }> = {
  macos: {
    title: "Install FFmpeg (macOS)",
    cmd: "brew install ffmpeg",
    pkg_url: "https://formulae.brew.sh/formula/ffmpeg",
  },
  linux: {
    title: "Install FFmpeg (Linux)",
    cmd: "sudo apt install ffmpeg",
    pkg_url: "https://johnvansickle.com/ffmpeg/",
  },
  windows: {
    title: "Install FFmpeg (Windows)",
    cmd: "winget install Gyan.FFmpeg",
    pkg_url: "https://www.gyan.dev/ffmpeg/builds/",
  },
};

export interface SetupScreenProps {
  /** Called when the requisite tools are present. */
  onReady: () => void;
}

/**
 * First-run setup flow. Detects ffmpeg/ffprobe at startup; if missing,
 * shows install instructions per platform; the user can re-check on demand.
 * No downloads happen during this phase (see harness Q-30/D-021).
 */
export function SetupScreen({ onReady }: SetupScreenProps) {
  const [status, setStatus] = useState<FfmpegStatus | null>(null);
  const [platform, setPlatform] = useState<{ os: string; arch: string; tauri: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const [st, p] = await Promise.all([
        tauriApi.checkForFFmpeg(),
        tauriApi.platformInfo(),
      ]);
      setStatus(st);
      setPlatform(p);
      if (st.ffmpeg_present && st.ffprobe_present) {
        onReady();
      }
    } finally {
      setChecking(false);
    }
  }, [onReady]);

  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  if (checking || !status) {
    return (
      <div className="flex h-full min-h-[100vh] flex-col items-center justify-center gap-3 bg-background p-8 text-center">
        <RefreshCw className="size-6 animate-spin text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">Checking for ffmpeg and ffprobe…</p>
      </div>
    );
  }

  const hint =
    platform?.os === "macos"
      ? INSTALL_HINTS.macos!
      : platform?.os === "windows"
        ? INSTALL_HINTS.windows!
        : INSTALL_HINTS.linux!;

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 p-8 pt-16 text-center">
      <Terminal className="size-12 text-primary" aria-hidden />
      <h1 className="text-balance text-4xl font-semibold tracking-tight">
        pixel-press needs ffmpeg
      </h1>
      <p className="max-w-xl text-base text-muted-foreground">
        pixel-press needs a system ffmpeg/ffprobe install to encode videos locally.
        Almost every developer machine already has one — if not, install it in
        under a minute with the command below, then press <strong>Retry</strong>.
      </p>

      <div className="w-full rounded-xl border border-border bg-card/60 p-6 text-left backdrop-blur">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {hint.title}
        </h2>
        <pre className="mt-2 overflow-x-auto rounded-md bg-background/80 p-3 font-mono text-sm text-foreground">
          {hint.cmd}
        </pre>
        <a
          href={hint.pkg_url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs text-primary underline-offset-2 hover:underline"
        >
          Open install page →
        </a>
      </div>

      <div className="w-full rounded-xl border border-border bg-card/40 p-4 text-left text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Detected on this machine:</p>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 font-mono">
          <li>ffmpeg: {status.ffmpeg_present ? `present (${status.ffmpeg_version?.split(" ")[2] ?? ""})` : "MISSING"}</li>
          <li>ffprobe: {status.ffprobe_present ? `present (${status.ffprobe_version?.split(" ")[2] ?? ""})` : "MISSING"}</li>
        </ul>
        <p className="mt-2 text-[10px]">
          platform: {platform ? `${platform.os}/${platform.arch} · Tauri v${platform.tauri}` : "detecting…"}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button size="lg" onClick={() => setRetryCount((n) => n + 1)} disabled={checking}>
          {checking ? (
            <RefreshCw className="size-4 animate-spin" aria-hidden />
          ) : (
            <CheckCircle2 className="size-4" aria-hidden />
          )}
          Retry
        </Button>
        <Button size="lg" variant="outline" onClick={onReady}>
          <Download className="size-4" aria-hidden />
          Skip for now (use without ffmpeg)
        </Button>
      </div>

      <p className="max-w-md text-xs text-muted-foreground">
        Skipping is allowed but the app cannot encode video until ffmpeg is
        available; only the rules view, project auditor, and AI settings will work.
      </p>
    </div>
  );
}
