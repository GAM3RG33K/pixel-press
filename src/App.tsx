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
import { EngineCheckCard } from "@/features/status/EngineCheckCard";
import { AiSettingsCard } from "@/features/settings/AiSettingsCard";
import { DiagnosticsFab } from "@/features/diagnostics/DiagnosticsFab";
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

  useEffect(() => {
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

        {/* Hero / intro */}
        {tab === "compress" ? (
          <section className="mt-6 flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
                <Zap className="size-3.5 text-primary" aria-hidden />
                Local-first · No uploads · No telemetry
              </span>
              <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                Ship smaller video,{" "}
                <span className="text-primary">straight from your browser</span>.
              </h1>
              <p className="mt-2 max-w-xl text-base text-muted-foreground">
                pixel-press uses FFmpeg compiled to WebAssembly on your device.
                Drop a clip, describe the goal, get production-ready
                <code className="mx-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">mp4</code>
                and
                <code className="mx-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">webm</code>
                outputs — with code you can paste.
              </p>
            </div>
          </section>
        ) : null}

        {/* Active workbench */}
        <div className="mt-6">
          {tab === "compress" ? <CompressView /> : null}
          {tab === "compare" ? <CompareView /> : null}
          {tab === "audit" ? <AuditView /> : null}
          {tab === "optimize" ? <OptimizeView /> : null}
        </div>

        {/* Onboarding hint */}
        <div className="mt-8 rounded-xl border border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground backdrop-blur">
          <ArrowDownToLine className="mr-1 inline size-3.5 text-primary" aria-hidden />
          All processing happens on your device. Output size and savings estimates appear on encode completion. Nothing you drop ever leaves this tab.
        </div>

        {/* Engine diagnostics and local AI settings visible on all tabs */}
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <EngineCheckCard />
          <AiSettingsCard />
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