# Third-Party Notices

`pixel-press` source code is licensed under the [MIT License](LICENSE). The
Tauri desktop app ships the following third-party components inside or
alongside the installer. They are not part of the MIT-licensed source tree.

## Native FFmpeg + FFprobe (bundled)

- License: **GPL-2.0-or-later** for libx264 and libx265 paths; **LGPL-2.1-or-later** for the FFmpeg base library
- Source: <https://git.ffmpeg.org/gitweb/ffmpeg.git>, your building
- Distributor: [Gyan.dev builds for Windows](https://www.gyan.dev/ffmpeg/builds/), [jellyfin-ffmpeg](https://github.com/jellyfin/jellyfin-ffmpeg), or Homebrew formulae
- Included encoders relevant to this app:
  - `libx264` (H.264 — fallback)
  - `libx265` (H.265 — primary MP4 when source offer is provided)
  - `libvpx`   (VP8 — WebM)

A corresponding source offer ships with releases; see the per-release bundle
notes. Users who redistribute modified builds of the app must comply with the
GPL terms for the bundled FFmpeg.

## Native LLM weights (bundled, install-time)

- License: **Apache-2.0**
- Candidate models (to be finalized by eval):
  - `SmolLM2-360M-Instruct` — <https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct>
  - `Qwen2.5-0.5B-Instruct` — <https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct>

See `docs/harness/model-registry.md`.

## Rust crates (Tauri + plugins)

- `tauri`, `tauri-plugin-fs`, `tauri-plugin-shell`, `tauri-plugin-dialog`, `tauri-plugin-updater` — MIT / Apache-2.0
- `serde`, `serde_json`, `anyhow` — MIT / Apache-2.0
- See `src-tauri/Cargo.lock` for the full set.

## JavaScript deps

See `package.json` and `bun.lock`.

## Licenses of note

- **MIT** for project source
- **GPL-2.0-or-later / LGPL-2.1-or-later** for bundled FFmpeg binaries
- **Apache-2.0** for bundled LLM weights
- Test assets via Wikimedia Commons (CC BY 3.0, Blender Foundation); in-app attribution shown wherever a sample clip is loaded

## Building from source

If you build from source, you are responsible for satisfying the GPL terms for
the FFmpeg binaries you produce. The `pixel-press` source tree neither
contains nor redistributes them.
