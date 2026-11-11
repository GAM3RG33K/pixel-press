import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Cpu, HardDrive, Loader2, RefreshCw, Settings, X, CheckCircle2, AlertCircle } from "lucide-react";

import { isTauri, cacheStats, clearCache, releaseFlavor, type CacheStats } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { EngineCheckCard } from "@/features/status/EngineCheckCard";
import { AiSettingsCard } from "@/features/settings/AiSettingsCard";

const SECTIONS = [
  { id: "engine", label: "Engine", Icon: Cpu },
  { id: "cache", label: "Cache", Icon: HardDrive },
  { id: "updates", label: "Updates", Icon: RefreshCw },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/**
 * Right-side settings drawer holding engine diagnostics, local AI settings,
 * and cache management. Sidebar switches between sections.
 */
export function SettingsDrawer() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SectionId>("engine");

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="settings-drawer"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/60 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        title="Settings — engine diagnostics & cache"
      >
        <Settings className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Settings</span>
      </button>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Settings" id="settings-drawer">
          <button
            type="button"
            aria-label="Close settings panel"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <aside className="relative flex h-full w-full max-w-[456px] flex-col overflow-hidden border-l border-border bg-background">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                <Settings className="size-4 text-primary" aria-hidden />
                Settings
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="flex flex-1 overflow-hidden">
              <nav aria-label="Settings sections" className="flex w-[180px] shrink-0 flex-col gap-1 border-r border-border/60 p-3">
                {SECTIONS.map(({ id, label, Icon }) => {
                  const active = section === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSection(id)}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
                        active
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <Icon className="size-3.5" aria-hidden />
                      {label}
                    </button>
                  );
                })}
              </nav>
              <div className="flex-1 overflow-y-auto px-4 pb-4 pt-4">
                {section === "engine" ? (
                  <div className="space-y-4">
                    {isTauri() ? (
                      <p className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-[11px] text-info">
                        Native engine — encodes run on the downloaded FFmpeg. No WASM cores involved.
                      </p>
                    ) : null}
                    <EngineCheckCard />
                    <AiSettingsCard />
                  </div>
                ) : section === "cache" ? (
                  <CacheSection />
                ) : (
                  <UpdatesSection />
                )}
              </div>
            </div>
            </aside>
          </div>,
          document.body,
        )
        : null}
    </>
  );
}

function CacheSection() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setStats(await cacheStats()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const onClear = useCallback(async () => {
    if (!window.confirm("Clear cache? This removes staged input copies and probe/encode temp files. Downloaded tools and the AI model are not affected.")) return;
    setClearing(true);
    try { await clearCache(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setClearing(false); }
  }, [load]);
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-[11px] text-destructive">
        <p>{error}</p>
        <button type="button" onClick={() => void load()} className="mt-2 underline underline-offset-2 hover:text-destructive">Try again</button>
      </div>
    );
  }
  if (!stats) return <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />;
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 backdrop-blur">
      <p className="text-2xl font-bold tabular-nums">{formatBytes(stats.total_bytes)}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">total cache — staged inputs, probe/encode temp files</p>
      <div className="mt-4 divide-y divide-border/60 rounded-lg border border-border/60">
        {stats.parts.map((part) => (
          <div key={part.label} className="flex items-center justify-between px-3 py-2 text-xs">
            <span className="text-muted-foreground">{part.label}</span>
            <span className="tabular-nums">{formatBytes(part.bytes)}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => void onClear()}
        disabled={clearing}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15 disabled:opacity-50"
      >
        {clearing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <HardDrive className="size-3.5" aria-hidden />}
        {clearing ? "Clearing…" : "Clear cache"}
      </button>
      <p className="mt-3 text-[10px] text-muted-foreground">Downloaded FFmpeg tools and the Local AI model are not affected.</p>
    </div>
  );
}

