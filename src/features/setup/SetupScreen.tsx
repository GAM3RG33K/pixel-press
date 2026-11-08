import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Download, Loader2, Terminal, RefreshCw } from "lucide-react";
import type { FfmpegStatus } from "@/lib/tauri";
import { tauriApi } from "@/lib/tauri";
import { Button } from "@/components/ui/button";

interface RequiredTool {
  id: string;
  label: string;
  expected_bytes: number;
  sha256: string;
  url: string;
  includes_ffprobe: boolean;
}

export interface SetupScreenProps {
  /** Called once ffmpeg/ffprobe are present (downloaded or already on PATH). */
  onReady: () => void;
}

type Phase = "checking" | "ready" | "needs-download" | "downloading" | "failed";

/**
 * First-launch setup. Detects ffmpeg/ffprobe on PATH/our bin dir; if missing,
 * downloads from a manifest in this repo's releases. The user can also skip
 * and install manually later.
 */
export function SetupScreen({ onReady }: SetupScreenProps) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [status, setStatus] = useState<FfmpegStatus | null>(null);
  const [required, setRequired] = useState<RequiredTool[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const check = async (): Promise<{ ready: boolean; status: FfmpegStatus }> => {
    const s = await tauriApi.checkForFFmpeg();
    return { ready: s.ffmpeg_present && s.ffprobe_present, status: s };
  };

  const refresh = async () => {
    setPhase("checking");
    try {
      const { ready, status: s } = await check();
      setStatus(s);
      if (ready) {
        setPhase("ready");
        onReady();
      } else {
        const req = await invokeRequired();
        setRequired(req);
        setPhase("needs-download");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("failed");
    }
  };

  const invokeRequired = async (): Promise<RequiredTool[]> => {
    const mod = await import("@tauri-apps/api/core");
    return mod.invoke<RequiredTool[]>("required_artifacts");
  };

  const downloadAll = async () => {
    setPhase("downloading");
    setError(null);
    let doneBytes = 0;
    try {
      for (const tool of required) {
        const mod = await import("@tauri-apps/api/core");
        await mod.invoke("download_tool", {
          toolId: tool.id,
          url: tool.url,
          expectedSha256: tool.sha256,
          expectedSize: tool.expected_bytes,
        });
        doneBytes += tool.expected_bytes;
        setProgress((p) => ({ ...p, [tool.id]: doneBytes }));
      }
      // Recheck
      const { ready } = await check();
      if (ready) {
        setPhase("ready");
        onReady();
      } else {
        setError("Download finished but ffmpeg/ffprobe still not detected — see system logs.");
        setPhase("failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("failed");
    } finally {
      // done
    }
  };

  // Initial check + progress listener
  useEffect(() => {
    void refresh();
    let unlisten: UnlistenFn | undefined;
    listen<[string, number]>("setup-progress", (event) => {
      const [toolId, bytes] = event.payload;
      setProgress((p) => ({ ...p, [toolId]: bytes }));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  if (phase === "checking") {
    return (
      <FullPage>
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">Checking for ffmpeg/ffprobe…</p>
      </FullPage>
    );
  }

  if (phase === "ready") {
    return null; // caller will unmount
  }

  if (phase === "failed") {
    return (
      <FullPage>
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
          <p className="font-medium">Setup failed</p>
          <p className="mt-1 font-mono text-xs">{error}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="default" onClick={() => setRetryCount((n) => n + 1)}>
            <RefreshCw className="size-4" aria-hidden />
            Retry
          </Button>
          <Button variant="outline" onClick={onReady}>
            Skip and continue without ffmpeg
          </Button>
        </div>
      </FullPage>
    );
  }

  if (phase === "downloading" && required.length > 0) {
    const total = required.reduce((a, t) => a + t.expected_bytes, 0);
    const done = required.reduce((a, t) => a + (progress[t.id] ?? 0), 0);
    return (
      <FullPage>
        <Terminal className="size-10 text-primary" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">Installing ffmpeg…</h1>
        <div className="w-full max-w-md space-y-3">
          {required.map((tool) => {
            const pct = Math.min(100, Math.round(((progress[tool.id] ?? 0) / tool.expected_bytes) * 100));
            return (
              <div key={tool.id}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{tool.label}</span>
                  <span className="tabular-nums text-muted-foreground">{pct}%</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground tabular-nums">
            {(done / 1024 / 1024).toFixed(1)} MB of {(total / 1024 / 1024).toFixed(1)} MB
          </p>
        </div>
      </FullPage>
    );
  }

  // needs-download — setup screen
  return (
    <FullPage>
      <Terminal className="size-12 text-primary" aria-hidden />
      <h1 className="text-balance text-4xl font-semibold tracking-tight">
        Set up ffmpeg
      </h1>
      <p className="max-w-xl text-base text-muted-foreground">
        pixel-press can download a static ffmpeg + ffprobe directly to your device — no admin rights, no system PATH changes.
        Just the tools needed to encode videos locally, nothing else.
      </p>

      <div className="w-full max-w-md rounded-xl border border-border bg-card/60 p-5 text-left">
        <ul className="space-y-2 text-sm">
          {required.map((tool) => (
            <li key={tool.id} className="flex items-center justify-between">
              <span>{tool.label}</span>
              <span className="tabular-nums text-muted-foreground">
                ~{Math.round(tool.expected_bytes / 1024 / 1024)} MB
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Button size="lg" onClick={downloadAll}>
        <Download className="size-4" aria-hidden />
        Download and install
      </Button>

      <p className="max-w-md text-xs text-muted-foreground">
        Tools are SHA-256 verified after download. The source is free software — built by the community, no affiliation
        or bundling restrictions. Total installation: ~60 MB.
      </p>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>Detected: </span>
        <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
          {status?.ffmpeg_present ? "ffmpeg ✓" : "ffmpeg ✗"} · {status?.ffprobe_present ? "ffprobe ✓" : "ffprobe ✗"}
        </code>
      </div>
    </FullPage>
  );
}

function FullPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[100vh] max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      {children}
    </div>
  );
}