import { MODEL_CATALOG } from '../domain/model_catalog.ts';
import { estimateCostUsd, evaluateFailure, markSlotHealthy, selectRoute } from '../domain/router_engine.ts';
import type {
  CompletionResponse,
  KeySlotMetadata,
  MascotMood,
  ModelProfile,
  RouteFailureCode,
  RouteRequest,
  RouterConfig,
  RoutingPolicy,
  SensitivityLevel,
  UsageSummary
} from '../domain/types.ts';
import { ProviderRequestError } from '../ports/contracts.ts';
import type { LedgerPort, ProviderPort, SlotCreateInput, VaultPort } from '../ports/contracts.ts';

export type RequestSource = 'mcp' | 'http-v1' | 'playground';

export interface ExecuteCompletionInput {
  source: RequestSource;
  requestedModel?: string;
  policy?: RoutingPolicy;
  sensitivity?: SensitivityLevel;
  messages: RouteRequest['messages'];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type ExecuteCompletionResult =
  | {
      ok: true;
      completion: CompletionResponse;
      slot: KeySlotMetadata;
      model: ModelProfile;
      estimatedCostUsd: number;
      estimatedSavingsUsd: number;
      fallbackUsed: boolean;
      attemptedSlots: string[];
    }
  | {
      ok: false;
      code: RouteFailureCode | 'UPSTREAM_EXHAUSTED';
      httpStatus: number;
      message: string;
      retryAfterMs: number;
      blockedByPrivacyCount: number;
      attemptedSlots: string[];
    };

export interface MascotEventPayload {
  type: 'mood' | 'usage_updated' | 'slots_updated' | 'config_updated';
  mood?: MascotMood;
  reason?: string;
  modelId?: string;
  slotLabel?: string;
  retryAfterMs?: number;
  costUsd?: number;
  savingsUsd?: number;
  timestampIso: string;
}

export interface RouterStateSnapshot {
  config: RouterConfig;
  slots: KeySlotMetadata[];
  catalog: ReadonlyArray<ModelProfile>;
  usage: UsageSummary;
  activeMood: MascotEventPayload;
}

interface OrchestratorDeps {
  vault: VaultPort;
  ledger: LedgerPort;
  provider: ProviderPort;
}

export class RouterOrchestrator {
  private readonly vault: VaultPort;
  private readonly ledger: LedgerPort;
  private readonly provider: ProviderPort;
  private readonly listeners: Set<(event: MascotEventPayload) => void>;
  private lastMoodEvent: MascotEventPayload;

  constructor(deps: OrchestratorDeps) {
    this.vault = deps.vault;
    this.ledger = deps.ledger;
    this.provider = deps.provider;
    this.listeners = new Set();
    this.lastMoodEvent = {
      type: 'mood',
      mood: 'idle',
      reason: 'Kitsune pronto para rotear',
      timestampIso: new Date().toISOString()
    };
  }

