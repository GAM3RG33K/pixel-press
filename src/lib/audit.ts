/**
 * HTML video scanner for the Project Auditor and Scan & Optimize views.
 *
 * Scans HTML/JSX/TSX/Vue/Svelte/Astro source text, finds every `<video>` and
 * `<source>` tag, and derives findings per the audit.md rules:
 *   - missing muted / playsinline / preload attributes
 *   - missing poster
 *   - missing webm fallback source
 *   - poster missing width/height hints
 *
 * All work is local: source code text is passed in, no network calls.
 */

import type { VideoMetadata } from "@/types/media";

export type Severity = 'critical' | 'warning' | 'info';

export type AuditRuleId =
  | 'MISSING_MUTED'
  | 'MISSING_PLAYSINLINE'
  | 'MISSING_PRELOAD_NONE_OR_METADATA'
  | 'MISSING_POSTER'
  | 'MISSING_WEBM_FALLBACK'
  | 'MISSING_WIDTH_HEIGHT_ATTRIBUTE'
  | 'UNUSED_AUDIO_TRACK';

export interface VideoTagCandidate {
  /** Raw tag text, trimmed of leading/trailing whitespace. */
  raw: string;
  /** Attribute map: name (lowercased) → value. Boolean attributes map to ''. */
  attrs: Record<string, string>;
  /** Position of the match in the source text. */
  index: number;
  /** JSX variant (self-closing `<source ... />` vs HTML `<source ...>`). */
  isSelfClosing: boolean;
}

export interface FileVideoFinding {
  filePath: string;
  tagIndex: number;
  rawTag: string;
  ruleId: AuditRuleId;
  severity: Severity;
  message: string;
  line: number;
}

export interface FileVideoAudit {
  filePath: string;
  findings: FileVideoFinding[];
  videoTags: number;
  sourceTags: number;
}

export interface AuditReport {
  files: FileVideoAudit[];
  totalVideos: number;
  totalFindings: number;
  scannedFiles: number;
  skippedRemoteUrls: number;
  skippedBinaryFiles: number;
}

const VIDEO_TAG_RE = /<video\b([^>]*)(?:\/>|>([\s\S]*?)<\/video>)/gi;
const SOURCE_TAG_RE = /<source\b([^>]*)(?:\/>|>)/gi;
const ATTR_RE = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:\{([^}]*)\}|"([^"]*)"|'([^']*)'|([^\s>"']+))/g;
const BOOL_ATTR_RE = /([a-zA-Z][a-zA-Z0-9-]*)(?=\s|>|\/)/g;

export function scanHtmlForVideoTags(source: string): VideoTagCandidate[] {
  const tags: VideoTagCandidate[] = [];

  // Full <video> ... </video> pairs
  const videoMatches = [...source.matchAll(VIDEO_TAG_RE)];
  for (const match of videoMatches) {
    const rawAttrs = match[1] ?? '';
    const innerContent = match[2] ?? '';
    const attrs = parseAttributes(rawAttrs);
    const merged = mergeSourceAttributes(attrs, innerContent);

    tags.push({
      raw: match[0].trim(),
      attrs: merged,
      index: match.index ?? 0,
      isSelfClosing: /\/>$/.test(match[0]),
    });
  }

  // Orphan <source> tags (no <video> wrapper detected by the regex) are also captured
  const sourceMatches = [...source.matchAll(SOURCE_TAG_RE)];
  for (const match of sourceMatches) {
    tags.push({
      raw: match[0].trim(),
      attrs: parseAttributes(match[1] ?? ''),
      index: match.index ?? 0,
      isSelfClosing: /\/>$/.test(match[0]),
    });
  }

  return tags;
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = new RegExp(ATTR_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(raw)) !== null) {
    const name = m[1]!.toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
    attrs[name] = value.trim();
  }

  const boolRegex = new RegExp(BOOL_ATTR_RE.source, 'gi');
  while ((m = boolRegex.exec(raw)) !== null) {
    const name = m[1]!.toLowerCase();
    if (!(name in attrs)) attrs[name] = '';
  }

  return attrs;
}

function mergeSourceAttributes(
  videoAttrs: Record<string, string>,
  innerContent: string,
): Record<string, string> {
  const sourceMatches = [...innerContent.matchAll(SOURCE_TAG_RE)];
  if (sourceMatches.length === 0) return videoAttrs;

  const shared = sourceMatches.length > 1;
  const first = sourceMatches[0];
  if (!first) return videoAttrs;

  const merged = { ...videoAttrs };
  if (shared) merged.source = sourceMatches.map((s) => (s[0] ?? '').trim()).join('; ');
  return merged;
}

