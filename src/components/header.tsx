import { useEffect, useState } from "react";
import { CircleHelp, X } from "lucide-react";

import { StatusPill } from "@/features/status/StatusPill";
import { SettingsDrawer } from "@/components/settings-drawer";
import { isTauri, releaseFlavor } from "@/lib/tauri";

const KEY_MAP: { keys: string; action: string }[] = [
  { keys: "1", action: "Single-file press (compress one video)" },
  { keys: "2", action: "Folder shrink (batch one folder)" },
  { keys: "?", action: "Toggle this keyboard map" },
  { keys: "Esc", action: "Close overlays and drawers" },
];

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "?") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Keyboard map">
      <button type="button" aria-label="Close help" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-press-paper-edge bg-press-paper p-5 shadow-[0_16px_48px_oklch(0_0_0/0.5)]">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Keyboard map</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <dl className="mt-4 divide-y divide-border/60">
          {KEY_MAP.map(({ keys, action }) => (
            <div key={keys} className="flex items-center justify-between gap-4 py-2 text-xs">
              <kbd className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px]">{keys}</kbd>
              <span className="text-right text-muted-foreground">{action}</span>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[11px] text-muted-foreground">
          Everything is encoded on this device — no uploads, no telemetry.
        </p>
      </div>
    </div>
  );
}

export function Header({ onNavigate }: { onNavigate?: (flow: "home" | "single" | "folder") => void }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [flavor, setFlavor] = useState<"dev" | "prod" | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    releaseFlavor().then(setFlavor).catch(() => undefined);
  }, []);

  // Global keyboard map: 1 / 2 / ?
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "?") {
        setHelpOpen((v) => !v);
        return;
      }
      if (event.key === "1") onNavigate?.("single");
      if (event.key === "2") onNavigate?.("folder");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNavigate]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a
          href="/"
          aria-label="pixel-press home"
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-semibold tracking-tight"
        >
          <img
            src="/icon.svg"
            alt=""
            width={28}
            height={28}
            className="size-7 rounded-md"
            aria-hidden
          />
          <span>
            pixel-press
            <span className="ml-2 hidden text-[10px] font-medium uppercase tracking-[0.25em] text-primary lg:inline">
              The Press
            </span>
          </span>
        </a>

        <div className="flex shrink-0 items-center gap-2">
          {flavor ? (
            <span
              className="hidden rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary sm:inline"
              title={`Running the ${flavor} release flavor`}
            >
              {flavor}
            </span>
          ) : null}
          <StatusPill />
          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            aria-label="Keyboard map"
            aria-expanded={helpOpen}
            title="Keyboard map (?)"
            className="inline-flex items-center rounded-md border border-border bg-card/60 p-1.5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <CircleHelp className="size-4" aria-hidden />
          </button>
          <SettingsDrawer />
        </div>
      </div>
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </header>
  );
}
