---
name: pixel-press
description: Local-first video compression desktop app — "The Workbench": quiet, airy, measured.
colors:
  primary: oklch(0.72 0.19 300)
  primary-deep: oklch(0.72 0.19 300) # plate accent; hover lift toward oklch(0.78 0.19 300)
  background: oklch(0.16 0.012 275)
  card: oklch(0.2 0.014 275)
  popover: oklch(0.2 0.014 275)
  secondary: oklch(0.27 0.02 275)
  muted: oklch(0.26 0.018 275)
  accent: oklch(0.3 0.03 300)
  foreground: oklch(0.97 0.004 275)
  muted-foreground: oklch(0.72 0.02 275)
  border: oklch(0.32 0.02 275)
  input: oklch(0.32 0.02 275)
  ring: oklch(0.72 0.19 300)
  success: oklch(0.72 0.16 155)
  warning: oklch(0.8 0.16 85)
  info: oklch(0.72 0.14 235)
  destructive: oklch(0.62 0.22 25)
  primary-foreground: oklch(0.18 0.02 300)
typography:
  display:
    fontFamily: "Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif
    fontSize: "2rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.08em"
  mono:
    fontFamily: "JetBrains Mono", ui-monospace, "SFMono-Regular", "Menlo", monospace
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "16px"
  dropzone:
    backgroundColor: "{colors.card}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.xl}"
    padding: "32px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  chip:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.full}"
    padding: "6px 12px"
---

# pixel-press — DESIGN.md

<!-- impeccable:design-schema 1 -->

## Overview

"The Workbench" — a quiet, airy engineering bench for video compression. Tools laid out, no spectacle: the encode is the show, the UI is just the bench. Dark, near-black surfaces with one violet signature (`#8B5CF6`-family, carried by the Halftone Press mark — a shrinking dot field resolving into a violet plate). Comfortable density, generous targets, restrained motion. Everything local; nothing uploads.

Shipped typeface is currently Inter (see Tokens); the recorded direction is **Schibsted Grotesk** — a newspaper-grade grotesk with genuine press DNA — self-hosted, never via CDN. Adoption is a font swap, not a redesign.

## Colors

Dark-only system, `color-scheme: dark`. All values are OKLCH, defined once in `src/index.css` (`:root` + `@theme inline` for Tailwind v4).

- **Primary (`--primary`, oklch(0.72 0.19 300))** — interactions, focus rings, the recommended path. Used for CTAs (Compress now), active tab, progress fill, and the press plate.
- **Surfaces** — `background` (near-black violet, `oklch(0.16 0.012 275)`), `card`/`popover` (`oklch(0.2 0.014 275)`), `secondary`/`muted`/`accent` for controls and hovers.
- **Foreground/muted** — `foreground` near-white; `muted-foreground` `oklch(0.72 0.02 275)` for captions (meets 4.5:1 on card).
- **Semantic** — `success`, `warning`, `info`, `destructive` used sparingly, always with text, never color-only.
- Selection highlight and primary-tinted gradients derive from `--primary` via `color-mix`; no invented hues.

Do not add second accents. Do not put gradients behind headings.

## Typography

Recorded direction (not yet shipped in the app):

- **Display/Title/Body/Label — Schibsted Grotesk** (`ui-sans-serif` fallback): display 650 weight tight tracking; body 400 at 0.9375rem/1.6; labels 0.75rem semibold, 0.08em tracking, caps for section labels.
- **Mono — JetBrains Mono**: filenames, ffprobe output, CRF/codec tables, diagnostic logs, paths. Never body copy.
- Scale ratio ≈ 1.2; no sizes outside the recorded token set.

While the app still loads Inter, treat it as temporary scaffolding; new screens use Schibsted Grotesk after the font migration. Inter is not a brand decision, it's the starting grid.

## Layout

- **Container**: `max-w-6xl` app frame; header 56px sticky; single-column workbench per tab, two-column detail at `lg:` (workbench + 320px aside).
- **Grid**: 12px base rhythm; 4px spacing scale tokens (xs 4 / sm 8 / md 16 / lg 24 / xl 32).
- **Comfortable density**: 44px minimum interactive targets; generous padding; scroll only the queue/table regions, never the page chrome.
- **Header**: brand left (mark + wordmark), status pill right; tabs as a segmented row below.
- Settings/utility screens follow the same card layout: one card per concern, label above control.

## Elevation & Depth

Flat + tonal layering, not shadows:

- Layering via `card` on `background` (one step of tonal elevation); `border` (`oklch(0.32 0.02 275)`) delineates cards and dividers.
- **No glassmorphism**, no backdrop-filter blur as decoration (header blur is the one incumbent exception, kept only while it earns contrast).
- No gradient text; no neon glows; no inner glows. Progress bars flatten to `primary` at 100%.
- When depth is needed, step the tone (background → card → muted → secondary), never shadow opacity.

## Shapes

- Radius: `sm 8px` (inputs, chips' inner), `md 10px` (buttons, inputs default), `lg 12px` (cards), `xl 16px` (drop zone, hero), `full` (chips/badges).
- Form language: softly rounded rectangles; no sharp 90° corners anywhere; no circular buttons except the diagnostics FAB.
- Borders: 1px `border`; dashed only for the drop zone.
- Icons: lucide, `size-4`/`5`, `aria-hidden`; never multicolor.

## Components

- **button-primary** — solid `primary`, `primary-foreground` text, `md` radius; hover lifts lightness slightly (`color-mix` toward white 6%); disabled at 40% opacity; loading state shows spinner inline.
- **button-outline** — transparent with `border`; hover raises `muted`; used for secondary actions (Copy, Download all).
- **button-ghost** — borderless text/icon button; danger variant for Clear/Remove.
- **card** — `card` surface, 1px `border`, `lg` radius, 16px padding; the universal container.
- **dropzone** — dashed `border`, `xl` radius, centered content; `dragging` state tints `primary/10`; `busy` swaps icon for spinner and shows "Reading file…"; errors render inline with destructive styling.
- **chip** — `secondary` background, `muted-foreground` text, `full` radius; preset labels and capability badges.
- **progressbar** — 8px track (`secondary`), `primary` fill with 300ms width transitions; per-variant and overall variants; percent in mono.
- **input** — `background` fill (not card), `border` stroke, `md` radius; focus ring `ring` at 2px; mono for CRF/paths inputs.
- **StatusPill / Engine badges / local-AI status card** — `info`/`success`/`warning` tints at low alpha backgrounds with solid borders; never text-in-color alone.

## Do's and Don'ts

**Do**

- Keep one accent (`primary`) in every view; let semantic colors wait their turn.
- Mono for anything machine-made: filenames, CRF, ffmpeg output, paths.
- Respect `prefers-reduced-motion` (already in `index.css`) and never animate layout properties.
- Keep `Download` as the primary CTA on results; keep `Compress now` visually identical across Compress/Optimize/Compare flows.
- 4.5:1 contrast minimum; test against `card`, not `background`.
- Self-host every font (`@fontsource-variable/*`); zero CDN fonts.

**Don't**

- No glassmorphism, no backdrop-filter decoration, no gradient text, no glow shadows, no neon.
- No second brand accent; no rainbow charts (Compare table stays mono + one success green for savings).
- Don't bury the workbench CTAs (they sit in the main column next to the file, never in the scroll-away sidebar).
- Don't add loading spinners without an accessible label (`aria-busy`, `role="status"` on progress).
- Don't claim cloud features, accounts, uploads, or "AI-powered compression" in copy — the product is local-only; AI is optional, local, and off by default.
- Don't use other people's icons sets mixed with lucide.
