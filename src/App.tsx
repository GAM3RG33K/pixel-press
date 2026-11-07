import { ArrowDownToLine, Code2, ShieldCheck, Zap } from "lucide-react";

import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { EngineCheckCard } from "@/features/status/EngineCheckCard";

export default function App() {
  return (
    <div className="min-h-dvh">
      <Header />
      <main className="mx-auto w-full max-w-6xl px-6 pb-24 pt-16">
        <section className="flex flex-col items-start gap-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <Zap className="size-3.5 text-primary" aria-hidden />
            Local-first · No uploads · No telemetry
          </span>
          <h1 className="max-w-3xl text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
            Compress, compare, and audit web video{" "}
            <span className="text-primary">without leaving your browser</span>.
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            pixel-press runs FFmpeg compiled to WebAssembly on your device. Drop
            a video, get smaller files that still look right, and copy
            production-ready markup — all offline.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" disabled>
              <ArrowDownToLine className="size-4" aria-hidden />
              Drop a video to begin
            </Button>
            <Button size="lg" variant="outline" disabled>
              <Code2 className="size-4" aria-hidden />
              View source
            </Button>
          </div>
        </section>

        <section
          aria-labelledby="shell-status"
          className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <h2 id="shell-status" className="sr-only">
            Application shell status
          </h2>
          <StatusCard
            title="Engine"
            body="FFmpeg WASM boots lazily in a dedicated worker. Multi-threaded when the browser grants cross-origin isolation, single-threaded otherwise."
          />
          <StatusCard
            title="Private by default"
            body="Video bytes never touch a network request. Staging happens in the Origin Private File System and is cleaned up automatically."
          />
          <StatusCard
            title="Works offline"
            body="Installable PWA with a precached shell. The app boots and runs with the network switched off."
          />
        </section>

        <EngineCheckCard />
      </main>
      <footer className="border-t border-border/60 px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden />
            No account, no backend, no tracking.
          </span>
          <span>pixel-press · MIT licensed</span>
        </div>
      </footer>
    </div>
  );
}

function StatusCard({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-xl border border-border bg-card/50 p-5 backdrop-blur">
      <h3 className="text-sm font-medium tracking-wide text-foreground">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </article>
  );
}
