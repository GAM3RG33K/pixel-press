# Third-Party Notices

`pixel-press` source code is licensed under the [MIT License](LICENSE). The Tauri desktop app downloads the following third-party components on first launch. They are not part of the MIT-licensed source tree and are fetched from the project's GitHub Releases.

## Native FFmpeg + ffprobe (downloaded on first launch)

- License: **GPL-2.0-or-later** for libx264 and libx265 paths; **LGPL-2.1-or-later** for the FFmpeg base library
- Source: <https://git.ffmpeg.org/gitweb/ffmpeg.git>
- Distributor: Gyan.dev builds for Windows, jellyfin-ffmpeg, Homebrew for macOS/Linux
- Included encoders relevant to this app:
  - `libx264` (H.264 — universal baseline)
  - `libx265` (H.265 — primary MP4 when source offer is provided)
  - `libvpx` (VP8 — WebM)

Users who redistribute modified builds of the app must comply with the GPL terms for the downloaded FFmpeg.

## Native LLM weights (downloaded on first launch)

- License: **Apache-2.0**
- Candidate model (subject to eval):
  - `SmolLM2-360M-Instruct` — <https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct>

See `docs/harness/model-registry.md` for the model selection process.

## Rust crates (Tauri + plugins)

- `tauri`, `tauri-plugin-fs`, `tauri-plugin-shell`, `tauri-plugin-dialog`, `tauri-plugin-updater` — MIT / Apache-2.0
- `serde`, `serde_json`, `anyhow` — MIT / Apache-2.0
- See `src-tauri/Cargo.lock` for the full list.

## Download sources

- ffmpeg/ffprobe: project's GitHub Release assets (this repo); manifest with SHA-256 hashes for each platform; see `src-tauri/resources/setup-manifest.json` (to be added in Phase 1).
- LLM weights: same; verify signatures before loading.

## Licenses of note

- **MIT** for project source
- **GPL-2.0-or-later / LGPL-2.1-or-later** for downloaded FFmpeg binaries
- **Apache-2.0** for downloaded LLM weights
- Sample test assets via Wikimedia Commons (CC BY 3.0, Blender Foundation + NASA public domain for stress clips)

## Building from source

If you build from source, you are responsible for satisfying the GPL terms for the binaries you produce. The `pixel-press` source tree neither contains nor redistributes them.
