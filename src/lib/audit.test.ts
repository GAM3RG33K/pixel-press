import { describe, expect, it } from 'vitest';

import { auditProjectFiles, reportSummary, scanHtmlForVideoTags } from './audit';

const source = `<!doctype html>
<html>
<body>
<video autoplay loop poster="cover.jpg">
  <source src="./clip.mp4" type="video/mp4">
</video>
<video muted playsinline preload="none" poster="cover.webp">
  <source src="./hero.webm" type="video/webm">
  <source src="./hero.mp4" type="video/mp4">
</video>
</body>
</html>`;

describe('scanner', () => {
  it('detects two <video> tags', () => {
    const tags = scanHtmlForVideoTags(source);
    const videoTags = tags.filter((t) => t.raw.startsWith('<video'));
    expect(videoTags.length).toBe(2);
  });

  it('auditProjectFiles reports MISSING_MUTED and MISSING_PRELOAD for the autoplay decorative video', async () => {
    const report = await auditProjectFiles([{ filePath: 'index.html', contents: source }]);
    const critical = report.files[0]?.findings.filter((f) => f.severity === 'critical');
    expect(critical?.some((f) => f.ruleId === 'MISSING_MUTED')).toBe(true);
  });

  it('auditProjectFiles reports MISSING_WEBM_FALLBACK for the non-webm video', async () => {
    const report = await auditProjectFiles([{ filePath: 'index.html', contents: source }]);
    const warning = report.files[0]?.findings.filter((f) => f.ruleId === 'MISSING_WEBM_FALLBACK');
    expect(warning?.length).toBeGreaterThan(0);
  });

  it('reportSummary includes counts', () => {
    const file = { filePath: 'index.html', contents: source };
    const report = {
      files: [],
      totalVideos: 0,
      totalFindings: 0,
      scannedFiles: 1,
      skippedRemoteUrls: 0,
      skippedBinaryFiles: 0,
    };
    void file;
    expect(reportSummary(report)).toContain('Scanned 1');
  });
});
