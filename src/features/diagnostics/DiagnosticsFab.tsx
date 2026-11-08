import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Clipboard,
  Download,
  Terminal,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  clearDiag,
  downloadDiagSnapshot,
  getDiagEntries,
  type DiagEntry,
} from "@/lib/diagnostics";
import { cn } from "@/lib/utils";

const LEVEL_TONE: Record<DiagEntry["level"], string> = {
  debug: "text-muted-foreground",
  info: "text-info",
  warn: "text-warning",
  error: "text-destructive",
};

function renderEntries(entries: readonly DiagEntry[]): string {
  return entries
    .map(
      (entry) =>
        `[${String(entry.elapsedMs).padStart(6)}ms] [${entry.level.toUpperCase()}] ${entry.scope}: ${entry.message}`,
    )
    .join("\n");
}

export function DiagnosticsFab() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<readonly DiagEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const tick = () => setEntries(getDiagEntries().slice(-120));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries.length]);

  const copyAll = async () => {
    const text = renderEntries(getDiagEntries());
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open ? (
        <div
          role="dialog"
          aria-label="Diagnostics"
          className="flex w-[min(480px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-card/95 shadow-2xl backdrop-blur"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Terminal className="size-4 text-primary" aria-hidden />
              Diagnostics
              <span className="text-xs font-normal text-muted-foreground">
                {entries.length} entries
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={copyAll} title="Copy log to clipboard">
                {copied ? (
                  <CheckCircle2 className="size-4 text-success" aria-hidden />
                ) : (
                  <Clipboard className="size-4" aria-hidden />
                )}
                <span className="sr-only sm:not-sr-only">Copy</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => downloadDiagSnapshot("pixel-press")} title="Download log as text file">
                <Download className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">Download</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => clearDiag()} title="Clear log">
                <Trash2 className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">Clear</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)} aria-label="Close diagnostics">
                <X className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
          <div ref={listRef} className="max-h-72 overflow-y-auto bg-background/60 px-3 py-2 font-mono text-[10px] leading-snug">
            {entries.length === 0 ? (
              <p className="px-2 py-6 text-center text-muted-foreground">No events yet. Do something in the app and come back.</p>
            ) : (
              entries.map((entry, index) => (
                <div key={index} className="grid grid-cols-[3.5rem_2.6rem_1fr] gap-2 py-0.5">
                  <span className="tabular-nums text-muted-foreground/60">{entry.elapsedMs}ms</span>
                  <span className={cn("uppercase", LEVEL_TONE[entry.level])}>{entry.level}</span>
                  <span className="min-w-0">
                    <span className="text-info/90">[{entry.scope}]</span>{" "}
                    <span className="break-words text-foreground/90">{entry.message}</span>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close diagnostics" : "Open diagnostics"}
        className="group flex size-11 items-center justify-center rounded-full border border-border bg-card/80 shadow-lg backdrop-blur transition-colors hover:border-primary/40 hover:bg-card"
      >
        <Terminal className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden />
      </button>
    </div>
  );
}