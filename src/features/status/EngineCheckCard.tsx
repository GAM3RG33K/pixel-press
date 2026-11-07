import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { EncoderCapabilities } from "@/types/media";

type CheckState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      multithreaded: boolean;
      capabilities: EncoderCapabilities;
    };

export function EngineCheckCard() {
  const [state, setState] = useState<CheckState>({ status: "idle" });

  async function runCheck() {
    setState({ status: "loading" });
    try {
      const { getFfmpegService } = await import("@/lib/ffmpeg/service");
      const service = getFfmpegService();
      const engine = await service.load();
      const capabilities = await service.getCapabilities();
      setState({
        status: "ready",
        multithreaded: engine.multithreaded,
        capabilities,
      });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <section
      aria-labelledby="engine-check"
      className="mt-6 rounded-xl border border-border bg-card/50 p-5 backdrop-blur"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="engine-check" className="text-sm font-medium">
            Engine diagnostics
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Download the WASM core once and report the available encoders. The
            core is cached by the browser afterward.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={runCheck}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Play className="size-4" aria-hidden />
          )}
          {state.status === "loading" ? "Checking…" : "Run engine check"}
        </Button>
      </div>

      {state.status === "ready" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="inline-flex items-center gap-1.5 text-success">
            <CheckCircle2 className="size-4" aria-hidden />
            Core loaded
          </span>
          <Badge>
            {state.multithreaded ? "Multi-threaded" : "Single-threaded"}
          </Badge>
          <Badge tone={state.capabilities.libx264 ? "ok" : "warn"}>
            H.264 {state.capabilities.libx264 ? "available" : "missing"}
          </Badge>
          <Badge tone={state.capabilities.libx265 ? "ok" : "warn"}>
            H.265 {state.capabilities.libx265 ? "available" : "missing"}
          </Badge>
          <Badge tone={state.capabilities.libvpxVp9 ? "ok" : "warn"}>
            VP9 {state.capabilities.libvpxVp9 ? "available" : "missing"}
          </Badge>
          {!state.capabilities.libx265 ? (
            <span className="inline-flex items-center gap-1.5 text-warning">
              <AlertTriangle className="size-4" aria-hidden />
              H.265 will fall back to H.264 with a notice.
            </span>
          ) : null}
        </div>
      ) : null}

      {state.status === "error" ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          Engine check failed: {state.message}
        </p>
      ) : null}
    </section>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "border-success/40 text-success"
      : tone === "warn"
        ? "border-warning/40 text-warning"
        : "border-border text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${toneClass}`}
    >
      {children}
    </span>
  );
}
