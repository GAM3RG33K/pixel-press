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
    expect(set.variants[1]?.codec).toBe('vp8');
  });

  it('estimateSizeBytes is lower for higher CRF (less quality)', () => {
    const a = estimateSizeBytes(100 * 1024 * 1024, 20, 'h264');
    const b = estimateSizeBytes(100 * 1024 * 1024, 32, 'h264');
    expect(b).toBeLessThan(a);
  });

  it('estimateSizeBytes is smaller for VP8 than H.264 at comparable CRF', () => {
    const h264 = estimateSizeBytes(100 * 1024 * 1024, 26, 'h264');
    const vp8 = estimateSizeBytes(100 * 1024 * 1024, 26, 'vp8');
    expect(vp8).toBeLessThan(h264);
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
