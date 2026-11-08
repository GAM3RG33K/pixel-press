/**
 * WebLLM-backed intent planner.
 *
 * Loads the selected local model lazily (on first AI use), requests a
 * JSON-mode structured plan, validates it against our schema, and falls
 * back to the deterministic rule engine on any failure.
 *
 * The heavy model load happens in the main thread (WebGPU is not available in
 * dedicated workers without special setup); generation is async and never
 * blocks the encode path — the rule engine result is returned synchronously
 * as the baseline, the AI plan can upgrade it asynchronously.
 */

import type { CompressionPlan } from '../../skills/compress-video-rules';
import type { VideoMetadata } from '../../types/media';

import { evaluateRules } from '../../skills/compress-video-rules';
import { MODEL_REGISTRY, type RegisteredModelId } from './model-registry';

export type AIPlanStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AIPlanResult {
  plan: CompressionPlan;
  used: 'ai' | 'rule-engine';
  error?: string;
}

/**
 * Resolve a registered model id to its WebLLM model id.
 * Throws if the model is not in the registry.
 */
function getWebllmId(modelId: RegisteredModelId): string {
  const entry = MODEL_REGISTRY[modelId];
  if (!entry) {
    throw new Error(`Unknown registered model: ${modelId}`);
  }
  return entry.webllmId;
}

const PLAN_SCHEMA_DESCRIPTION = `{
  "type": "object",
  "properties": {
    "targetCodec": { "enum": ["h264", "vp9", "h265"] },
    "crf": { "type": "number", "minimum": 0, "maximum": 51 },
    "twoPass": { "type": "boolean" },
    "targetScale": { "type": "object", "properties": { "width": { "type": "number" }, "height": { "type": "number" } } },
    "preserveKeyframes": { "type": "boolean" },
    "audioHandling": { "enum": ["copy", "encode", "strip"] },
    "ruleSource": { "type": "string" }
  },
  "required": ["targetCodec", "crf", "ruleSource"]
}`;

/**
 * Build a prompt describing the task and the JSON schema.
 */
function buildPrompt(metadata: VideoMetadata, intent?: string): string {
  return [
    'You are a local video compression assistant. Output ONLY valid JSON matching this schema:',
    PLAN_SCHEMA_DESCRIPTION,
    `Metadata: ${JSON.stringify({
      fileName: metadata.fileName,
      fileSizeBytes: metadata.fileSize,
      durationSeconds: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      bitrate: metadata.bitrate,
      videoCodec: metadata.videoCodec,
      pixelFormat: metadata.pixelFormat,
      hasAudio: metadata.hasAudio,
    })}`,
    `User intent: ${intent && intent.trim() ? intent.trim() : '(none — pick sensible defaults)'}`,
    'Rules:',
    '- Prefer H.264 for compatibility; VP9 for smallest files; H.265 only when the user asked and the engine supports it.',
    '- Use CRF >= 30 for aggressive compression, <= 23 for high quality.',
    '- Strip audio only for muted/decorative use cases (intent mentions no audio/muted/silent/background).',
    '- Return JSON only, no prose.',
  ].join('\n');
}

function validatePlan(obj: unknown): CompressionPlan | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const plan = obj as Record<string, unknown>;
  if (
    typeof plan.targetCodec !== 'string' ||
    !['h264', 'vp9', 'h265'].includes(plan.targetCodec as string) ||
    typeof plan.crf !== 'number' ||
    plan.crf < 0 ||
    plan.crf > 51 ||
    typeof plan.ruleSource !== 'string'
  ) {
    return null;
  }

  const targetScale =
    plan.targetScale && typeof plan.targetScale === 'object'
      ? {
          width: Number((plan.targetScale as Record<string, unknown>).width) || 0,
          height: Number((plan.targetScale as Record<string, unknown>).height) || 0,
        }
      : undefined;

  const result: CompressionPlan = {
    targetCodec: plan.targetCodec as 'h264' | 'vp9' | 'h265',
    crf: plan.crf as number,
    twoPass: typeof plan.twoPass === 'boolean' ? plan.twoPass : false,
    audioHandling:
      typeof plan.audioHandling === 'string' &&
      ['copy', 'encode', 'strip'].includes(plan.audioHandling as string)
        ? (plan.audioHandling as 'copy' | 'encode' | 'strip')
        : 'copy',
    preserveKeyframes:
      typeof plan.preserveKeyframes === 'boolean' ? plan.preserveKeyframes : true,
    ruleSource: plan.ruleSource as string,
  };

  if (targetScale && targetScale.width > 0 && targetScale.height > 0) {
    result.targetScale = targetScale;
  }

  return result;
}

