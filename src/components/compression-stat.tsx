/**
 * CompressionStat — the shared "what happened to the bytes" card.
 *
 * Two densities, one design language:
 *  - `hero` — the post-encode summary (big savings figure + full stats strip)
 *  - `row`  — used for "Try 3 quality levels" (compact, same visual grammar)
 *
 * Shows the before → after story, the share saved, and the exact encode
 * details as chips. Nothing uploads; this never leaves the device.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";

export interface CompressionStatProps {
  tag: string;
  /** Whole-percentage saved (0–100), rounded. */
  savedPct: number;
  inputBytes: number;
  outputBytes: number;
  /** Short detail chips, e.g. ["H.264", "CRF 26", "strip audio", "1920×800"]. */
  chips?: string[];
  /** One-line summary under the stats (e.g. "0.9 MB lighter · 1 output · encoded on this device"). */
  footnote?: string;
  recommended?: boolean;
  action?: ReactNode;
  className?: string;
  /** Hero layout (big figure, stats strip, before/after bar). */
  variant?: "hero" | "row";
}

function StatBar({ inputBytes, outputBytes }: { inputBytes: number; outputBytes: number }) {
  const ratio = inputBytes > 0 ? outputBytes / inputBytes : 1;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        <span>Before · {formatBytes(inputBytes)}</span>
        <span className="text-success">After · {formatBytes(outputBytes)}</span>
      </div>
      {/* Track shows the "lost" portion in translucent success; filled bar = remaining size */}
      <div
        className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-label="Output size relative to source"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((inputBytes > 0 ? outputBytes / inputBytes : 1) * 100)}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-success/70 to-success transition-[width] duration-700"
          style={{ width: `${Math.max(3, Math.min(100, ratio * 100))}%` }}
        />
      </div>
    </div>
  );
}

export function CompressionStat({
  tag,
  savedPct,
  inputBytes,
  outputBytes,
  chips = [],
  footnote,
  recommended = false,
  action,
  className,
  variant = "hero",
}: CompressionStatProps) {
  if (variant === "row") {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/60 bg-card/40 px-4 py-3",
          recommended && "border-primary/50 bg-primary/5",
          className,
        )}
      >
        <div className="min-w-16">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{tag}</div>
          <div className="font-display whitespace-nowrap text-4xl font-semibold leading-none tracking-tighter text-foreground tabular-nums">
            −{Math.max(0, Math.round(savedPct))}<span className="text-primary">%</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-muted-foreground">
            <span>{formatBytes(inputBytes)} → <span className="text-foreground">{formatBytes(outputBytes)}</span></span>
            {chips.length > 0 ? <span className="hidden font-mono text-[10px] opacity-80 sm:inline">{chips.join(" · ")}</span> : null}
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-gradient-to-r from-success/70 to-success transition-[width] duration-500"
              style={{ width: `${Math.max(3, Math.min(100, (outputBytes / Math.max(1, inputBytes)) * 100))}%` }}
            />
          </div>
        </div>
        {recommended ? (
          <span className="rounded-full border border-primary/50 bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
            recommended
          </span>
        ) : null}
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    );
  }

  // hero
  return (
    <section
      aria-label="Compression summary"
      className={cn("press-paper press-field overflow-hidden rounded-2xl", className)}
    >
      {/* Top strip: label + recommended badge */}
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-5 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-success">{tag}</span>
        {recommended ? (
          <span className="rounded-full border border-primary/50 bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
            recommended
          </span>
        ) : null}
      </div>

      <div className="grid gap-5 px-6 py-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center lg:gap-8">
        {/* Big savings figure */}
        <div className="flex flex-col items-center text-center md:items-start md:text-left">
          <p className="font-display whitespace-nowrap text-4xl font-semibold leading-none tracking-tighter text-foreground tabular-nums select-none">
            −{Math.max(0, Math.round(savedPct))}<span className="text-primary">%</span>
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">smaller on this device</p>
        </div>

        {/* Details: bytes + chips + bar */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-sm text-muted-foreground">{formatBytes(inputBytes)}</span>
            <span aria-hidden className="text-muted-foreground/60">→</span>
            <span className="font-mono text-xl font-semibold text-foreground">{formatBytes(outputBytes)}</span>
            {footnote ? <span className="w-full text-[11px] text-muted-foreground">{footnote}</span> : null}
          </div>

          {chips.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Encode details">
              {chips.map((chip) => (
                <li
                  key={chip}
                  className="rounded-md border border-border/70 bg-background/50 px-2 py-1 font-mono text-[10.5px] leading-none text-muted-foreground"
                >
                  {chip}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4">
            <StatBar inputBytes={inputBytes} outputBytes={outputBytes} />
          </div>

          {action ? <div className="mt-4 flex flex-wrap items-center gap-2">{action}</div> : null}
        </div>
      </div>
    </section>
  );
}
