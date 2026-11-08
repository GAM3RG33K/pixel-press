/**
 * Model registry — exact WebLLM model IDs (from @mlc-ai/web-llm@0.2.87 prebuiltAppConfig).
 * Each model is validated to have the expected q4f16_1 quantization for low-memory/GPU.
 */
export const MODEL_REGISTRY: Record<string, { webllmId: string; name: string; vramMb: number; license: string }> = {
  'smollm2-360m': {
    webllmId: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2-360M-Instruct',
    vramMb: 376,
    license: 'Apache-2.0',
  },
  'qwen2-0.5b': {
    webllmId: 'Qwen2-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen2-0.5B-Instruct',
    vramMb: 945,
    license: 'Apache-2.0',
  },
};

export type RegisteredModelId = keyof typeof MODEL_REGISTRY;