interface WebLlmLib {
  CreateMLCEngine: (
    modelId: string,
    options: { initProgressCallback?: (report: unknown) => void },
  ) => Promise<unknown>;
  hasModelInCache: (modelId: string) => Promise<boolean>;
}

let enginePromise: Promise<WebLlmLib | null> | null = null;
const engines = new Map<string, unknown>();

/**
 * Try to load the WebLLM library and engine. Returns null when unavailable
 * (e.g., WebGPU unsupported, model not downloaded, package missing).
 */
function getEngine(modelId: RegisteredModelId): Promise<{
  create: (modelId: string, options: { initProgressCallback?: (report: unknown) => void }) => Promise<unknown>;
  hasModelInCache: (modelId: string) => Promise<boolean>;
} | null> {
  if (!enginePromise) {
    enginePromise = import('@mlc-ai/web-llm')
      .then((mod) => mod as unknown as WebLlmLib)
      .catch(() => null);
  }

  const lib = enginePromise;
  if (!lib) return Promise.resolve(null);

  return lib.then(async (m) => {
    if (!m) return null;
    const webllmId = getWebllmId(modelId);
    try {
      const cached = await m.hasModelInCache(webllmId);
      if (!cached) return null; // not downloaded yet — caller may trigger download explicitly
      if (!engines.has(modelId)) {
        const engine = await m.CreateMLCEngine(webllmId, {
          initProgressCallback: (report) => {
            console.info('[webllm] init', JSON.stringify(report));
          },
        });
        engines.set(modelId, engine);
      }
      return {
        create: () => Promise.resolve(engines.get(modelId)) as Promise<unknown>,
        hasModelInCache: (id: string) => m.hasModelInCache(id),
      };
    } catch (error) {
      console.warn('[webllm] engine load failed', error);
      return null;
    }
  });
}

/**
 * Optional: trigger a model download with progress.
 */
export async function downloadModel(
  modelId: RegisteredModelId,
  onProgress?: (report: { progress: number; text: string }) => void,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const lib = (await import('@mlc-ai/web-llm')) as unknown as WebLlmLib;
    const webllmId = getWebllmId(modelId);

    await lib.CreateMLCEngine(webllmId, {
      initProgressCallback: (report) => {
        const r = report as { progress?: number; text?: string };
        onProgress?.({ progress: r.progress ?? 0, text: r.text ?? 'loading' });
      },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Parse intent using the AI model with a rule engine fallback.
 * Always returns a plan; never throws.
 */
export async function planWithAI(
  metadata: VideoMetadata,
  intent: string | undefined,
  aiMode: 'smollm2-360m' | 'qwen2-0.5b' | 'rule-engine',
): Promise<AIPlanResult> {
  const fallbackPlan = evaluateRules(metadata, intent);

  if (aiMode === 'rule-engine') {
    return { plan: fallbackPlan, used: 'rule-engine' };
  }

  const engine = await getEngine(aiMode);
  if (!engine) {
    return {
      plan: fallbackPlan,
      used: 'rule-engine',
      error: 'AI model is not downloaded or WebGPU is unavailable — rule engine used',
    };
  }

  const webllmId = getWebllmId(aiMode);

  try {
    const engineObj = engine as unknown as {
      chat: {
        completions: {
          create: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
        };
      };
    };

    const response = await engineObj.chat.completions.create({
      model: webllmId,
      messages: [
        { role: 'system', content: 'You are a video compression assistant. Output only JSON.' },
        { role: 'user', content: buildPrompt(metadata, intent) },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 512,
      temperature: 0,
    });

    const choices = response.choices as Array<{ message?: { content?: string } }> | undefined;
    const content = choices?.[0]?.message?.content;
    if (!content) {
      return { plan: fallbackPlan, used: 'rule-engine', error: 'AI returned no content' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { plan: fallbackPlan, used: 'rule-engine', error: 'AI returned invalid JSON' };
    }

    const plan = validatePlan(parsed);
    if (!plan) {
      return { plan: fallbackPlan, used: 'rule-engine', error: 'AI output failed schema validation' };
    }

    return {
      plan: { ...plan, ruleSource: `AI: ${plan.ruleSource || 'WebLLM structured plan'}` },
      used: 'ai',
    };
  } catch (error) {
    return {
      plan: fallbackPlan,
      used: 'rule-engine',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