  subscribe(listener: (event: MascotEventPayload) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStateSnapshot(ledgerLimit: number = 30): RouterStateSnapshot {
    return {
      config: this.vault.getConfig(),
      slots: this.vault.listSlotMetadata(),
      catalog: MODEL_CATALOG,
      usage: this.ledger.querySummary(ledgerLimit),
      activeMood: this.lastMoodEvent
    };
  }

  async setActiveProfile(patch: Partial<RouterConfig>): Promise<RouterConfig> {
    const current = this.vault.getConfig();
    const next: RouterConfig = {
      activeModelId: cleanString(patch.activeModelId) || current.activeModelId,
      policy: patch.policy ?? current.policy,
      defaultSensitivity: patch.defaultSensitivity ?? current.defaultSensitivity,
      httpPort: isValidPort(patch.httpPort) ? patch.httpPort : current.httpPort
    };
    await this.vault.saveConfig(next);
    this.emit({ type: 'config_updated', timestampIso: new Date().toISOString() });
    return next;
  }

  async upsertSlot(input: SlotCreateInput): Promise<KeySlotMetadata> {
    const saved = await this.vault.upsertSlot(input);
    this.emit({ type: 'slots_updated', timestampIso: new Date().toISOString() });
    return saved;
  }

  async deleteSlot(slotId: string): Promise<boolean> {
    const removed = await this.vault.deleteSlot(slotId);
    if (removed) {
      this.emit({ type: 'slots_updated', timestampIso: new Date().toISOString() });
    }
    return removed;
  }

  async toggleSlotEnabled(slotId: string, enabled: boolean): Promise<KeySlotMetadata | null> {
    const slot = this.vault.getSlotMetadata(slotId);
    if (!slot) {
      return null;
    }
    const updated: KeySlotMetadata = { ...slot, enabled };
    await this.vault.updateSlotMetadata(updated);
    this.emit({ type: 'slots_updated', timestampIso: new Date().toISOString() });
    return updated;
  }

  resetLedger(): void {
    this.ledger.reset();
    this.emit({ type: 'usage_updated', timestampIso: new Date().toISOString() });
  }

  triggerMood(mood: MascotMood, reason: string): void {
    this.emitMood(mood, reason);
  }

  relayExternalEvent(event: MascotEventPayload): void {
    if (event.type === 'mood' && event.mood) {
      this.lastMoodEvent = event;
    }
    this.emit(event);
  }

  async testSlot(slotId: string): Promise<{ ok: boolean; status: number; detail: string; slot?: KeySlotMetadata }> {
    const slot = this.vault.getSlotMetadata(slotId);
    if (!slot) {
      return { ok: false, status: 404, detail: 'Slot nao encontrado no cofre.' };
    }
    const secret = (await this.vault.getSecret(slot.id)) ?? '';
    if (slot.provider !== 'ollama' && !secret.trim()) {
      return { ok: false, status: 400, detail: 'Chave secreta ausente no cofre.', slot };
    }

    this.emitMood('routing', `Testando ${slot.label}`, undefined, slot.label);
    const probe = await this.provider.healthCheck(slot, secret);
    const nowIso = new Date().toISOString();
    const updated = probe.ok
      ? markSlotHealthy(slot, nowIso)
      : evaluateFailure(slot, probe.status, null, probe.detail);

    await this.vault.updateSlotMetadata(updated);
    this.emit({ type: 'slots_updated', timestampIso: nowIso });
    this.emitMood(probe.ok ? 'vault_save' : 'key_trash', probe.detail, undefined, slot.label);

    return { ok: probe.ok, status: probe.status, detail: probe.detail, slot: updated };
  }

  async executeCompletion(input: ExecuteCompletionInput): Promise<ExecuteCompletionResult> {
    const config = this.vault.getConfig();
    const routeReq: RouteRequest = {
      requestedModel: cleanString(input.requestedModel) || config.activeModelId,
      policy: input.policy ?? config.policy,
      sensitivity: input.sensitivity ?? config.defaultSensitivity,
      messages: Array.isArray(input.messages) ? input.messages : [],
      temperature: input.temperature,
      maxTokens: input.maxTokens
    };

    const plan = selectRoute(routeReq, this.vault.listSlotMetadata());
    if (!plan.ok) {
      return this.handleUnplannedRoute(input.source, routeReq, plan);
    }

    const first = plan.candidates[0];
    this.emitMood('routing', `Roteando para ${first.slot.label}`, first.model.id, first.slot.label);
    return this.runCandidateLoop(input.source, routeReq, plan.candidates, plan.blockedByPrivacyCount, input.signal);
  }

  private async runCandidateLoop(
    source: RequestSource,
    routeReq: RouteRequest,
    candidates: ReadonlyArray<{ slot: KeySlotMetadata; model: ModelProfile }>,
    blockedByPrivacyCount: number,
    signal?: AbortSignal
  ): Promise<ExecuteCompletionResult> {
    const attemptedSlots: string[] = [];
    let lastStatus = 502;
    let lastError = 'Todos os slots elegiveis falharam.';
    let maxRetryAfter = 0;

    for (let i = 0; i < candidates.length; i++) {
      if (signal?.aborted) {
        this.emitMood('dizzy', 'Requisicao cancelada pelo cliente.', routeReq.requestedModel);
        return buildAbortedResult(blockedByPrivacyCount, attemptedSlots);
      }
      const candidate = candidates[i];
      attemptedSlots.push(candidate.slot.id);
      const outcome = await this.tryCandidate(source, routeReq, candidate, signal);

      if (outcome.ok) {
        const msg = i > 0 ? `Fallback concluido via ${candidate.slot.label}` : `Respondido por ${candidate.slot.label}`;
        this.emitMood('celebrating', msg, candidate.model.id, candidate.slot.label, 0, outcome.result.estimatedCostUsd, outcome.result.estimatedSavingsUsd);
        return { ...outcome.result, fallbackUsed: i > 0, attemptedSlots };
      }

      lastStatus = outcome.httpStatus;
      lastError = outcome.message;
      maxRetryAfter = Math.max(maxRetryAfter, outcome.retryAfterMs);

      if (i + 1 < candidates.length) {
        this.emitMood('warning', `${candidate.slot.label} HTTP ${outcome.httpStatus}, alternando`, candidate.model.id, candidate.slot.label);
      }
    }

    this.emitMood('exhausted', lastError, routeReq.requestedModel);
    return {
      ok: false,
      code: 'UPSTREAM_EXHAUSTED',
      httpStatus: lastStatus === 429 ? 429 : 502,
      message: lastError,
      retryAfterMs: maxRetryAfter,
      blockedByPrivacyCount,
      attemptedSlots
    };
  }

  private async tryCandidate(
    source: RequestSource,
    routeReq: RouteRequest,
    candidate: { slot: KeySlotMetadata; model: ModelProfile },
    signal?: AbortSignal
  ): Promise<
    | { ok: true; result: Omit<Extract<ExecuteCompletionResult, { ok: true }>, 'fallbackUsed' | 'attemptedSlots'> }
    | { ok: false; httpStatus: number; retryAfterMs: number; message: string }
  > {
    const startedAt = Date.now();
    const secret = (await this.vault.getSecret(candidate.slot.id)) ?? '';
    if (candidate.slot.provider !== 'ollama' && !secret.trim()) {
      return this.recordCandidateFailure(source, routeReq.sensitivity, candidate, 401, null, 'Chave secreta ausente no cofre', 0);
    }

    try {
      const completion = await this.provider.sendCompletion({
        slot: candidate.slot,
        secret,
        model: candidate.model,
        messages: routeReq.messages,
        temperature: routeReq.temperature,
        maxTokens: routeReq.maxTokens,
        signal
      });
      const nowIso = new Date().toISOString();
      const healthy = markSlotHealthy(candidate.slot, nowIso);
      await this.vault.updateSlotMetadata(healthy);
      const cost = estimateCostUsd(candidate.model, completion.inputTokens, completion.outputTokens);
      this.ledger.record({
        timestampIso: nowIso,
        source,
        slotId: healthy.id,
        slotLabel: healthy.label,
        provider: healthy.provider,
        modelId: candidate.model.id,
        sensitivity: routeReq.sensitivity,
        status: 'ok',
        httpStatus: 200,
        latencyMs: completion.latencyMs,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        estimatedCostUsd: cost.costUsd,
        estimatedSavingsUsd: cost.savingsUsd,
        errorMessage: null
      });
      this.emit({ type: 'slots_updated', timestampIso: nowIso });
      this.emit({ type: 'usage_updated', timestampIso: nowIso });
      return {
        ok: true,
        result: {
          ok: true,
          completion,
          slot: healthy,
          model: candidate.model,
          estimatedCostUsd: cost.costUsd,
          estimatedSavingsUsd: cost.savingsUsd
        }
      };
    } catch (err) {
      const status = err instanceof ProviderRequestError ? err.httpStatus : 502;
      const retryMs = err instanceof ProviderRequestError ? err.retryAfterMs : null;
      const message = err instanceof Error ? err.message : 'Falha de comunicacao com provedor';
      return this.recordCandidateFailure(
        source,
        routeReq.sensitivity,
        candidate,
        status,
        retryMs,
        message,
        Date.now() - startedAt
      );
    }
  }

  private async recordCandidateFailure(
    source: RequestSource,
    sensitivity: SensitivityLevel,
    candidate: { slot: KeySlotMetadata; model: ModelProfile },
    httpStatus: number,
    retryAfterMs: number | null,
    message: string,
    latencyMs: number
  ): Promise<{ ok: false; httpStatus: number; retryAfterMs: number; message: string }> {
    const failedSlot = evaluateFailure(candidate.slot, httpStatus, retryAfterMs, message);
    await this.vault.updateSlotMetadata(failedSlot);
    const nowIso = new Date().toISOString();
    this.ledger.record({
      timestampIso: nowIso,
      source,
      slotId: failedSlot.id,
      slotLabel: failedSlot.label,
      provider: failedSlot.provider,
      modelId: candidate.model.id,
      sensitivity,
      status: 'fallback_failed',
      httpStatus,
      latencyMs: Math.max(0, latencyMs),
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      estimatedSavingsUsd: 0,
      errorMessage: message
    });
    this.emit({ type: 'slots_updated', timestampIso: nowIso });
    this.emit({ type: 'usage_updated', timestampIso: nowIso });
    return {
      ok: false,
      httpStatus,
      retryAfterMs: retryAfterMs ?? Math.max(0, failedSlot.cooldownUntilMs - Date.now()),
      message
    };
  }

  private handleUnplannedRoute(
    source: RequestSource,
    routeReq: RouteRequest,
    plan: Extract<ReturnType<typeof selectRoute>, { ok: false }>
  ): ExecuteCompletionResult {
    const httpStatus = mapFailureHttpStatus(plan.code);
    const mood: MascotMood =
      plan.code === 'PRIVACY_BLOCKED'
        ? 'blocked'
        : plan.code === 'INVALID_INPUT'
          ? 'warning'
          : 'exhausted';

    const nowIso = new Date().toISOString();
    this.ledger.record({
      timestampIso: nowIso,
      source,
      slotId: 'router-policy',
      slotLabel: 'Router Policy',
      provider: 'google-ai-studio',
      modelId: routeReq.requestedModel || 'none',
      sensitivity: routeReq.sensitivity,
      status: plan.code === 'PRIVACY_BLOCKED' ? 'privacy_blocked' : 'error',
      httpStatus,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      estimatedSavingsUsd: 0,
      errorMessage: plan.message
    });

    this.emit({ type: 'usage_updated', timestampIso: nowIso });
    this.emitMood(mood, plan.message, routeReq.requestedModel, undefined, plan.retryAfterMs);

    return {
      ok: false,
      code: plan.code,
      httpStatus,
      message: plan.message,
      retryAfterMs: plan.retryAfterMs,
      blockedByPrivacyCount: plan.blockedByPrivacyCount,
      attemptedSlots: []
    };
  }

  private emitMood(
    mood: MascotMood,
    reason: string,
    modelId?: string,
    slotLabel?: string,
    retryAfterMs?: number,
    costUsd?: number,
    savingsUsd?: number
  ): void {
    const payload: MascotEventPayload = {
      type: 'mood',
      mood,
      reason,
      modelId,
      slotLabel,
      retryAfterMs,
      costUsd,
      savingsUsd,
      timestampIso: new Date().toISOString()
    };
    this.lastMoodEvent = payload;
    this.emit(payload);
  }

  private emit(event: MascotEventPayload): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener failures stay isolated from routing execution.
      }
    }
  }
}

function buildAbortedResult(blockedByPrivacyCount: number, attemptedSlots: string[]): ExecuteCompletionResult {
  return {
    ok: false,
    code: 'UPSTREAM_EXHAUSTED',
    httpStatus: 499,
    message: 'Requisicao cancelada pelo cliente.',
    retryAfterMs: 0,
    blockedByPrivacyCount,
    attemptedSlots
  };
}

function mapFailureHttpStatus(code: RouteFailureCode): number {
  if (code === 'INVALID_INPUT') return 400;
  if (code === 'PRIVACY_BLOCKED') return 403;
  if (code === 'ALL_SLOTS_COOLING_DOWN') return 429;
  return 503;
}

function cleanString(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidPort(port: number | undefined): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535;
}
