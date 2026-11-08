import { describe, expect, it } from 'vitest';

import { buildPosterPath, buildVideoSnippet } from './snippet';

const variants = [
  { fileName: 'a.webm', path: './a.webm', container: 'webm' as const, sizeBytes: 1000 },
  { fileName: 'a.mp4', path: './a.mp4', container: 'mp4' as const, sizeBytes: 2500 },
];

describe('snippets', () => {
  it('buildVideoSnippet orders webm before mp4', () => {
    const out = buildVideoSnippet(variants, { autoplay: true, loop: true });
    const webmIdx = out.indexOf('a.webm');
    const mp4Idx = out.indexOf('a.mp4');
    expect(webmIdx).toBeLessThan(mp4Idx);
  });

  it('buildVideoSnippet emits JSX when withJsx', () => {
    const out = buildVideoSnippet(variants, { autoplay: true, withJsx: true, posterPath: './poster.webp' });
    expect(out).toContain('playsInline');
    expect(out).toContain('poster=');
    expect(out).toContain('<source src={');
  });

  it('buildVideoSnippet emits HTML by default', () => {
    const out = buildVideoSnippet(variants, { autoplay: true, loop: true, preload: 'none', posterPath: './poster.webp' });
    expect(out).toContain('<video');
    expect(out).toContain('muted');
    expect(out).toContain('preload="none"');
    expect(out).toContain('<source src="./a.webm"');
  });

  it('buildPosterPath uses webp', () => {
    expect(buildPosterPath('my-clip')).toBe('./my-clip-poster.webp');
  });
});
