# Third-Party Notices

`pixel-press` source code is licensed under the [MIT License](LICENSE). The
project loads the following components at runtime or uses them during
development. They are not part of the MIT-licensed source tree.

## Runtime components

### FFmpeg WASM core (`@ffmpeg/core`, `@ffmpeg/core-mt` 0.12.10)

- License: **GPL-2.0-or-later**
- Source: <https://github.com/ffmpegwasm/ffmpeg.wasm>
- Distribution: loaded at runtime from a configurable URL
  (`VITE_FFMPEG_CORE_BASE_URL`, `VITE_FFMPEG_CORE_MT_BASE_URL`); it is never
  bundled into the app artifact.
- Included encoders relevant to this app: `libx264` (H.264), `libx265`
  (H.265/HEVC), `libvpx-vp9` (VP9).
- FFmpeg itself: <https://ffmpeg.org/legal.html>. x264 and x265 are GPL; the
  GPL obligations attach to the core binary and its source, which this project
  does not relicense.

### WebLLM (`@mlc-ai/web-llm`)

- License: **Apache-2.0**
- Source: <https://github.com/mlc-ai/web-llm>
- Distribution: bundled into the app as a JS dependency; loads model weights
  from Hugging Face on user opt-in (`Settings → Local AI`).
- Models (all Apache-2.0):
  - `SmolLM2-360M-Instruct-q4f16_1-MLC` — <https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct>
  - `Qwen2-0.5B-Instruct-q4f16_1-MLC` — <https://huggingface.co/Qwen/Qwen2-0.5B-Instruct>

## Development-only components

### Playwright (`@playwright/test`)

- License: Apache-2.0
- Used only to run end-to-end tests. Tests drive the locally installed Google
  Chrome. Bundled Playwright browsers are intentionally not installed, because
  bundled Chromium can lag patched Chrome releases.

### jszip (`jszip`)

- License: MIT
- Source: <https://github.com/Stuk/jszip>
- Used to bundle optimized videos into a downloadable `.zip` in Scan & Optimize.

### Vite, React, TypeScript, Tailwind CSS, Vitest

- Licenses: MIT / Apache-2.0 / ISC as declared by each package.
