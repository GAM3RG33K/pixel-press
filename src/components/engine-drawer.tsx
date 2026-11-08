import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Cpu, X } from "lucide-react";

import { isTauri } from "@/lib/tauri";
import { EngineCheckCard } from "@/features/status/EngineCheckCard";
import { AiSettingsCard } from "@/features/settings/AiSettingsCard";

/**
 * Right-side drawer holding engine diagnostics + local AI settings.
 * Keeps the workbench screens single-task; these are occasional surfaces,
 * not part of the encode loop.
 */
export function EngineDrawer() {
  const [open, setOpen] = useState(false);

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
        aria-controls="engine-drawer"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/60 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        title="Engine diagnostics & local AI settings"
      >
        <Cpu className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Engine</span>
      </button>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Engine and local AI settings" id="engine-drawer">
          <button
            type="button"
            aria-label="Close engine panel"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <aside className="relative flex h-full w-full max-w-[420px] flex-col overflow-hidden border-l border-border bg-background">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                <Cpu className="size-4 text-primary" aria-hidden />
                Engine &amp; Local AI
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
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {isTauri() ? (
                <p className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-[11px] text-info">
                  Native engine — encodes run on the downloaded FFmpeg. No WASM cores involved.
                </p>
              ) : null}
              <EngineCheckCard />
              <AiSettingsCard />
            </div>
            </aside>
          </div>,
          document.body,
        )
        : null}
    </>
  );
}
