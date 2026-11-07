import { useEffect, useState } from "react";
import { BrainCircuit, Cpu } from "lucide-react";

import {
  getIsolationState,
  supportsSharedArrayBuffer,
  supportsWebGpu,
  type IsolationState,
} from "@/lib/coi";
import { cn } from "@/lib/utils";

export interface StatusPillProps {
  className?: string;
}

interface RuntimeCapabilities {
  isolation: IsolationState;
  sharedArrayBuffer: boolean;
  webGpu: boolean;
}

const initialState: RuntimeCapabilities = {
  isolation: "unsupported",
  sharedArrayBuffer: false,
  webGpu: false,
};

export function StatusPill({ className }: StatusPillProps) {
  const [caps, setCaps] = useState<RuntimeCapabilities>(initialState);

  useEffect(() => {
    setCaps({
      isolation: getIsolationState(),
      sharedArrayBuffer: supportsSharedArrayBuffer(),
      webGpu: supportsWebGpu(),
    });
  }, []);

  const engineDot =
    caps.isolation === "isolated"
      ? "bg-success"
      : caps.isolation === "not-isolated"
        ? "bg-warning"
        : "bg-muted-foreground/50";

  const engineLabel =
    caps.isolation === "isolated"
      ? "Multi-Threaded Ready"
      : caps.isolation === "not-isolated"
        ? "Single-Threaded Safe Mode"
        : "Engine Unknown";

  const engineTitle =
    caps.isolation === "isolated"
      ? "Cross-origin isolated; SharedArrayBuffer available for multi-threaded FFmpeg."
      : caps.isolation === "not-isolated"
        ? "No cross-origin isolation; FFmpeg runs on a single thread. Encoding will be slower."
        : "FFmpeg has not reported its capabilities yet.";

  const aiLabel = caps.webGpu ? "Rule Mode · WebGPU Ready" : "Instant Rule Mode";
  const aiTitle = caps.webGpu
    ? "A local model can be enabled; WebGPU is available."
    : "Rule engine only. No model download required; WebGPU unavailable.";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur",
        className,
      )}
      aria-label="Engine and AI status"
    >
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap"
        title={engineTitle}
      >
        <span className={cn("size-1.5 rounded-full", engineDot)} aria-hidden />
        <Cpu className="size-3.5" aria-hidden />
        <span>{engineLabel}</span>
        {caps.sharedArrayBuffer && caps.isolation === "isolated" ? (
          <span className="sr-only">SharedArrayBuffer enabled</span>
        ) : null}
      </span>

      <span className="h-3 w-px bg-border" aria-hidden />

      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap"
        title={aiTitle}
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            caps.webGpu ? "bg-info" : "bg-muted-foreground/50",
          )}
          aria-hidden
        />
        <BrainCircuit className="size-3.5" aria-hidden />
        <span>{aiLabel}</span>
      </span>
    </div>
  );
}
