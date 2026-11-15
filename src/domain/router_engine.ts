import { MODEL_CATALOG, findModelProfile, resolveModelForCustomProvider } from './model_catalog.ts';
import type {
  KeySlotMetadata,
  ModelProfile,
  RouteCandidate,
  RoutePlanResult,
  RouteRequest,
  RoutingPolicy,
  SensitivityLevel
} from './types.ts';

const FRONTIER_BASELINE_INPUT_USD_PER_1M = 1.5;
const FRONTIER_BASELINE_OUTPUT_USD_PER_1M = 7.5;
const MAX_BACKOFF_MS = 300_000;
const BASE_BACKOFF_MS = 15_000;
const MAX_RETRY_AFTER_MS = 600_000;

export function estimateCostUsd(
  model: Pick<ModelProfile, 'inputCostPer1MUsd' | 'outputCostPer1MUsd'>,
  inputTokens: number,
  outputTokens: number
): { costUsd: number; savingsUsd: number } {
  const safeIn = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;
  const safeOut = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;

  const costUsd =
    (safeIn / 1_000_000) * Math.max(0, model.inputCostPer1MUsd) +
    (safeOut / 1_000_000) * Math.max(0, model.outputCostPer1MUsd);

  const baselineUsd =
    (safeIn / 1_000_000) * FRONTIER_BASELINE_INPUT_USD_PER_1M +
    (safeOut / 1_000_000) * FRONTIER_BASELINE_OUTPUT_USD_PER_1M;

  return {
    costUsd: roundUsd(costUsd),
    savingsUsd: roundUsd(Math.max(0, baselineUsd - costUsd))
  };
}

export function isSlotBlockedByPrivacy(
  slot: Pick<KeySlotMetadata, 'provider' | 'tier'>,
  sensitivity: SensitivityLevel
): boolean {
  return sensitivity === 'confidential' && slot.provider === 'google-ai-studio' && slot.tier === 'free';
}

export function evaluateFailure(
  slot: KeySlotMetadata,
  httpStatus: number,
  retryAfterHeaderMs: number | null,
  errorMessage: string,
  nowMs: number = Date.now()
): KeySlotMetadata {
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      ...slot,
      authInvalid: true,
      consecutiveFailures: slot.consecutiveFailures + 1,
      lastError: errorMessage || `HTTP ${httpStatus} authentication rejected`
    };
  }

  const nextFailures = slot.consecutiveFailures + 1;
  const expBackoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.min(nextFailures - 1, 5)));
  const headerCooldown =
    retryAfterHeaderMs !== null && Number.isFinite(retryAfterHeaderMs) && retryAfterHeaderMs > 0
      ? Math.min(MAX_RETRY_AFTER_MS, retryAfterHeaderMs)
      : 0;
  const cooldownDuration = httpStatus === 429 || httpStatus === 503 ? Math.max(expBackoff, headerCooldown) : 5_000;

  return {
    ...slot,
    consecutiveFailures: nextFailures,
    cooldownUntilMs: safeNow + cooldownDuration,
    lastError: errorMessage || `HTTP ${httpStatus}`
  };
}

export function markSlotHealthy(slot: KeySlotMetadata, nowIso: string): KeySlotMetadata {
  return {
    ...slot,
    authInvalid: false,
    consecutiveFailures: 0,
    cooldownUntilMs: 0,
    lastError: null,
    lastUsedAtIso: nowIso
  };
}

export function selectRoute(
  request: RouteRequest,
  slots: ReadonlyArray<KeySlotMetadata>,
  nowMs: number = Date.now()
): RoutePlanResult {
  if (!hasValidPrompt(request)) {
    return routeFailure('INVALID_INPUT', 'Request must contain at least one non-empty message.');
  }

  const enabledSlots = slots.filter((s) => s.enabled);
  if (enabledSlots.length === 0) {
    return routeFailure(
      'NO_SLOTS_CONFIGURED',
      'No enabled provider key slots configured. Add a Google AI Studio, OpenRouter, or Ollama slot.'
    );
  }

  const scan = collectEligibleCandidates(request, enabledSlots, nowMs);
  if (scan.candidates.length > 0) {
    scan.candidates.sort((a, b) => b.score - a.score);
    return {
      ok: true,
      candidates: scan.candidates,
      blockedByPrivacyCount: scan.blockedByPrivacyCount,
      coolingDownCount: scan.coolingDownCount
    };
  }

  return diagnoseEmptyCandidates({
    enabledCount: enabledSlots.length,
    blockedByPrivacyCount: scan.blockedByPrivacyCount,
    coolingDownCount: scan.coolingDownCount,
    authInvalidCount: scan.authInvalidCount,
    minRetryAfterMs: scan.minRetryAfterMs
  });
}

