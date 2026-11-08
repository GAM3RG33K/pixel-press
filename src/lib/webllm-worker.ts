/**
 * WebLLM worker with schema-constrained output and fallback to rule engine.
 *
 * Runs in a dedicated Web Worker thread, keeping the main thread free for UI
 * work. Uses WebLLM (small local model) to produce schema-constrained
 * structured output for compression intent parsing. When the model is
 * unavailable or produces invalid output, falls back to the deterministic
 * rule engine.
 *
 * Rule 6: rule engine first, AI only adds intent parsing and explanations.
 * Small-model discipline: model output is schema-constrained and validated;
 * invalid output falls back to the rule engine.
 */

import type { CompressionPlan } from '../skills/compress-video-rules';
import type { VideoMetadata } from '../types/media';
import { diag } from './diagnostics';
import { evaluateRules } from '../skills/compress-video-rules';

/** JSON schema for the structured output contract. */
const COMPRESSION_PLAN_SCHEMA = {
  type: 'object',
  required: ['targetCodec', 'crf', 'ruleSource'],
  properties: {
    targetCodec: { type: 'string', enum: ['h264', 'vp8', 'h265'] },
    crf: { type: 'number', minimum: 0, maximum: 51 },
    twoPass: { type: 'boolean' },
    targetScale: {
      type: 'object',
      required: ['width', 'height'],
      properties: {
        width: { type: 'number' },
        height: { type: 'number' },
      },
    },
    preserveKeyframes: { type: 'boolean' },
    audioHandling: { type: 'string', enum: ['copy', 'encode', 'strip'] },
    ruleSource: { type: 'string' },
  },
} as const;

/** Validate a plan object against the schema, returning null if invalid. */
function validatePlan(obj: unknown): CompressionPlan | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const plan = obj as Record<string, unknown>;
  if (
    typeof plan.targetCodec !== 'string' ||
    !['h264', 'vp8', 'h265'].includes(plan.targetCodec as string) ||
    typeof plan.crf !== 'number' ||
    plan.crf < 0 ||
    plan.crf > 51 ||
    typeof plan.ruleSource !== 'string'
  ) {
    return null;
  }

  let targetScale: CompressionPlan['targetScale'];
  if (plan.targetScale && typeof plan.targetScale === 'object') {
    const scaleObj = plan.targetScale as Record<string, unknown>;
    const width = Number(scaleObj.width);
    const height = Number(scaleObj.height);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      targetScale = { width, height };
    }
  }

  const planOut: CompressionPlan = {
    targetCodec: plan.targetCodec as 'h264' | 'vp8' | 'h265',
    crf: plan.crf as number,
    twoPass: typeof plan.twoPass === 'boolean' ? plan.twoPass : false,
    preserveKeyframes:
      typeof plan.preserveKeyframes === 'boolean' ? plan.preserveKeyframes : true,
    audioHandling:
      typeof plan.audioHandling === 'string' &&
      ['copy', 'encode', 'strip'].includes(plan.audioHandling as string)
        ? (plan.audioHandling as 'copy' | 'encode' | 'strip')
        : 'copy',
    ruleSource: plan.ruleSource as string,
  };

  if (targetScale) {
    planOut.targetScale = targetScale;
  }

  return planOut;
}

/**
 * Parse compression intent into a structured plan using WebLLM with schema
 * constraints, falling back to the deterministic rule engine.
 *
 * @param metadata - Video metadata from ffprobe
 * @param intent - Natural language intent from the user (optional)
 * @returns CompressionPlan
 */
export async function compressIntent(
  metadata: VideoMetadata,
  intent?: string,
): Promise<CompressionPlan> {
  diag.debug('compressIntent', 'compressIntent called', {
    hasIntent: Boolean(intent && intent.trim()),
    width: metadata.width,
    height: metadata.height,
    duration: metadata.duration,
  });
  // Try WebLLM if available
  const webllm = (self as unknown as { WebLLM?: unknown }).WebLLM;
  if (webllm) {
    try {
      const result = await (webllm as {
        generate: (options: {
          system: string;
          user: string;
          schema: typeof COMPRESSION_PLAN_SCHEMA;
        }) => Promise<unknown>;
      }).generate({
        system: 'You are a video compression expert. Output only valid JSON matching the provided schema.',
        user: `Metadata: ${JSON.stringify(metadata)}\nIntent: ${intent || 'default'}\nSchema: ${JSON.stringify(COMPRESSION_PLAN_SCHEMA)}`,
        schema: COMPRESSION_PLAN_SCHEMA,
      });

      const plan = validatePlan(result);
      if (plan) {
        return { ...plan, ruleSource: 'WebLLM (schema-constrained)' };
      }
    } catch (error) {
      console.warn('WebLLM failed, falling back to rule engine:', error);
    }
  }

  // Fallback to deterministic rule engine
  const plan = evaluateRules(metadata, intent);
  return { ...plan, ruleSource: plan.ruleSource ?? 'rule engine fallback' };
}

/** Message types for the worker. */
export interface WebLLMWorkerMessage {
  type: 'COMPRESS_INTENT';
  payload: { metadata: VideoMetadata; intent?: string };
}

export interface WebLLMWorkerResponse {
  type: 'COMPRESS_INTENT_RESULT';
  payload: CompressionPlan;
}

export function handleWorkerMessage(
  message: WebLLMWorkerMessage,
): Promise<WebLLMWorkerResponse> {
  if (message.type !== 'COMPRESS_INTENT') {
    throw new Error(`Unknown worker message type: ${message.type}`);
  }

  return compressIntent(message.payload.metadata, message.payload.intent).then(
    (plan) => ({
      type: 'COMPRESS_INTENT_RESULT',
      payload: plan,
    }),
  );
}

// When executed as a Worker, handle the `message` event.
if (typeof self !== 'undefined') {
  self.onmessage = async (event: MessageEvent<WebLLMWorkerMessage>) => {
    try {
      const response = await handleWorkerMessage(event.data);
      self.postMessage(response);
    } catch (error) {
      self.postMessage({
        type: 'ERROR',
        payload: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  };
}