/**
 * HTML/JSX snippet generation from the app's output bundle.
 *
 * Produces production-ready snippets for the "Copy <video> HTML / JSX" cards:
 * - `<video>` markup with sources in the right order (WebM first, MP4 fallback)
 * - poster reference
 * - required playsinline/muted/preload attributes for autoplay loops
 */

export interface SnippetVariant {
  fileName: string;
  path: string;
  container: string;
  width?: number | undefined;
  height?: number | undefined;
  sizeBytes: number;
}

export interface SnippetOptions {
  posterFileName?: string | undefined;
  posterPath?: string | undefined;
  autoplay?: boolean | undefined;
  loop?: boolean | undefined;
  controls?: boolean | undefined;
  preload?: "none" | "metadata" | "auto" | undefined;
  withJsx?: boolean | undefined;
}

function escapeJsxValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildVideoSnippet(
  variants: SnippetVariant[],
  options: SnippetOptions = {},
): string {
  const ordered = [...variants].sort((a, b) => {
    const score = (v: SnippetVariant) => (v.container === "webm" ? 0 : 1);
    return score(a) - score(b) || b.sizeBytes - a.sizeBytes;
  });

  const lines: string[] = [];
  const preload = options.preload ?? "metadata";
  const playLine = options.autoplay ? " autoplay" : "";
  const loopLine = options.autoplay && options.loop !== false ? " loop" : "";
  const controlsLine = options.controls ?? !options.autoplay ? " controls" : "";
  const mutedLine = options.autoplay ? " muted" : "";
  const posterLine =
    options.posterPath ?? options.posterFileName
      ? ` poster="${options.posterPath ?? options.posterFileName}"`
      : "";

  if (options.withJsx) {
    lines.push(
      `<video${playLine ? " autoplay" : ""}${mutedLine}${loopLine}${controlsLine} preload="${preload}"${posterLine} playsInline>`,
    );
    for (const variant of ordered) {
      lines.push(
        `  <source src={${escapeJsxValue(variant.path)}} type="video/${variant.container}" />`,
      );
    }
    lines.push("</video>");
    return lines.join("\n");
  }

  lines.push(
    `<video${playLine ? " autoplay" : ""}${mutedLine}${loopLine}${controlsLine} playsinline preload="${preload}"${posterLine}>`,
  );
  for (const variant of ordered) {
    lines.push(`  <source src="${variant.path}" type="video/${variant.container}">`);
  }
  lines.push("</video>");
  return lines.join("\n");
}

export function buildPosterPath(baseName: string): string {
  return `./${baseName}-poster.webp`;
}