function routeFailure(code: 'INVALID_INPUT' | 'NO_SLOTS_CONFIGURED', message: string): RoutePlanResult {
  return { ok: false, code, message, retryAfterMs: 0, blockedByPrivacyCount: 0, coolingDownCount: 0 };
}

function collectEligibleCandidates(
  request: RouteRequest,
  enabledSlots: ReadonlyArray<KeySlotMetadata>,
  nowMs: number
) {
  let blockedByPrivacyCount = 0;
  let coolingDownCount = 0;
  let authInvalidCount = 0;
  let minRetryAfterMs = Number.POSITIVE_INFINITY;
  const candidates: RouteCandidate[] = [];

  for (const slot of enabledSlots) {
    if (slot.authInvalid) { authInvalidCount++; continue; }
    if (isSlotBlockedByPrivacy(slot, request.sensitivity)) { blockedByPrivacyCount++; continue; }
    if (slot.cooldownUntilMs > nowMs) {
      coolingDownCount++;
      minRetryAfterMs = Math.min(minRetryAfterMs, slot.cooldownUntilMs - nowMs);
      continue;
    }
    candidates.push(...buildCandidatesForSlot(slot, request.policy, request.requestedModel));
  }
  return { blockedByPrivacyCount, coolingDownCount, authInvalidCount, minRetryAfterMs, candidates };
}

function hasValidPrompt(request: RouteRequest): boolean {
  if (!request || !Array.isArray(request.messages) || request.messages.length === 0) {
    return false;
  }
  return request.messages.some((m) => typeof m.content === 'string' && m.content.trim().length > 0);
}

function buildCandidatesForSlot(
  slot: KeySlotMetadata,
  policy: RoutingPolicy,
  requestedModel?: string
): RouteCandidate[] {
  const cleanRequested = requestedModel?.trim() || '';
  const requestedProfile = cleanRequested ? findModelProfile(cleanRequested) : undefined;

  if (policy === 'manual') {
    const targetId = cleanRequested || slot.allowedModels[0] || '';
    if (!targetId) return [];
    const profile = requestedProfile ?? resolveModelForCustomProvider(targetId, slot.provider);
    if (!slotSupportsModel(slot, profile)) return [];
    return [{ slot, model: profile, score: 1000 + slot.priority }];
  }

  const catalogModels = MODEL_CATALOG.filter((m) => slotSupportsModel(slot, m));
  const customModels = slot.allowedModels
    .filter((id) => !MODEL_CATALOG.some((m) => m.id === id))
    .map((id) => resolveModelForCustomProvider(id, slot.provider));

  const eligible = [...catalogModels, ...customModels];
  if (requestedProfile && slotSupportsModel(slot, requestedProfile) && !eligible.some((m) => m.id === requestedProfile.id)) {
    eligible.push(requestedProfile);
  }

  return eligible.map((model) => ({
    slot,
    model,
    score: scoreCandidate(slot, model, policy, cleanRequested)
  }));
}