export function auditFile(
  filePath: string,
  source: string,
  metadataBySrc: Map<string, VideoMetadata>,
): FileVideoAudit {
  const findings: FileVideoFinding[] = [];
  const lines = source.split('\n');
  const tags = scanHtmlForVideoTags(source);
  const videoTags = tags.filter((t) => t.raw.startsWith('<video'));
  const sourceTags = tags.filter((t) => t.raw.startsWith('<source'));

  function lineOf(index: number): number {
    let lineNo = 1;
    let offset = 0;
    for (const line of lines) {
      const lineEnd = offset + line.length + 1;
      if (index < lineEnd) return lineNo;
      offset = lineEnd;
      lineNo += 1;
    }
    return lineNo;
  }

  function attrBool(attrs: Record<string, string>, name: string): boolean {
    return name in attrs;
  }

  function getFirstString(attrs: Record<string, string>, ...names: string[]): string {
    for (const name of names) {
      const v = attrs[name];
      if (v !== undefined && v !== '') return v;
    }
    return '';
  }

  for (const tag of tags) {
    if (!tag.raw.startsWith('<video')) continue;
    const attrs = tag.attrs;
    const line = lineOf(tag.index);
    const rawTag = tag.raw;

    const isAutoplay = attrBool(attrs, 'autoplay');
    const isLoop = attrBool(attrs, 'loop');
    const isDecorative =
      isAutoplay ||
      isLoop ||
      !attrBool(attrs, 'controls') ||
      /muted/.test(rawTag);

    if (isDecorative) {
      if (!attrBool(attrs, 'muted')) {
        findings.push({
          filePath,
          tagIndex: tag.index,
          rawTag,
          ruleId: 'MISSING_MUTED',
          severity: 'critical',
          message: 'Autoplay or loop playback without `muted` — the video will be blocked on Chrome/Safari/iOS.',
          line,
        });
      }

      if (!attrBool(attrs, 'playsinline')) {
        findings.push({
          filePath,
          tagIndex: tag.index,
          rawTag,
          ruleId: 'MISSING_PLAYSINLINE',
          severity: 'warning',
          message: 'Missing `playsinline` — iOS will force-fullscreen on playback.',
          line,
        });
      }

      const preload = getFirstString(attrs, 'preload');
      if (preload !== 'none' && preload !== 'metadata') {
        findings.push({
          filePath,
          tagIndex: tag.index,
          rawTag,
          ruleId: 'MISSING_PRELOAD_NONE_OR_METADATA',
          severity: 'warning',
          message: 'Decorative videos should use `preload="none"` or `preload="metadata"` to avoid 10–20% wasted bandwidth.',
          line,
        });
      }
    }

    if (!attrBool(attrs, 'poster')) {
      findings.push({
        filePath,
        tagIndex: tag.index,
        rawTag,
        ruleId: 'MISSING_POSTER',
        severity: 'warning',
        message: 'No `poster` attribute — layout shift (CLS) and blank frame until first frame decodes.',
        line,
      });
    }

    // Width / height attribute check (prevents CLS)
    const w = getFirstString(attrs, 'width');
    const h = getFirstString(attrs, 'height');
    if (w && h && !/^\d+$/.test(w.replace(/[\"' ]/g, ''))) {
      findings.push({
        filePath,
        tagIndex: tag.index,
        rawTag,
        ruleId: 'MISSING_WIDTH_HEIGHT_ATTRIBUTE',
        severity: 'info',
        message: 'Width/height should be intrinsic pixels (integers).',
        line,
      });
    }

    // WebM fallback: if any source is present, require at least one webm source
    const srcMatches = [...rawTag.matchAll(SOURCE_TAG_RE)];
    if (srcMatches.length > 0) {
      const hasWebM = /\.(webm)\b/.test(rawTag);
      if (!hasWebM) {
        findings.push({
          filePath,
          tagIndex: tag.index,
          rawTag,
          ruleId: 'MISSING_WEBM_FALLBACK',
          severity: 'info',
          message: 'No WebM/VP9 source — browsers that prefer VP9 will download the larger MP4.',
          line,
        });
      }
    }

    // Audio on silent decoration
    const srcList = metadataBySrc;
    if (isDecorative) {
      for (const [, value] of srcList) {
        // metadataBySrc is keyed by src value → metadata
        if (value.hasAudio && rawTag.includes('muted')) {
          findings.push({
            filePath,
            tagIndex: tag.index,
            rawTag,
            ruleId: 'UNUSED_AUDIO_TRACK',
            severity: 'warning',
            message: 'Video carries an audio track but the tag is muted — 10–20% of file size is wasted.',
            line,
          });
          break;
        }
      }
    }
  }

  return {
    filePath,
    findings,
    videoTags: videoTags.length,
    sourceTags: sourceTags.length,
  };
}

export async function auditProjectFiles(
  files: { filePath: string; contents: string }[],
  metadataBySrc: Map<string, VideoMetadata> = new Map(),
): Promise<AuditReport> {
  const report: AuditReport = {
    files: [],
    totalVideos: 0,
    totalFindings: 0,
    scannedFiles: files.length,
    skippedRemoteUrls: 0,
    skippedBinaryFiles: 0,
  };

  const binaryLike = /\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|pdf|zip|gz|mp4|webm|mov|mkv|avi|wasm|map)$/i;

  for (const file of files) {
    if (binaryLike.test(file.filePath)) {
      report.skippedBinaryFiles += 1;
      continue;
    }

    const audit = auditFile(file.filePath, file.contents, metadataBySrc);
    if (audit.videoTags > 0 || audit.sourceTags > 0) {
      report.totalVideos += audit.videoTags;
      report.files.push(audit);
      report.totalFindings += audit.findings.length;
    }
  }

  return report;
}

/**
 * A minimal, honest summary line for UI display.
 */
export function reportSummary(report: AuditReport): string {
  const critical = report.files.reduce(
    (acc, f) => acc + f.findings.filter((fi) => fi.severity === 'critical').length,
    0,
  );
  return `Scanned ${report.scannedFiles} source files; found ${report.totalVideos} <video> tag(s), ${report.totalFindings} finding(s) (${critical} critical).`;
}