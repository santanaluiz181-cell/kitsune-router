import type { ModelProfile, ProviderKind } from './types.ts';

export const MODEL_CATALOG: ReadonlyArray<ModelProfile> = [
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    provider: 'google-ai-studio',
    tierClass: 'economy',
    availableOnFreeTier: true,
    contextWindow: 1_000_000,
    inputCostPer1MUsd: 0.3,
    outputCostPer1MUsd: 2.5,
    upstreamModelId: 'gemini-3.5-flash-lite',
    notes: 'Ultra low-cost throughput model for bulk tasks and sub-routines.'
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    provider: 'google-ai-studio',
    tierClass: 'economy',
    availableOnFreeTier: true,
    contextWindow: 1_000_000,
    inputCostPer1MUsd: 0.35,
    outputCostPer1MUsd: 2.5,
    upstreamModelId: 'gemini-3.5-flash',
    notes: 'Versatile fast model available on Google AI Studio and Google accounts.'
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    provider: 'google-ai-studio',
    tierClass: 'balanced',
    availableOnFreeTier: true,
    contextWindow: 1_000_000,
    inputCostPer1MUsd: 0.75,
    outputCostPer1MUsd: 3.75,
    upstreamModelId: 'gemini-3.8-flash',
    notes: 'Fast engineering model with 1M context and strong code accuracy.'
  },
  {
    id: 'gemini-3.8-pro',
    label: 'Gemini 3.8 Pro (Conta Google / AI Studio)',
    provider: 'google-ai-studio',
    tierClass: 'frontier',
    availableOnFreeTier: true,
    contextWindow: 2_000_000,
    inputCostPer1MUsd: 1.5,
    outputCostPer1MUsd: 10.0,
    upstreamModelId: 'gemini-3.8-pro',
    notes: 'High-reasoning Gemini Pro accessible via Google OAuth or AI Studio keys.'
  },
  {
    id: 'gemini-deep-research',
    label: 'Gemini Deep Research (Google Account)',
    provider: 'google-oauth',
    tierClass: 'frontier',
    availableOnFreeTier: false,
    contextWindow: 2_000_000,
    inputCostPer1MUsd: 2.5,
    outputCostPer1MUsd: 12.0,
    upstreamModelId: 'deep-research-pro-preview',
    notes: 'Deep multi-step synthesis unlocked with linked Google account or Web bridge.'
  },
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen',
    provider: 'google-ai-studio',
    tierClass: 'frontier',
    availableOnFreeTier: true,
    contextWindow: 1_000_000,
    inputCostPer1MUsd: 1.5,
    outputCostPer1MUsd: 7.5,
    upstreamModelId: 'gemini-4-hydrogen',
    notes: 'High-efficiency frontier coding and reasoning workhorse.'
  },
  {
    id: 'gemini-4-argon',
    label: 'Gemini 4 Argon',
    provider: 'google-ai-studio',
    tierClass: 'frontier',
    availableOnFreeTier: false,
    contextWindow: 1_000_000,
    inputCostPer1MUsd: 2.0,
    outputCostPer1MUsd: 12.0,
    upstreamModelId: 'gemini-4-argon',
    notes: 'Paid Tier heavyweight reasoning model (excluded on Free Tier keys).'
  },
  {
    id: 'deepseek/deepseek-chat',
    label: 'DeepSeek V3 Chat (Plano/API)',
    provider: 'deepseek',
    tierClass: 'balanced',
    availableOnFreeTier: false,
    contextWindow: 128_000,
    inputCostPer1MUsd: 0.27,
    outputCostPer1MUsd: 1.1,
    upstreamModelId: 'deepseek-chat',
    notes: 'DeepSeek direct account/API with coding strength and low cost.'
  },
  {
    id: 'deepseek/deepseek-reasoner',
    label: 'DeepSeek Reasoner (R1)',
    provider: 'deepseek',
    tierClass: 'frontier',
    availableOnFreeTier: false,
    contextWindow: 128_000,
    inputCostPer1MUsd: 0.55,
    outputCostPer1MUsd: 2.19,
    upstreamModelId: 'deepseek-reasoner',
    notes: 'DeepSeek deep reasoning model via official token/key.'
  },
  {
    id: 'anthropic/claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5 (Anthropic)',
    provider: 'anthropic',
    tierClass: 'balanced',
    availableOnFreeTier: false,
    contextWindow: 200_000,
    inputCostPer1MUsd: 3.0,
    outputCostPer1MUsd: 15.0,
    upstreamModelId: 'claude-sonnet-4-5',
    notes: 'Claude engineering flagship via Anthropic key or OAuth session token.'
  },
  {
    id: 'anthropic/claude-opus-4',
    label: 'Claude Opus 4 (Anthropic)',
    provider: 'anthropic',
    tierClass: 'frontier',
    availableOnFreeTier: false,
    contextWindow: 200_000,
    inputCostPer1MUsd: 15.0,
    outputCostPer1MUsd: 75.0,
    upstreamModelId: 'claude-opus-4',
    notes: 'Maximum frontier Claude reasoning for complex architecture.'
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash (Legacy Fallback)',
    provider: 'google-ai-studio',
    tierClass: 'economy',
    availableOnFreeTier: true,
    contextWindow: 1_000_000,
    inputCostPer1MUsd: 0.3,
    outputCostPer1MUsd: 2.5,
    upstreamModelId: 'gemini-2.5-flash',
    notes: 'Widely supported fallback model on older AI Studio keys.'
  },
  {
    id: 'openrouter/google/gemini-2.5-flash-lite',
    label: 'OpenRouter: Gemini Flash-Lite',
    provider: 'openrouter',
    tierClass: 'economy',
    availableOnFreeTier: false,
    contextWindow: 1_000_000,
    inputCostPer1MUsd: 0.3,
    outputCostPer1MUsd: 2.5,
    upstreamModelId: 'google/gemini-2.5-flash-lite',
    notes: 'Multi-provider fallback via OpenRouter without Google Free Tier training.'
  },
  {
    id: 'openrouter/deepseek/deepseek-r1:free',
    label: 'OpenRouter: DeepSeek R1 (Free)',
    provider: 'openrouter',
    tierClass: 'balanced',
    availableOnFreeTier: true,
    contextWindow: 64_000,
    inputCostPer1MUsd: 0,
    outputCostPer1MUsd: 0,
    upstreamModelId: 'deepseek/deepseek-r1:free',
    notes: 'Zero-cost reasoning fallback hosted on OpenRouter.'
  },
  {
    id: 'openrouter/qwen/qwen-2.5-coder-32b-instruct',
    label: 'OpenRouter: Qwen 2.5 Coder 32B',
    provider: 'openrouter',
    tierClass: 'balanced',
    availableOnFreeTier: false,
    contextWindow: 128_000,
    inputCostPer1MUsd: 0.18,
    outputCostPer1MUsd: 0.18,
    upstreamModelId: 'qwen/qwen-2.5-coder-32b-instruct',
    notes: 'Specialized open-weight code model at ultra-low cost.'
  },
  {
    id: 'ollama/qwen2.5-coder:14b',
    label: 'Ollama Local: Qwen 2.5 Coder',
    provider: 'ollama',
    tierClass: 'local',
    availableOnFreeTier: true,
    contextWindow: 32_768,
    inputCostPer1MUsd: 0,
    outputCostPer1MUsd: 0,
    upstreamModelId: 'qwen2.5-coder:14b',
    notes: '100% offline local inference with zero cost and maximum privacy.'
  }
];