export function listActiveModels(slots: ReadonlyArray<KeySlotMetadata>): ModelProfile[] {
  const found = new Map<string, ModelProfile>();
  for (const slot of slots) {
    if (!slot.enabled || slot.authInvalid) continue;
    for (const m of MODEL_CATALOG) if (slotSupportsModel(slot, m)) found.set(m.id, m);
    for (const id of slot.allowedModels) {
      if (MODEL_CATALOG.some((m) => m.id === id || m.upstreamModelId === id)) continue;
      const custom = resolveModelForCustomProvider(id, slot.provider);
      if (!found.has(custom.id)) found.set(custom.id, custom);
    }
  }
  return [...found.values()];
}
function slotSupportsModel(slot: KeySlotMetadata, model: ModelProfile): boolean {
  const googlePair =
    (slot.provider === 'google-oauth' && model.provider === 'google-ai-studio') ||
    (slot.provider === 'google-ai-studio' && model.provider === 'google-oauth');
  if (model.provider !== slot.provider && slot.provider !== 'openai-compat' && !googlePair) {
    return false;
  }
  if ((slot.provider === 'google-ai-studio' || slot.provider === 'google-oauth') && slot.tier === 'free' && !model.availableOnFreeTier) {
    return false;
  }
  if (slot.allowedModels.length > 0 && !slot.allowedModels.includes(model.id) && !slot.allowedModels.includes(model.upstreamModelId)) {
    return false;
  }
  return true;
}

function scoreCandidate(
  slot: KeySlotMetadata,
  model: ModelProfile,
  policy: RoutingPolicy,
  requestedModel: string
): number {
  let score = slot.priority * 10;
  if (requestedModel && (model.id === requestedModel || model.upstreamModelId === requestedModel)) {
    score += 120;
  }

  if (policy === 'economy') {
    if (model.tierClass === 'local') score += 95;
    else if (model.tierClass === 'economy') score += 80;
    else if (model.tierClass === 'balanced') score += 45;
    else score += 10;
    score -= (model.inputCostPer1MUsd + model.outputCostPer1MUsd) * 4;
  } else if (policy === 'balanced') {
    if (model.tierClass === 'balanced') score += 80;
    else if (model.tierClass === 'frontier') score += 60;
    else if (model.tierClass === 'economy') score += 50;
    else score += 35;
  } else if (policy === 'frontier') {
    if (model.tierClass === 'frontier') score += 90;
    else if (model.tierClass === 'balanced') score += 55;
    else score += 20;
  }

  if (slot.tier === 'paid') score += 8;
  if (slot.provider === 'ollama') score += 5;
  return score;
}

function diagnoseEmptyCandidates(stats: {
  enabledCount: number;
  blockedByPrivacyCount: number;
  coolingDownCount: number;
  authInvalidCount: number;
  minRetryAfterMs: number;
}): RoutePlanResult {
  const { enabledCount, blockedByPrivacyCount, coolingDownCount, authInvalidCount, minRetryAfterMs } = stats;

  if (blockedByPrivacyCount > 0 && blockedByPrivacyCount + authInvalidCount + coolingDownCount === enabledCount && coolingDownCount === 0) {
    return {
      ok: false,
      code: 'PRIVACY_BLOCKED',
      message:
        'PrivacyGuard blocked Google AI Studio Free Tier keys because sensitivity is set to confidential. Add a Paid Tier key, OpenRouter, or local Ollama, or mark the prompt as public.',
      retryAfterMs: 0,
      blockedByPrivacyCount,
      coolingDownCount
    };
  }

  if (coolingDownCount > 0) {
    return {
      ok: false,
      code: 'ALL_SLOTS_COOLING_DOWN',
      message: 'All eligible slots are temporarily cooling down after HTTP 429/503.',
      retryAfterMs: Number.isFinite(minRetryAfterMs) ? Math.max(0, Math.round(minRetryAfterMs)) : 15_000,
      blockedByPrivacyCount,
      coolingDownCount
    };
  }

  if (authInvalidCount === enabledCount) {
    return {
      ok: false,
      code: 'AUTH_INVALID',
      message: 'All enabled slots have invalid credentials (HTTP 401/403). Update or re-test your API keys.',
      retryAfterMs: 0,
      blockedByPrivacyCount,
      coolingDownCount
    };
  }

  return {
    ok: false,
    code: 'NO_ELIGIBLE_SLOT',
    message: 'No enabled slot matches the requested model and routing policy.',
    retryAfterMs: 0,
    blockedByPrivacyCount,
    coolingDownCount
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
