import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Cpu, HardDrive, Loader2, RefreshCw, Settings, X, CheckCircle2, AlertCircle, Archive, Download, Upload, FileJson } from "lucide-react";

import { isTauri, cacheStats, clearCache, releaseFlavor, type CacheStats } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { EngineCheckCard } from "@/features/status/EngineCheckCard";
import { AiSettingsCard } from "@/features/settings/AiSettingsCard";

const SECTIONS = [
  { id: "engine", label: "Engine", Icon: Cpu },
  { id: "cache", label: "Cache", Icon: HardDrive },
  { id: "updates", label: "Updates", Icon: RefreshCw },
  { id: "backup", label: "Backup", Icon: Archive },
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
        className="inline-flex items-center gap-1.5 rounded-md border border-press-paper-edge bg-press-paper px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
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
          <aside className="relative flex h-full w-full max-w-[560px] flex-col overflow-hidden border-l border-press-paper-edge bg-background">
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
              <nav aria-label="Settings sections" className="flex w-[220px] shrink-0 flex-col gap-1 border-r border-border/60 p-3">
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
                ) : section === "backup" ? (
                  <BackupSection />
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

function BackupSection() {
  const [preview, setPreview] = useState<import("@/lib/config-backup").ImportPreview | null>(null);
  const [importedFile, setImportedFile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onExport = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { exportConfigJson, CONFIG_FILE_NAME } = await import("@/lib/config-backup");
      const json = await exportConfigJson();
      if (isTauri()) {
        // Tauri webview can't trigger browser blob downloads — write straight into ~/Downloads.
        const { downloadDir, join } = await import("@tauri-apps/api/path");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        const { invoke } = await import("@tauri-apps/api/core");
        const path = await join(await downloadDir(), CONFIG_FILE_NAME);
        await writeTextFile(path, json);
        void invoke("reveal_path", { path }).catch(() => undefined);
        setMessage(`Config exported to ${path}`);
        return;
      }
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = CONFIG_FILE_NAME;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("Config exported — pixel-press-config.json downloaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const onImportFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { previewImportJson } = await import("@/lib/config-backup");
      const json = await file.text();
      const result = await previewImportJson(json);
      if (!result.ok) {
        setError(result.error ?? "Not a valid pixel-press config file.");
        setPreview(null);
        return;
      }
      setImportedFile(file.name);
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const onConfirmImport = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const { applyImportPreview } = await import("@/lib/config-backup");
      await applyImportPreview(preview);
      setMessage(
        preview.noop
          ? "Nothing to import — config already matches."
          : `Imported ${preview.presetsToAdd.length} preset(s) and ${Object.keys(preview.preferencesToApply).length} setting(s).`,
      );
      setPreview(null);
      setImportedFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [preview]);

  return (
    <div className="space-y-4">
      <div className="press-paper rounded-xl p-4">
        <p className="text-sm font-semibold tracking-tight">Backup &amp; Restore</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          Export everything pixel-press knows about your preferences as one JSON file. Re-import it here or on another machine.
        </p>

        <div className="mt-3 rounded-lg border border-border/60 bg-secondary/30 p-3 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">Included</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Your presets (Plan review → Save as preset)</li>
            <li>AI &amp; engine preferences (mode, onboarding)</li>
            <li>Advanced user mode flag</li>
            <li>Default container &amp; auto-strip-audio preference</li>
          </ul>
          <p className="mt-2 border-t border-border/60 pt-2 text-[10px] text-muted-foreground/80">
            Not included: downloaded model weights (re-download from Local AI) · diagnostics logs · encode history · machine-local file paths
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onExport()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground transition-[filter] hover:brightness-110 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
            Export config…
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
          >
            <Upload className="size-3.5" aria-hidden />
            Import config…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImportFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {error ? (
          <p role="alert" className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{error}</p>
        ) : null}
        {message ? (
          <p role="status" className="mt-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-[11px] text-success">{message}</p>
        ) : null}
      </div>

      {preview ? (
        <div className="press-paper rounded-xl border border-warning/40 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold tracking-tight text-warning">
            <FileJson className="size-4" aria-hidden />
            Import preview — {importedFile}
          </p>
          <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            <p className="text-foreground">Nothing is applied until you confirm. Settings listed here will be replaced:</p>
            <ul className="mt-1 list-disc pl-4">
              {Object.entries(preview.preferencesToApply).map(([key, value]) => (
                <li key={key}><code className="text-foreground">{key}</code> → <code className="text-foreground">{String(value)}</code></li>
              ))}
              {Object.keys(preview.preferencesToApply).length === 0 ? <li>No scalar settings change</li> : null}
            </ul>
            <p className="mt-2 text-foreground">Presets to add ({preview.presetsToAdd.length}):</p>
            <ul className="mt-1 list-disc pl-4">
              {preview.presetsToAdd.map((preset) => (
                <li key={preset.id}>{preset.name} <span className="text-muted-foreground/70">({preset.recipe.targetCodec} · CRF {preset.recipe.crf})</span></li>
              ))}
              {preview.presetsToAdd.length === 0 ? <li>None — config has no (new) presets</li> : null}
            </ul>
            {preview.renamedPresets.length > 0 ? (
              <p className="mt-2 text-[10px] text-warning/90">Renamed on collision: {preview.renamedPresets.join(" · ")}</p>
            ) : null}
            <p className="mt-2 text-[10px] text-muted-foreground/80">Existing presets are never deleted or overwritten.</p>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setPreview(null); setImportedFile(null); }}
              className="rounded-md border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirmImport()}
              disabled={busy}
              className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
            >
              {busy ? "Importing…" : preview.noop ? "Nothing to import" : "Confirm import"}
            </button>
          </div>
        </div>
      ) : null}

      <p className="px-1 text-[10px] leading-snug text-muted-foreground/70">
        Format: <code>pixel-press-config.json</code> · schemaVersion 1 · plain human-readable JSON
      </p>
    </div>
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
    // NOTE: window.confirm() does NOT block in the Tauri webview — it pops a
    // native dialog but returns truthy immediately, so the cache would be wiped
    // before the user clicks anything. Use the awaited native dialog plugin in
    // the desktop app; plain confirm is fine in a browser.
    const ok = isTauri()
      ? await import("@tauri-apps/plugin-dialog").then(({ confirm }) =>
          confirm(
            "This removes staged input copies and probe/encode temp files. Downloaded tools and the AI model are not affected.",
            { title: "Clear cache?", kind: "warning" },
          ),
        )
      : window.confirm(
          "Clear cache? This removes staged input copies and probe/encode temp files. Downloaded tools and the AI model are not affected.",
        );
    if (!ok) return;
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
    <div className="press-paper rounded-xl p-4">
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
  const [bytes, setBytes] = useState<number>(0);
  const [contentLength, setContentLength] = useState<number>(0);
  // Hold the plugin's Update object so install() doesn't re-run check()
  // (a second network round-trip that can hang silently and looks like 0%).
  const updateRef = useRef<import("@tauri-apps/plugin-updater").Update | null>(null);

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
      updateRef.current = result;
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
    setState("installing"); setProgress(0); setBytes(0); setContentLength(0); setError(null);
    try {
      let result = updateRef.current;
      if (!result) {
        const { check: checkForUpdates } = await import("@tauri-apps/plugin-updater");
        result = await checkForUpdates();
        updateRef.current = result;
      }
      if (!result) { setState("up-to-date"); return; }
      let downloaded = 0;
      let total = 0;
      await result.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          setContentLength(total);
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength ?? 0;
          setBytes(downloaded);
          // GitHub's asset endpoint may not expose Content-Length; only
          // compute a percent when we actually know the size.
          setProgress(total > 0 ? Math.floor((downloaded / total) * 100) : null);
        } else if (event.event === "Finished") {
          setProgress(100);
        }
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
      <div className="press-paper rounded-xl p-4 text-[11px] text-muted-foreground">
        Updates are only available from the Tauri desktop build.
      </div>
    );
  }

  const renderState = () => {
    switch (state) {
      case "installing": {
        const known = progress !== null;
        const mb = (bytes / (1024 * 1024)).toFixed(1);
        const totalMb = contentLength > 0 ? (contentLength / (1024 * 1024)).toFixed(1) : null;
        return (
          <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 px-3 py-3">
            <div className="flex items-center justify-between text-[11px] text-primary">
              <span>{known ? "Installing update…" : "Downloading…"}</span>
              <span className="tabular-nums">
                {known ? `${progress}%` : totalMb ? `${mb} / ${totalMb} MB` : `${mb} MB`}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-primary/20" role="progressbar" aria-valuenow={known ? progress : undefined} aria-valuemin={0} aria-valuemax={100}>
              {known ? (
                <div className="h-full bg-primary transition-all duration-200" style={{ width: `${progress}%` }} />
              ) : (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
              )}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">Keep the app open; it will restart when the install finishes. Size is reported by the server when available.</p>
          </div>
        );
      }
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
    <div className="press-paper rounded-xl p-4">
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
