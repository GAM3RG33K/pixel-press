# pixel-press

A **local-first, local-only** video compressor and project auditor that ships as a native desktop app. Videos are encoded by a native `ffmpeg` binary shipped inside the bundle; LLM inference is fully local; nothing is uploaded anywhere.

> Status: Tauri v2 overhaul in progress on branch `feat/tauri-desktop`. The PWA milestone is tagged `v0.0.0-pwa-milestone` on `main`.

## Why a desktop app now

- The `libvpx-vp9` encoder in the stock `@ffmpeg/core-mt` consistently crashed on our WASM inputs (`memory access out of bounds`); the H.264 `libx264` survivor works, but WASM is a constant compromise on quality/speed.
- Bundled native `ffmpeg` gives us full performance, full codec support (H.264, H.265 with source offer, VP8, VP9), and full offline operation from first launch.
- Bundled native LLM (inference framework TBD) gives us fast inference without WebGPU flakiness.

Distribution format: GitHub Releases triggered by tag push (`v*.*.*`).

## Targets

| Platform | Architecture | Package |
| --- | --- | --- |
| macOS | Universal (arm64 + x86_64) | `.dmg` |
| Windows | x64 | `.msi` |
| Windows | ARM64 | `.msi` |
| Linux | x86_64 | AppImage, `.deb` |
| Linux | ARM64 | AppImage, `.deb` |

## How it works

1. Drop a video → native `ffprobe` reads metadata (codec, resolution, fps, audio) in milliseconds.
2. The deterministic rule engine (default; always available) picks the codec/CRF; the optional bundled LLM does the same thing from your natural-language intent.
3. The encoder list is probed at first run; fallbacks H.264 ↔ H.265 swap with a loud notice when one is unavailable.
4. Outputs:
   - `video-h264.mp4` (Universal)
   - `video-vp8.webm` (WebM)
5. Ready-to-drop `<video>` HTML and JSX snippets with `playsinline`/`muted`/`preload="metadata"`.

## Stack

Tauri v2 (Rust) · React · Tailwind + shadcn/ui · `ffmpeg`/`ffprobe` (bundled) · `llama.cpp`-based LLM (framework TBD) · `vite-plugin-pwa` pending removal · Bun (package manager, web)

## Project layout (`feat/tauri-desktop` branch)

```
src/                Frontend (React + TypeScript)
src-tauri/          Rust backend (Tauri)
  src/main.rs       App entry
  resources/        Bundled ffmpeg + LLM weights
docs/               Source docs + harness (gitignored — see D-014)
```

## License

[MIT](LICENSE). Forks are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution policy.

Notes: Native `ffmpeg` and LLM weights are GPL/Apache-2 respectively and ship as separate components. See `THIRD_PARTY_NOTICES.md`.
