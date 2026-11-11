# pixel-press

A **local-first, local-only** video compressor available as a native desktop app. FFmpeg and the local LLM are installed on first launch via a tested download manager; nothing is uploaded anywhere — every byte is processed on your device.

> Status: Tauri v2 desktop app on `main`; CI release pipeline live (4 shipping targets, tag-push triggered). Recent additions: tasks-in-progress tray, huge-file smart probe, consolidated cache + Settings drawer (Engine | Cache | Updates), built-in update check. PWA milestone preserved at `v0.0.0-pwa-milestone` on `main`.

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
| Linux | x86_64 | AppImage, `.deb` |
| Linux | ARM64 | AppImage, `.deb` |

> Windows is currently not shipped: the last release run failed on the Windows leg. It will return once the build failure is diagnosed and fixed. Windows ARM64 likewise paused (native LLM backend does not link on MSVC ARM64).

## Releasing (maintainers)

Push a version tag; the Release workflow builds all four targets and creates a **draft** GitHub Release with the bundles attached. Review it, then publish from the Releases page.

```sh
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

Or run the interactive wizard — it asks for the flavor (dev default), shows the latest tag for that flavor, suggests the next major/minor/patch versions, lets you edit the final tag string, and pushes the tag for you:

```sh
bun run release
```

You can also run a dry run from **Actions → Release → Run workflow** (pick the flavor: `prod` or `dev`): it builds all four targets without creating a release or uploading anything. Use it to verify the pipeline before tagging.

### Development flavor

Tag with a `-dev` suffix to build the **"pixel-press Dev"** flavor — it installs as a separate app (`pixel-press Dev` / `com.pixelpress.app.dev`) **alongside** production, never overrides it, and the release is marked as a **prerelease**:

```sh
git tag -a v0.1.1-dev -m "v0.1.1-dev"
git push origin v0.1.1-dev
```

## Updating

The desktop app can update itself in place from **Settings → Updates** — same as most desktop apps: check, download, install, restart. The flavor determines which release channel it tracks:

- **production** (`pixel-press`) → latest published production release on GitHub Releases.
- **development** (`pixel-press Dev`) → newest dev build published to `gam3rg33k.github.io/pixel-press/dev-latest.json` (a static manifest re-published on every dev tag push; mirror of the dev prerelease's `latest.json`).

No silent updates; you always see what will be installed, and you can install later.

## How it works

The home is one drop surface — no tabs. Drop **one video** (smallest sensible encode) or **a folder / several videos** (folder Check-Up, then one pass, mirrored into `pixel-pressed-<timestamp>/`). Goal chips — Smallest file · Good enough quality · Social 1080p · Keep it crisp — pre-pick the intent in plain words.

1. Drop a video → native `ffprobe` reads metadata from the file's headers in milliseconds — even for 10 GB files (huge files encode straight from the untouched source path; no in-memory copy).
2. The deterministic rule engine (default; always available) picks the codec/CRF. An optional local LLM (downloaded if you choose) does the same from your natural-language intent.
3. Codec fallbacks H.264 ↔ H.265 swap with a loud notice when one is unavailable.
4. A bottom-center tray shows every running task (single-file compress, folder shrink, first-launch downloads); click a row to jump back into the flow or cancel it — work keeps running when you go back to the press.
5. Outputs:
   - `video-h264.mp4` (Universal H.264)
   - `video-vp9.webm` (WebM)
6. After encode: a savings-% hero, before/after bar, one-click downloads, a "Try 3 quality levels" panel, and optional `<video>` snippet copy.

Long filenames animate as a marquee inside their container — sibling text (buttons, %, MB/s, Cancel) always stays fully visible. Settings (gear icon) holds Engine diagnostics and a Cache section with live usage + wipe.

## Stack

Tauri v2 (Rust) · React · Tailwind + shadcn/ui · native llama.cpp via `llama-cpp-4` (SmolLM2-360M, GGUF) · `bun` (web build) · plain `bash` release wizard (`bun run release`)

## Install

Download the release for your platform from GitHub Releases (`v*.*.*`). The installer is small (~15–30MB). On first launch, the app downloads ~80MB of system tools and ~210MB of LLM weights (or "Start in Rule Mode" to skip entirely).

## Project layout (`main`)

```
src/                  Frontend (React + TypeScript)
  lib/tasks/          Task registry (tray) — pub/sub, useSyncExternalStore
  components/         marquee, tasks-tray, settings-drawer, DropZone
src-tauri/            Rust backend (Tauri)
  src/                encode.rs · setup.rs (first-launch downloads, cache) · llm.rs
docs/                 Source docs + harness (gitignored — see D-014)
```

## License

[MIT](LICENSE). Forks are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution policy.

Notes: Native `ffmpeg` (GPL/LGPL) and LLM weights (Apache-2.0) are downloaded during first-run setup and ship with their own license disclosures. See `THIRD_PARTY_NOTICES.md`.