export const DEFAULT_BASE_URLS: Readonly<Record<ProviderKind, string>> = {
  'google-ai-studio': 'https://generativelanguage.googleapis.com',
  'google-oauth': 'https://generativelanguage.googleapis.com',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com',
  openrouter: 'https://openrouter.ai/api',
  ollama: 'http://127.0.0.1:11434',
  'openai-compat': 'http://127.0.0.1:1234'
};

export function findModelProfile(modelId: string): ModelProfile | undefined {
  const normalized = modelId.trim();
  return MODEL_CATALOG.find(
    (m) => m.id === normalized || m.upstreamModelId === normalized
  );
}

export function resolveModelForCustomProvider(
  modelId: string,
  provider: ProviderKind
): ModelProfile {
  const known = findModelProfile(modelId);
  if (known && (known.provider === provider || (provider === 'google-oauth' && known.provider === 'google-ai-studio'))) {
    return known;
  }
  const cleanId = modelId.trim() || 'custom-model';
  return {
    id: cleanId,
    label: cleanId,
    provider,
    tierClass: provider === 'ollama' ? 'local' : 'balanced',
    availableOnFreeTier: provider === 'ollama',
    contextWindow: 128_000,
    inputCostPer1MUsd: 0,
    outputCostPer1MUsd: 0,
    upstreamModelId: cleanId.replace(/^(openrouter|ollama|deepseek|anthropic)\//, ''),
    notes: 'Custom provider model ID.'
  };
}
