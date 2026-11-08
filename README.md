# pixel-press

A **local-first, local-only** video compressor and project auditor that runs entirely in your browser. Videos are processed with FFmpeg compiled to WebAssembly; nothing is uploaded anywhere — every byte is decoded and encoded on your device.

> Status: MVP shipped. See `docs/progress.md` for the roadmap.

## Features

- **Smart Compress** — drop a clip, describe the goal in plain language or pick a preset (Web Hero Loop, Universal H.264, High-Efficiency VP9, Social 1080p, Preserve Quality), and get optimized `.mp4` (H.264) + `.webm` (VP9) outputs. Powered by a deterministic rule engine with an optional local AI intent parser (WebLLM) — never required.
- **Compare** — encode the same source at three quality levels, compare file size vs. quality with side-by-side previews, and pick the winner from a size/time table.
- **Project Auditor** — pick your local project folder (Chromium) or use an `<input webkitdirectory>` fallback to find every `<video>` tag, missing `muted`, missing `playsinline`, missing `preload="none"`, missing `poster`, missing WebM fallback, etc.
- **Scan & Optimize** — batch-encode the videos in your project folder, download a zip bundle with optimized files, ready-to-drop HTML/JSX snippets, and an optimization report. All locally.
- **Local AI (optional)** — SmolLM2-360M or Qwen2-0.5B via WebLLM is available behind a toggle. Default is the instant, zero-download Rule Engine.
- **Engine diagnostics** — probe availability of H.264, H.265 and VP9 encoders and multi-thread capability.
- **Copy-ready markup** — get `<video>` HTML and JSX snippets with correct `type` attributes, Poster, `playsinline`, `muted`, `preload`.

## Technical highlights

- **100 % client-side** — zero cloud compute, zero telemetry, zero account.
- **Cross-origin isolation** via `coi-serviceworker` enables multi-threaded FFmpeg where the browser allows; otherwise falls back to single-thread.
- **Privacy invariant** — no network request carries user files or metadata.
- **IPC-free architecture** — FFmpeg runs inside a Web Worker; main thread never blocks.
- **PWA** — installable, precached shell, works offline after first visit.
- **OPFS** staging with automatic cleanup of stale files (>24 h).

## Stack

Vite · React 19 · TypeScript · Tailwind v4 · `@ffmpeg/ffmpeg` 0.12 · `@ffmpeg/core-mt` 0.12 · `@mlc-ai/web-llm` · `vite-plugin-pwa` · `idb-keyval` · `jszip` · Bun (package manager)

## Getting started

```bash
bun install
bun run dev
```

Then open <http://localhost:5173>.

## Build

```bash
bun run build   # outputs dist/, PWA-precached
bun run preview # serve the last build
```

## Recommended hosting

Any static host that can send COOP/COEP headers: **Cloudflare Pages** (`_headers` already included) or **Vercel** (`vercel.json` already included). GitHub Pages works too with `gh-pages` (use the bundled `coi-serviceworker`).

## Project layout

```
src/
  components/    Shared UI (Header, DropZone)
  features/      Compress / Compare / Audit / Optimize / Settings workbenches
  lib/           FFmpeg service, planner, audit engine, settings store
  skills/        Rule engine (single source of truth for codec/CRF defaults)
  types/         Shared TypeScript domain types
docs/
  harness/       Internal decision log & roadmap (gitignored)
```

## License

[MIT](LICENSE). Forks are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution policy.

Note: FFmpeg core is GPL-2.0-or-later and loaded as an external runtime asset; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).