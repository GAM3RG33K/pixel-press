# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Semi-tech-aware mainstream users — people who understand what video compression is and how it saves disk space, and who want it to simply work. Not software engineers, not laymen: someone comfortable with desktop apps who shouldn't need to learn codec vocabulary (CRF, H.264 vs VP9, two-pass) to get a good result.

Note: the distribution target is desktop (Tauri v2 shell), and the user recorded the platform as `adaptive`.

## Product Purpose

pixel-press compresses video **entirely on the user's machine** — no uploads, no accounts, no telemetry. A user drops a video, picks a goal (or types one), and gets a smaller, still-good file out the other side. Success looks like: *smallest sensible file, zero effort* — the user double-clicks, gets an output that visibly saved space without visible quality loss, and never thinks about video tooling again.

## Positioning

Local-first and fully local after first install — a native desktop app where FFmpeg (and the optional on-device LLM) install once, verified, into the app's data dir, and every encode happens on the machine. Unlike browser-based compressors, there is no upload step, no file-size ceiling from a server, and no WASM crash class; unlike CLI tools (ffmpeg directly), the decisions are made for you by a rule engine or an optional local LLM reading plain language.

## Operating Context

- People shipping video-heavy sites (hero loops, background videos, documentation clips) who need small MP4/WebM outputs plus ready-to-paste `<video>` markup.
- People tidying a folder of videos (e.g. a show's season of 480p episodes) with a batch optimize + zip workflow.
- People auditing a web codebase for missing `preload="none"`, posters, WebM sources, and muted-decoration audio — scanned locally, no upload of source.
- Runs fully offline after first launch; the app data dir holds downloaded ffmpeg/ffprobe and the optional LLM weights.

## Capabilities and Constraints

- Native encode/probe via downloaded (SHA-256-verified) ffmpeg/ffprobe; no browser sandbox limits. Tauri native drops probe the real file path and encode in place (source untouched); huge files (>2 GB) get the same treatment — nothing is staged in memory before probe.
- Deterministic rule engine always available; optional local SmolLM2-360M (Apache-2.0) via native llama.cpp for intent → plan, opt-in from Settings → Local AI.
- A bottom-center tray surfaces every in-flight task (encodes, audit scans, first-launch downloads) with progress + cancel, and jump-to-tab; switching tabs never cancels running work.
- Long filenames render as overflow-aware marquee (pause on hover/focus-within; `prefers-reduced-motion` falls back to ellipsis).
- Three workbenches for conversion: Compress (intent → plan → encode), Compare (same source, three quality anchors), Optimize (folder batch; single file → `name_optimized.ext` next to source, bulk → mirrored `pixel-pressed-<timestamp>/` folder).
- Audit: local regex scan of HTML/JSX/TSX/Vue/Svelte/Astro for video-related issues; no network.
- Consolidated `$APPDATA/cache` for all staging/probe/encode temp artifacts; Settings drawer shows live usage with a clear button (ffmpeg tools and LLM weights untouched).
- GPL/LGPL FFmpeg and Apache-2.0 LLM weights are first-run downloads, not bundled; notices ship (see THIRD_PARTY_NOTICES.md).
- Built-in update check (Settings → Updates): compares the running version against the latest release for the app's flavor (dev builds see only dev prereleases; production builds see only published prod releases), lists per-asset download buttons, downloads the installer to `~/Downloads`, and asks the user to install manually — no silent overwrite.
- Platform targets (distribution): GitHub Releases on tag push (`v*.*.*`) — macOS Apple Silicon + Intel, Linux x64/ARM64 (4 legs). `-dev`-suffixed tags ship the development flavor ("pixel-press Dev", `com.pixelpress.app.dev`) as a draft prerelease, installable alongside production. Windows not shipped (x64 release leg failing — excluded pending diagnosis; ARM64 paused: native LLM backend does not link on MSVC ARM64). macOS builds are ad-hoc signed (unsigned distribution — no Developer ID yet).
- No bundling of FFmpeg or LLM weights in the installer; installer stays ~15–30MB.
- PWA milestone is frozen at tag `v0.0.0-pwa-milestone`; the Tauri line is the product.

## Brand Commitments

- Name: **pixel-press** (wordmark: lowercase, tight tracking; never "PixelPress" / "Pixel Press").
- Identity: "The Press" mark — three white scan bars compressing into a violet press plate (`#8B5CF6`) on near-black (`#0D0D12`); see `docs/brand/IDENTITY.md`.
- Tagline: "Compress like you mean it."
- MIT license; forks welcome (see CONTRIBUTING.md).
- Local-first identity is binding: future work must not introduce uploads, required accounts, telemetry, or cloud-required flows.

## Evidence on Hand

- Working app on `main` (Tauri v2 + React + Tailwind + shadcn/ui); PWA milestone preserved at tag `v0.0.0-pwa-milestone`.
- Rule engine rules in `src/skills/compress-video-rules.ts`; LLM planner in `src-tauri/src/llm.rs`.
- Test clips and a working sample pipeline (native ffprobe verification passes on this machine).
- Docs/harness: `docs/harness/{decisions,open-questions,progress}.md`; brand assets in `docs/brand/`.
- Absences: no testimonials, no user research data, no benchmarks published yet; no App Store presence; Linux builds untested this far in development (first release run built macOS + Linux legs; Windows leg excluded).

## Product Principles

1. **Nothing leaves the machine.** No upload, no account, no telemetry — ever.
2. **Zero effort over expert control.** Defaults decide correctly; CRF vocabulary is optional, not required.
3. **Native reliability on desktop.** The encode must not crash class-of-failure; downloads on first run are explicit, verified, and sized before install.
4. **One local decision engine, two ways to drive it.** Rule engine for speed and trust; the optional local LLM for plain-language intent — never the cloud.
5. **Small is a user feeling, not a number.** Success is "it just got 50% smaller and still looks right," not a spec sheet.

## Accessibility & Inclusion

- The app must remain a fully usable keyboard-navigable desktop app; rule engine (not the LLM) is the guaranteed accessible path for all encode decisions.
- Local AI is opt-in per-setting (toggle in Settings); nothing about the core encode flow requires it.
- Dark UI is the designed appearance; contrast and 4.5:1 text targets apply to all new UI.
