import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Cpu, HardDrive, Loader2, Settings, X } from "lucide-react";

import { isTauri, cacheStats, clearCache, type CacheStats } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { EngineCheckCard } from "@/features/status/EngineCheckCard";
import { AiSettingsCard } from "@/features/settings/AiSettingsCard";

const SECTIONS = [{ id: "engine", label: "Engine" }, { id: "cache", label: "Cache" }] as const;
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
          <aside className="relative flex h-full w-full max-w-[420px] flex-col overflow-hidden border-l border-border bg-background">
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
              <aside className="flex w-36 shrink-0 flex-col gap-1 border-r border-border/60 p-3">
                {SECTIONS.map(({ id, label }) => {
                  const Icon = id === "engine" ? Cpu : HardDrive;
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
              </aside>
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
                ) : (
                  <CacheSection />
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
  if (error) return <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">{error}</p>;
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
