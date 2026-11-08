import { useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, Play, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { codecFallbackNotice, uniqueFallbackNotices } from "@/lib/ffmpeg/plan";
import type { EncoderCapabilities } from "@/types/media";
import { isTauri, tauriApi } from "@/lib/tauri";

import { CodecFallbackNotice } from "./CodecFallbackNotice";

type CheckState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      multithreaded: boolean;
      capabilities: EncoderCapabilities;
    };

type NativeCheckState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; path: string; summary: string };

export function EngineCheckCard() {
  const [state, setState] = useState<CheckState>({ status: "idle" });
  const [nativeState, setNativeState] = useState<NativeCheckState>({ status: "idle" });

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

  async function runNativeCheck() {
    setNativeState({ status: "loading" });
    try {
      const path = await tauriApi.generateTestClip();
      const json = await tauriApi.ffprobeJson(path);
      const parsed = JSON.parse(json) as {
        streams?: { codec_name?: string; width?: number; height?: number }[];
        format?: { duration?: string };
      };
      const v = parsed.streams?.find((s) => s.codec_name);
      const summary = `${v?.width ?? "?"}x${v?.height ?? "?"} · ${v?.codec_name ?? "?"} · ${
        parsed.format?.duration ? Number(parsed.format.duration).toFixed(1) + "s" : "unknown duration"
      }`;
      setNativeState({ status: "ready", path, summary });
    } catch (error) {
      setNativeState({
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
        </div>
      ) : null}

      {state.status === "ready" ? (
        <CodecFallbackNotice
          notices={uniqueFallbackNotices(
            [codecFallbackNotice("h265", state.capabilities)].filter(
              (notice): notice is NonNullable<typeof notice> =>
                Boolean(notice),
            ),
          )}
        />
      ) : null}

      {state.status === "error" ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          Engine check failed: {state.message}
        </p>
      ) : null}

      {isTauri() ? (
        <div className="mt-4 rounded-lg border border-info/30 bg-info/5 p-3 text-xs text-info">
          <p className="font-medium">Running in Tauri (native engine)</p>
          <p className="mt-1 opacity-90">
            The web-WASM engine below is not required — native FFmpeg already works here.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={runNativeCheck}
            disabled={nativeState.status === "loading"}
          >
            {nativeState.status === "loading" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Terminal className="size-4" aria-hidden />
            )}
            {nativeState.status === "loading" ? "Probing…" : "Test native ffprobe"}
          </Button>
          {nativeState.status === "ready" ? (
            <p className="mt-2 text-[11px]">
              <CheckCircle2 className="mr-1 inline size-3.5 text-success" aria-hidden />
              Native probe: {nativeState.summary}
              <br />
              <code className="font-mono text-[10px] opacity-80">{nativeState.path}</code>
            </p>
          ) : null}
          {nativeState.status === "error" ? (
            <p className="mt-2 text-[11px] text-destructive" role="alert">
              Native ffprobe failed: {nativeState.message}
            </p>
          ) : null}
        </div>
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
