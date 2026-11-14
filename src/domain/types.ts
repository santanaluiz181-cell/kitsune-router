export type ProviderKind =
  | 'google-ai-studio'
  | 'google-oauth'
  | 'anthropic'
  | 'deepseek'
  | 'openrouter'
  | 'ollama'
  | 'openai-compat'
  | 'nvidia'
  | 'freebuff';

export type AccountTier = 'free' | 'paid' | 'local';

export type SensitivityLevel = 'confidential' | 'public';

export type RoutingPolicy = 'economy' | 'balanced' | 'frontier' | 'manual';

export type MascotMood =
  | 'idle'
  | 'routing'
  | 'celebrating'
  | 'warning'
  | 'blocked'
  | 'exhausted'
  | 'dizzy';

export interface ModelProfile {
  id: string;
  label: string;
  provider: ProviderKind;
  tierClass: 'economy' | 'balanced' | 'frontier' | 'local';
  availableOnFreeTier: boolean;
  contextWindow: number;
  inputCostPer1MUsd: number;
  outputCostPer1MUsd: number;
  upstreamModelId: string;
  notes: string;
}

export interface KeySlotMetadata {
  id: string;
  label: string;
  provider: ProviderKind;
  tier: AccountTier;
  baseUrl: string;
  maskedSecret: string;
  enabled: boolean;
  priority: number;
  allowedModels: string[];
  cooldownUntilMs: number;
  consecutiveFailures: number;
  authInvalid: boolean;
  lastError: string | null;
  createdAtIso: string;
  lastUsedAtIso: string | null;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RouteRequest {
  requestedModel?: string;
  policy: RoutingPolicy;
  sensitivity: SensitivityLevel;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export type RouteFailureCode =
  | 'INVALID_INPUT'
  | 'NO_SLOTS_CONFIGURED'
  | 'PRIVACY_BLOCKED'
  | 'ALL_SLOTS_COOLING_DOWN'
  | 'AUTH_INVALID'
  | 'NO_ELIGIBLE_SLOT';

export interface RouteCandidate {
  slot: KeySlotMetadata;
  model: ModelProfile;
  score: number;
}

export type RoutePlanResult =
  | {
      ok: true;
      candidates: RouteCandidate[];
      blockedByPrivacyCount: number;
      coolingDownCount: number;
    }
  | {
      ok: false;
      code: RouteFailureCode;
      message: string;
      retryAfterMs: number;
      blockedByPrivacyCount: number;
      coolingDownCount: number;
    };

export interface RouterConfig {
  activeModelId: string;
  policy: RoutingPolicy;
  defaultSensitivity: SensitivityLevel;
  httpPort: number;
  mcpEnabled?: boolean;
}

export interface CompletionResponse {
  text: string;
  modelId: string;
  provider: ProviderKind;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  finishReason: string;
}

export interface UsageLedgerEntry {
  id?: number;
  timestampIso: string;
  source: 'mcp' | 'http-v1' | 'playground';
  slotId: string;
  slotLabel: string;
  provider: ProviderKind;
  modelId: string;
  sensitivity: SensitivityLevel;
  status: 'ok' | 'fallback_failed' | 'privacy_blocked' | 'error';
  httpStatus: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  estimatedSavingsUsd: number;
  errorMessage: string | null;
}

export interface UsageSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  privacyBlockedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  totalSavingsUsd: number;
  recentEntries: UsageLedgerEntry[];
}