function UpdatesSection() {
  const [flavor, setFlavor] = useState<"dev" | "prod" | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [state, setState] = useState<"idle" | "checking" | "up-to-date" | "available" | "error" | "installing" | "ready">("idle");
  const [update, setUpdate] = useState<{ version: string; body: string; date: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      setFlavor(await releaseFlavor());
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        setCurrentVersion((await getVersion()) ?? "");
      } catch {
        setCurrentVersion("");
      }
    })();
  }, []);

  const check = useCallback(async () => {
    if (!flavor) return;
    setState("checking"); setError(null); setUpdate(null); setProgress(null);
    try {
      const { check: checkForUpdates } = await import("@tauri-apps/plugin-updater");
      const result = await checkForUpdates();
      if (!result) { setState("up-to-date"); return; }
      setUpdate({ version: result.version, body: result.body ?? "", date: result.date ?? "" });
      setState("available");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setState("error");
    }
  }, [flavor]);

  const install = useCallback(async () => {
    if (!update) return;
    setState("installing"); setProgress(0); setError(null);
    try {
      const { check: checkForUpdates } = await import("@tauri-apps/plugin-updater");
      const result = await checkForUpdates();
      if (!result) { setState("up-to-date"); return; }
      let downloaded = 0;
      let contentLength = 0;
      await result.downloadAndInstall((event) => {
        if (event.event === "Started") { contentLength = event.data.contentLength ?? 0; }
        else if (event.event === "Progress") {
          downloaded += event.data.chunkLength ?? 0;
          setProgress(contentLength > 0 ? Math.floor((downloaded / contentLength) * 100) : 0);
        } else if (event.event === "Finished") { setProgress(100); }
      });
      setState("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setState("error");
    }
  }, [update]);

  const restart = useCallback(async () => {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch { /* best effort; user can quit manually */ }
  }, []);

  if (!isTauri()) {
    return (
      <div className="rounded-xl border border-border bg-card/50 p-4 text-[11px] text-muted-foreground backdrop-blur">
        Updates are only available from the Tauri desktop build.
      </div>
    );
  }

  const renderState = () => {
    switch (state) {
      case "installing":
        return (
          <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 px-3 py-3">
            <div className="flex items-center justify-between text-[11px] text-primary">
              <span>Installing update…</span>
              <span className="tabular-nums">{progress ?? 0}%</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-primary/20">
              <div className="h-full bg-primary transition-all duration-200" style={{ width: `${progress ?? 0}%` }} />
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">Keep the app open; it will restart when the install finishes.</p>
          </div>
        );
      case "ready":
        return (
          <div className="mt-4 rounded-lg border border-success/30 bg-success/5 px-3 py-3">
            <p className="text-[11px] font-semibold text-success">Update installed.</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Restart pixel-press to apply v{update?.version}.</p>
            <button type="button" onClick={() => void restart()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs font-medium text-success transition-colors hover:bg-success/15">
              Restart & apply
            </button>
          </div>
        );
      case "available":
        return (
          <div className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
            <p className="text-xs font-semibold text-warning">New release: v{update?.version}</p>
            {update?.body ? <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{update.body.slice(0, 280)}{update.body.length > 280 ? "…" : ""}</p> : null}
            <button type="button" onClick={() => void install()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs font-medium text-success transition-colors hover:bg-success/15">Download & install</button>
          </div>
        );
      case "up-to-date":
        return (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-[11px] text-success">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>You're on the latest {flavor} release.</span>
          </div>
        );
      case "error":
        return (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
            <p className="flex items-start gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />{error ?? "Update check failed."}</p>
            <button type="button" onClick={() => void check()} className="mt-2 underline underline-offset-2">Retry</button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold tracking-tight">Updates</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Current version{currentVersion ? ` v${currentVersion.replace(/^v/, "")}` : "…"}
            {flavor ? <span className="ml-2 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">{flavor}</span> : null}
          </p>
        </div>
        <button type="button" onClick={() => void check()} disabled={!flavor || state === "checking" || state === "installing"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-accent px-3 py-1.5 text-[11px] font-medium transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50">
          {state === "checking" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
          {state === "checking" ? "Checking…" : "Check for updates"}
        </button>
      </div>
      {renderState()}
    </div>
  );
}
