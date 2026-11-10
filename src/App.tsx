import { useState } from "react";
import { useEffect } from "react";
import {
  ArrowDownToLine,
  BarChart3,
  FolderOpen,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { Header } from "@/components/header";
import { CompressView } from "@/features/compress/CompressView";
import { CompareView } from "@/features/compare/CompareView";
import { AuditView } from "@/features/audit/AuditView";
import { OptimizeView } from "@/features/optimize/OptimizeView";
import { DiagnosticsFab } from "@/features/diagnostics/DiagnosticsFab";
import { SetupScreen } from "@/features/setup/SetupScreen";
import { isTauri, tauriApi } from "@/lib/tauri";
import { diag } from "@/lib/diagnostics";
import { cn } from "@/lib/utils";

type TabId = "compress" | "compare" | "audit" | "optimize";

const TABS: { id: TabId; label: string; icon: typeof Zap; description: string }[] = [
  { id: "compress", label: "Compress", icon: Zap, description: "One click: drop a video, pick intent, get optimized files" },
  { id: "compare", label: "Compare", icon: BarChart3, description: "Encode the same clip 3 ways, pick size vs quality" },
  { id: "audit", label: "Audit", icon: ShieldCheck, description: "Find every video tag and its issues in your project" },
  { id: "optimize", label: "Optimize", icon: FolderOpen, description: "Batch encode videos, download a drop-in zip bundle" },
];

export default function App() {
  const [tab, setTab] = useState<TabId>("compress");
  const [setupState, setSetupState] = useState<"checking" | "ready" | "missing">("checking");

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

  if (isTauri() && setupState === "missing") {
    return <SetupScreen onReady={() => setSetupState("ready")} />;
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
      <Header />

      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-8 sm:px-6">
        {/* Tab strip */}
        <nav
          aria-label="Workbenches"
          className="flex flex-wrap gap-2 rounded-xl border border-border bg-card/40 p-1.5 backdrop-blur"
        >
          {TABS.map(({ id, label, icon: Icon, description }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-pressed={active}
                aria-label={`${label} — ${description}`}
                className={cn(
                  "group inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all",
                  active
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        {/* Hero / slim intro — only on Compress; the tool is the hero */}
        {tab === "compress" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
              <Zap className="size-3.5 text-primary" aria-hidden />
              Local-first · No uploads · No telemetry
            </span>
            <p className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              Ship smaller video,{" "}
              <span className="text-primary">straight from your own machine</span>.
            </p>
          </div>
        ) : null}

        {/* Workbenches — always mounted; inactive ones hidden so state survives tab switches */}
        <div className="mt-6">
          {([
            { id: "compress", node: <CompressView /> },
            { id: "compare", node: <CompareView /> },
            { id: "audit", node: <AuditView /> },
            { id: "optimize", node: <OptimizeView /> },
          ] as const).map(({ id, node }) => (
            <div
              key={id}
              hidden={tab !== id}
              inert={tab !== id}
              aria-hidden={tab !== id}
              className={cn(tab !== id && "hidden")}
            >
              {node}
            </div>
          ))}
        </div>

        {/* Onboarding hint */}
        <div className="mt-8 rounded-xl border border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground backdrop-blur">
          <ArrowDownToLine className="mr-1 inline size-3.5 text-primary" aria-hidden />
          All processing happens on your device. Output size and savings estimates appear on encode completion. Nothing you drop ever leaves this tab.
        </div>

      </main>

      <DiagnosticsFab />

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