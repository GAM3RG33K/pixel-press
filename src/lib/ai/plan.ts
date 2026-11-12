/**
 * Unified intent → CompressionPlan resolver used by every encode task
 * (Compress, Compare, Optimize).
 *
 * Preference order:
 *  1. On-device LLM (SmolLM2-360M) via native llama.cpp inference — Tauri only,
 *     when the model is downloaded and AI mode is not `rule-engine`.
 *  2. WebLLM (browser build) when running outside Tauri.
 *  3. Deterministic rule engine — always available, used for `rule-engine` mode
 *     and as the fallback on any AI failure.
 */

import type { CompressionPlan } from '../../skills/compress-video-rules';
import { evaluateRules } from '../../skills/compress-video-rules';
import type { VideoMetadata } from '../../types/media';
import type { AIMode } from '../settings';
import { diag } from '../diagnostics';
import { isTauri, checkLlm, planWithNativeLlm } from '../tauri';
import { planWithAI } from './webllm';
import {
  applyIntentConstraints,
  parseIntentConstraints,
  recipeFromPlan,
  type RecipeSources,
  type EncodeRecipe,
} from '../ffmpeg/recipe';

export interface ResolvedPlan {
  plan: CompressionPlan;
  used: 'ai' | 'rule-engine';
  error?: string;
}

export interface ResolvedRecipeResult {
  recipe: EncodeRecipe;
  sources: RecipeSources;
  used: 'ai' | 'rule-engine';
  plan: CompressionPlan;
  error?: string;
  /** True when the intent asked for something beyond rule-engine coverage and no model handled it — show the download modal. */
  needsModel: boolean;
  /** Human-readable notes the deterministic parser extracted from the intent. */
  intentNotes: string[];
}

/** The only model we ship for on-device inference. */
const NATIVE_MODEL_ID = 'smollm2-360m';

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Maps the native LLM's snake_case plan onto the shared CompressionPlan type. */
export function mapNativePlan(raw: Record<string, unknown>): CompressionPlan | null {
  const codec = String(raw.target_codec ?? '').toLowerCase();
  const codecMap: Record<string, CompressionPlan['targetCodec']> = {
    h264: 'h264',
    h265: 'h265',
    vp9: 'vp9',
    vp8: 'h264',
    av1: 'vp9',
  };
  const targetCodec = codecMap[codec];
  if (!targetCodec) return null;

  const crf = clampInt(raw.crf, 0, 51, -1);
  if (crf < 0) return null;

  const plan: CompressionPlan = {
    targetCodec,
    crf,
    ruleSource:
      typeof raw.rule_source === 'string' && raw.rule_source.trim().length > 0
        ? `AI: ${raw.rule_source.trim()}`
        : 'AI: on-device plan',
  };
  if (raw.two_pass === true) plan.twoPass = true;
  if (raw.preserve_keyframes === true) plan.preserveKeyframes = true;
  const audio = raw.audio_handling;
  if (audio === 'copy' || audio === 'encode' || audio === 'strip') plan.audioHandling = audio;
  return plan;
}

/**
 * Resolve a plan for the given metadata/intent. Always returns a plan
 * (falls back to the rule engine) — callers never need to handle failure.
 */
export async function resolvePlan(
  metadata: VideoMetadata,
  intent: string | undefined,
  aiMode: AIMode,
): Promise<ResolvedPlan> {
  const fallback = evaluateRules(metadata, intent);
  if (aiMode === 'rule-engine') {
    return { plan: fallback, used: 'rule-engine' };
  }

  if (isTauri()) {
    try {
      const status = await checkLlm(NATIVE_MODEL_ID);
      if (!status.ready) {
        return {
          plan: fallback,
          used: 'rule-engine',
          error: 'Model not downloaded — enable on-device AI in Settings → Local AI.',
        };
      }
      const raw = (await planWithNativeLlm(
        {
          id: metadata.id,
          fileName: metadata.fileName,
          fileSize: metadata.fileSize,
          duration: metadata.duration,
          container: metadata.container,
          videoCodec: metadata.videoCodec,
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          bitrate: metadata.bitrate,
          pixelFormat: metadata.pixelFormat,
          hasAudio: metadata.hasAudio,
          ...(metadata.audioCodec ? { audioCodec: metadata.audioCodec } : {}),
        },
        intent,
      )) as Record<string, unknown>;

      const plan = mapNativePlan(raw);
      if (!plan) {
        return { plan: fallback, used: 'rule-engine', error: 'The on-device model returned an unusable plan — used the rule engine.' };
      }
      diag.info('ai-plan', 'native LLM plan accepted', { codec: plan.targetCodec, crf: plan.crf });
      return { plan, used: 'ai' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diag.warn('ai-plan', 'native LLM plan failed, falling back to rule engine', { error: message });
      return { plan: fallback, used: 'rule-engine', error: message };
    }
  }

  // Browser fallback — WebLLM.
  const web = await planWithAI(
    metadata,
    intent,
    aiMode as 'smollm2-360m' | 'qwen2-0.5b' | 'rule-engine',
  );
  return web;
}

/**
 * Resolve a recipe: AI/rules plan → hard deterministic intent constraints.
 * Explicit user tokens in the intent always win; ambiguous prose stays with AI.
 * Sets `needsModel` when the intent clearly requests a customization the
 * rule engine cannot express and no model actually handled it.
 */
export async function resolveRecipe(
  metadata: VideoMetadata,
  intent: string | undefined,
  aiMode: AIMode,
): Promise<ResolvedRecipeResult> {
  const constraints = parseIntentConstraints(intent ?? '', metadata);
  const planResult = await resolvePlan(metadata, intent, aiMode);
  const base = recipeFromPlan(planResult.plan, planResult.used);
  const constrained = applyIntentConstraints(base, intent ?? '', metadata);
  const modelHandled = planResult.used === 'ai';
  const needsModel = constraints.unhandled && !modelHandled;
  return {
    recipe: constrained.recipe,
    sources: constrained.sources,
    used: planResult.used,
    plan: planResult.plan,
    ...(planResult.error !== undefined ? { error: planResult.error } : {}),
    needsModel,
    intentNotes: constrained.intentNotes,
  };
}
