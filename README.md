# pixel-press

A **local-first, local-only** video compressor and project auditor available as a native desktop app. FFmpeg and the local LLM are installed on first launch via a tested download manager; nothing is uploaded anywhere — every byte is processed on your device.

> Status: Tauri v2 overhaul in progress on branch `feat/tauri-desktop`. PWA milestone tagged locally as `v0.0.0-pwa-milestone` on `main`.

## Why this overhaul now

- The browser-WASM FFmpeg build crashes reliably on inputs we use (VP9 Memory-access-OOB); native build encodes cleanly.
- Bundled GPU-accelerated LLM inference is dramatically faster than WebLLM.
- Fully offline after first install: no browser sandbox, no cross-origin isolation tricks, no first-load download cliff.

Distribution format: GitHub Releases triggered by tag push (`v*.*.*`).

## Targets

| Platform | Architecture | Package |
| --- | --- | --- |
| macOS | Apple Silicon (arm64) | `.dmg` |
| macOS | Intel (x86_64) | `.dmg` |
| Windows | x64 | `.msi` |
| Linux | x86_64 | AppImage, `.deb` |
| Linux | ARM64 | AppImage, `.deb` |

> Windows ARM64 is currently not shipped: the native LLM backend (`llama-cpp-sys-4`) does not link on that toolchain yet. It will return once that is fixed.

## Releasing (maintainers)

Push a version tag; the Release workflow builds all five targets and creates a **draft** GitHub Release with the bundles attached. Review it, then publish from the Releases page.

```sh
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

You can also run a dry run from **Actions → Release → Run workflow** (pick the flavor: `prod` or `dev`): it builds all five targets without creating a release or uploading anything. Use it to verify the pipeline before tagging.

### Development flavor

Tag with a `-dev` suffix to build the **"pixel-press Dev"** flavor — it installs as a separate app (`pixel-press Dev` / `com.pixelpress.app.dev`) **alongside** production, never overrides it, and the release is marked as a **prerelease**:

```sh
git tag -a v0.1.1-dev -m "v0.1.1-dev"
git push origin v0.1.1-dev
```

## How it works

1. Drop a video → native `ffprobe` reads metadata (codec, resolution, fps, audio) in milliseconds.
2. The deterministic rule engine (default; always available) picks the codec/CRF. An optional local LLM (downloaded if you choose) does the same from your natural-language intent.
3. Codec fallbacks H.264 ↔ H.265 swap with a loud notice when one is unavailable.
4. Outputs:
   - `video-h264.mp4` (Universal)
   - `video-vp9.webm` (WebM)
5. Ready-to-drop `<video>` HTML and JSX snippets with `playsinline` / `muted` / `preload="metadata"`.

## Stack

Tauri v2 (Rust) · React · Tailwind + shadcn/ui · `llama.cpp`-based LLM (framework TBD) · `bun` (web build)

## Install

Download the release for your platform from GitHub Releases (`v*.*.*`). The installer is small (~15–30MB). On first launch, the app downloads ~80MB of system tools and ~210MB of LLM weights (or "Start in Rule Mode" to skip entirely).

## Project layout (`feat/tauri-desktop` branch)

```
src/                Frontend (React + TypeScript)
src-tauri/          Rust backend (Tauri)
docs/               Source docs + harness (gitignored — see D-014)
```

## License

[MIT](LICENSE). Forks are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution policy.

Notes: Native `ffmpeg` (GPL/LGPL) and LLM weights (Apache-2.0) are downloaded during first-run setup and ship with their own license disclosures. See `THIRD_PARTY_NOTICES.md`.
