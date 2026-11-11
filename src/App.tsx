import { useState } from "react";
import { useEffect } from "react";
import { ShieldCheck } from "lucide-react";

import { Header } from "@/components/header";
import { CompressView } from "@/features/compress/CompressView";
import { OptimizeView } from "@/features/optimize/OptimizeView";
import { DiagnosticsFab } from "@/features/diagnostics/DiagnosticsFab";
import { TasksTray } from "@/components/tasks-tray";
import { SetupScreen } from "@/features/setup/SetupScreen";
import { PressHome, GOALS, type GoalId } from "@/components/PressHome";
import type { PressRoute } from "@/components/PressDropZone";
import { isTauri, tauriApi } from "@/lib/tauri";
import { diag } from "@/lib/diagnostics";
import { fetchSampleClip } from "@/lib/sample";
import { cn } from "@/lib/utils";

type Flow = "home" | "single" | "folder";

export default function App() {
  const [flow, setFlow] = useState<Flow>("home");
  const [setupState, setSetupState] = useState<"checking" | "ready" | "missing">("checking");
  const [goal, setGoal] = useState<GoalId | null>(null);
  /** Routed payloads — identity changes re-arm the flows. */
  const [singleRoute, setSingleRoute] = useState<{ file: File; path?: string; sizeBytes?: number } | null>(null);
  const [folderRoute, setFolderRoute] = useState<{ files?: File[]; tauriPath?: string; tauriPaths?: string[] } | null>(null);
  const [routeNonce, setRouteNonce] = useState(0);
  const [sampleRequested, setSampleRequested] = useState(false);

  useEffect(() => {
    // Avoid the React StrictMode dev double-mount logging twice
    const w = window as unknown as { __diagAppMounted?: boolean };
    if (w.__diagAppMounted) return;
    w.__diagAppMounted = true;
    diag.info('app', 'app mounted', {
      crossOriginIsolated: window.crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      userAgent: navigator.userAgent.slice(0, 120),
      onLine: navigator.onLine,
    });
    window.addEventListener('error', (event) => {
      diag.error('app', event.message || 'uncaught error', {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      diag.error('app', 'unhandled rejection', {
        reason:
          event.reason instanceof Error
            ? event.reason.message
            : String(event.reason),
      });
    });
  }, []);

  // Tauri-only: probe for ffmpeg/ffprobe at startup; block on missing tools.
  useEffect(() => {
    if (!isTauri()) {
      setSetupState("ready");
      return;
    }
    tauriApi.checkForFFmpeg().then((s) => {
      setSetupState(s.ffmpeg_present && s.ffprobe_present ? "ready" : "missing");
    }).catch((error) => {
      diag.error('app', 'ffmpeg probe failed', { error: error instanceof Error ? error.message : String(error) });
      setSetupState("ready"); // don't block user permanently if probe crashes
    });
  }, []);

  const route = (next: PressRoute) => {
    setRouteNonce((n) => n + 1);
    if (next.kind === "single") {
      setSingleRoute({ file: next.file, ...(next.path !== undefined ? { path: next.path } : {}), ...(next.sizeBytes !== undefined ? { sizeBytes: next.sizeBytes } : {}) });
      setFlow("single");
      return;
    }
    setFolderRoute({
      ...(next.files.length > 0 ? { files: next.files } : {}),
      ...(next.tauriPath !== undefined ? { tauriPath: next.tauriPath } : {}),
      ...(next.tauriPaths !== undefined ? { tauriPaths: next.tauriPaths } : {}),
    });
    setFlow("folder");
  };

  // Home → sample clip: enter the single-file flow and kick the sample fetch there.
  useEffect(() => {
    if (!sampleRequested) return;
    setSampleRequested(false);
    fetchSampleClip()
      .then((sample) => {
        setRouteNonce((n) => n + 1);
        setSingleRoute({ file: sample });
        setFlow("single");
      })
      .catch((error: unknown) => {
        diag.error('app', 'sample fetch failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        setFlow("single");
      });
  }, [sampleRequested]);

  const selectedGoal = GOALS.find((g) => g.id === goal) ?? null;

  if (isTauri() && setupState === "missing") {
    return (
      <>
        <SetupScreen onReady={() => setSetupState("ready")} />
        <TasksTray />
      </>
    );
  }

  if (isTauri() && setupState === "checking") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Checking for ffmpeg/ffprobe…
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <Header onNavigate={setFlow} />

      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6">
        {/* Home — the unified drop surface */}
        <div hidden={flow !== "home"} inert={flow !== "home"} aria-hidden={flow !== "home"} className={cn(flow !== "home" && "hidden")}>
          <PressHome
            selectedGoal={goal}
            onGoalChange={setGoal}
            onRoute={route}
            onTrySample={() => setSampleRequested(true)}
          />
        </div>

        {/* Flows — always mounted (keep-alive), hidden when inactive */}
        <div hidden={flow !== "single"} inert={flow !== "single"} aria-hidden={flow !== "single"} className={cn(flow !== "single" && "hidden", "pt-2")}>
          <CompressView
            initialFile={singleRoute}
            onBack={() => setFlow("home")}
            {...(selectedGoal ? { intentSeed: selectedGoal.intent } : {})}
            intentNonce={routeNonce}
          />
        </div>
        <div hidden={flow !== "folder"} inert={flow !== "folder"} aria-hidden={flow !== "folder"} className={cn(flow !== "folder" && "hidden", "pt-2")}>
          <OptimizeView
            initialFolder={folderRoute}
            folderNonce={routeNonce}
            onBack={() => setFlow("home")}
          />
        </div>
      </main>

      <DiagnosticsFab />
      <TasksTray onNavigate={() => setFlow("home")} />

      <footer className="border-t border-border/60 px-6 py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden />
            No account, no backend, no tracking.
          </span>
          <span>pixel-press · MIT licensed</span>
        </div>
      </footer>
    </div>
  );
}
