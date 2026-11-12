import { describe, expect, it } from 'vitest';

import {
  PRESETS,
  buildVariantPlan,
  buildWorkbenchVariants,
  estimateSizeBytes,
  isAudioKept,
} from './workflow';
import type { VideoMetadata } from '@/types/media';

const meta = (
  overrides: Partial<VideoMetadata> = {},
): VideoMetadata => ({
  id: 'video-test-1',
  fileName: 'test.mp4',
  fileSize: 10 * 1024 * 1024,
  duration: 5,
  container: 'mp4',
  videoCodec: 'h264',
  width: 1280,
  height: 720,
  fps: 30,
  bitrate: 4_000_000,
  pixelFormat: 'yuv420p',
  hasAudio: true,
  ...overrides,
});

describe('workflow planner', () => {
  it('buildVariantPlan defaults target codec h264, crf 26 with no metadata', () => {
    const plan = buildVariantPlan('small file', null);
    expect(plan.targetCodec).toBe('h264');
    expect(plan.crf).toBe(26);
  });

  it('buildVariantPlan returns rule-sources when metadata supplied', () => {
    const plan = buildVariantPlan('compress this video', meta({}));
    expect(plan.ruleSource).toBeDefined();
  });

  it('buildWorkbenchVariants emits an mp4 + webm variant', () => {
    const plan = buildVariantPlan('', meta({}));
    const set = buildWorkbenchVariants(plan, meta({}).fileSize, meta({}), 'out');
    expect(set.variants.length).toBe(2);
    expect(set.variants[0]?.container).toBe('mp4');
    expect(set.variants[1]?.container).toBe('webm');
    expect(set.variants[1]?.codec).toBe('vp9');
  });

  it('buildWorkbenchVariants emits only the mp4 variant for an h264/mp4 intent', () => {
    const plan = buildVariantPlan('make this universally compatible, h264 mp4', meta({}));
    const set = buildWorkbenchVariants(plan, meta({}).fileSize, meta({}), 'out', 'make this universally compatible, h264 mp4');
    expect(set.variants.length).toBe(1);
    expect(set.variants[0]?.container).toBe('mp4');
  });

  it('buildWorkbenchVariants emits only the webm variant for a vp9/webm intent', () => {
    const plan = { ...buildVariantPlan('', meta({})), targetCodec: 'vp9' as const };
    const set = buildWorkbenchVariants(plan, meta({}).fileSize, meta({}), 'out', 'make the file as small as possible, vp9 webm');
    expect(set.variants.length).toBe(1);
    expect(set.variants[0]?.container).toBe('webm');
  });

  it('estimateSizeBytes is lower for higher CRF (less quality)', () => {
    const a = estimateSizeBytes(100 * 1024 * 1024, 20, 'h264');
    const b = estimateSizeBytes(100 * 1024 * 1024, 32, 'h264');
    expect(b).toBeLessThan(a);
  });

  it('estimateSizeBytes is smaller for VP9 than H.264 at comparable CRF', () => {
    const h264 = estimateSizeBytes(100 * 1024 * 1024, 26, 'h264');
    const vp9 = estimateSizeBytes(100 * 1024 * 1024, 26, 'vp9');
    expect(vp9).toBeLessThan(h264);
  });

  it('isAudioKept returns true for copy/encode/undefined, false for strip', () => {
    expect(isAudioKept({ targetCodec: 'h264', crf: 26, audioHandling: 'copy' } as never)).toBe(true);
    expect(isAudioKept({ targetCodec: 'h264', crf: 26, audioHandling: 'encode' } as never)).toBe(true);
    expect(isAudioKept({ targetCodec: 'h264', crf: 26, audioHandling: 'strip' } as never)).toBe(false);
  });

  it('PRESETS all have ids, labels, intents', () => {
    for (const preset of PRESETS) {
      expect(preset.id.length).toBeGreaterThan(0);
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.intent.length).toBeGreaterThan(0);
    }
  });
});

describe('buildWorkbenchVariants — explicit advanced hands pin the output', () => {
  it('hand-picked vp9 → single WebM variant at exactly the chosen CRF', () => {
    const plan = { targetCodec: 'h264' as const, crf: 26, ruleSource: 'R7' };
    const recipe = { ...plan, outputContainer: 'auto' as const, audioHandling: 'copy' as const, subtitleHandling: { mode: 'copy' as const }, stripMetadata: false, faststart: true, targetCodec: 'vp9' as const, crf: 34 };
    const set = buildWorkbenchVariants(plan, meta({}).fileSize, meta({}), 'out', '', recipe);
    expect(set.variants).toHaveLength(1);
    expect(set.variants[0]?.container).toBe('webm');
    expect(set.variants[0]?.codec).toBe('vp9');
    expect(set.variants[0]?.crf).toBe(34);
  });

  it('hand-picked h265 → single MP4 variant with h265', () => {
    const plan = { targetCodec: 'h264' as const, crf: 26, ruleSource: 'R7' };
    const recipe = { ...plan, outputContainer: 'auto' as const, audioHandling: 'copy' as const, subtitleHandling: { mode: 'copy' as const }, stripMetadata: false, faststart: true, targetCodec: 'h265' as const };
    const set = buildWorkbenchVariants(plan, meta({}).fileSize, meta({}), 'out', '', recipe);
    expect(set.variants).toHaveLength(1);
    expect(set.variants[0]?.container).toBe('mp4');
    expect(set.variants[0]?.codec).toBe('h265');
    expect(set.variants[0]?.crf).toBe(26);
  });

  it('hand-set CRF with h264 → single MP4 at exactly that CRF', () => {
    const plan = { targetCodec: 'h264' as const, crf: 26, ruleSource: 'R7' };
    const recipe = { ...plan, outputContainer: 'auto' as const, audioHandling: 'copy' as const, subtitleHandling: { mode: 'copy' as const }, stripMetadata: false, faststart: true, crf: 22 };
    const set = buildWorkbenchVariants(plan, meta({}).fileSize, meta({}), 'out', '', recipe);
    expect(set.variants).toHaveLength(1);
    expect(set.variants[0]?.container).toBe('mp4');
    expect(set.variants[0]?.crf).toBe(22);
  });

  it('AI vp9 plan (no hand edits) → single WebM at plan CRF', () => {
    const plan = { targetCodec: 'vp9' as const, crf: 42, ruleSource: 'AI: smallest file' };
    const recipe = { ...plan, outputContainer: 'auto' as const, audioHandling: 'strip' as const, subtitleHandling: { mode: 'copy' as const }, stripMetadata: false, faststart: true };
    const set = buildWorkbenchVariants(plan, meta({}).fileSize, meta({}), 'out', 'smallest file, vp9 webm', recipe);
    expect(set.variants).toHaveLength(1);
    expect(set.variants[0]?.container).toBe('webm');
    expect(set.variants[0]?.crf).toBe(42);
  });

  it('untouched h264 + generic intent keeps the dual default', () => {
    const plan = buildVariantPlan('', meta({}));
    const recipe = { ...plan, outputContainer: 'auto' as const, audioHandling: 'copy' as const, subtitleHandling: { mode: 'copy' as const }, stripMetadata: false, faststart: true };
    const set = buildWorkbenchVariants(plan, meta({}).fileSize, meta({}), 'out', 'hero background video', recipe);
    expect(set.variants).toHaveLength(2);
  });
});
