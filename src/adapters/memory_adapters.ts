import { DEFAULT_BASE_URLS } from '../domain/model_catalog.ts';
import type {
  CompletionResponse,
  KeySlotMetadata,
  RouterConfig,
  UsageLedgerEntry,
  UsageSummary
} from '../domain/types.ts';
import { ProviderRequestError } from '../ports/contracts.ts';
import type {
  LedgerPort,
  ProviderPort,
  ProviderSendInput,
  SlotCreateInput,
  VaultPort
} from '../ports/contracts.ts';

type MockScriptedOutcome =
  | { type: 'ok'; text: string; inputTokens?: number; outputTokens?: number; latencyMs?: number }
  | { type: 'error'; status: number; message: string; retryAfterMs?: number | null };

export class MemoryProviderAdapter implements ProviderPort {
  private readonly queuesBySlot: Map<string, MockScriptedOutcome[]>;
  readonly callLog: Array<{ slotId: string; modelId: string; secret: string }>;

  constructor(initialOutcomes?: Record<string, MockScriptedOutcome[]>) {
    this.queuesBySlot = new Map();
    this.callLog = [];
    if (initialOutcomes) {
      for (const [slotId, items] of Object.entries(initialOutcomes)) {
        this.queuesBySlot.set(slotId, [...items]);
      }
    }
  }

  enqueueOutcome(slotId: string, outcome: MockScriptedOutcome): void {
    const queue = this.queuesBySlot.get(slotId) ?? [];
    queue.push(outcome);
    this.queuesBySlot.set(slotId, queue);
  }

  async sendCompletion(input: ProviderSendInput): Promise<CompletionResponse> {
    this.callLog.push({ slotId: input.slot.id, modelId: input.model.id, secret: input.secret });
    const queue = this.queuesBySlot.get(input.slot.id);
    const scripted = queue && queue.length > 0 ? queue.shift() : undefined;

    if (scripted?.type === 'error') {
      throw new ProviderRequestError(scripted.message, scripted.status, scripted.retryAfterMs ?? null);
    }

    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    return {
      text: scripted?.text ?? `[${input.slot.label}/${input.model.id}] ${lastUser}`,
      modelId: input.model.id,
      provider: input.slot.provider,
      inputTokens: scripted?.inputTokens ?? 120,
      outputTokens: scripted?.outputTokens ?? 60,
      latencyMs: scripted?.latencyMs ?? 12,
      finishReason: 'STOP'
    };
  }

  async healthCheck(slot: KeySlotMetadata, secret: string): Promise<{ ok: boolean; status: number; detail: string }> {
    const queue = this.queuesBySlot.get(slot.id);
    const next = queue?.[0];
    if (next?.type === 'error') {
      return { ok: false, status: next.status, detail: next.message };
    }
    if (slot.provider !== 'ollama' && !secret.trim()) {
      return { ok: false, status: 401, detail: 'Chave vazia' };
    }
    return { ok: true, status: 200, detail: `Simulacao OK (${slot.label})` };
  }
}

export class MemoryVaultAdapter implements VaultPort {
  private readonly metadata: Map<string, KeySlotMetadata>;
  private readonly secrets: Map<string, string>;
  private config: RouterConfig;

  constructor(initialConfig?: Partial<RouterConfig>) {
    this.metadata = new Map();
    this.secrets = new Map();
    this.config = {
      activeModelId: initialConfig?.activeModelId ?? 'gemini-3.8-flash',
      policy: initialConfig?.policy ?? 'balanced',
      defaultSensitivity: initialConfig?.defaultSensitivity ?? 'public',
      httpPort: initialConfig?.httpPort ?? 4319
    };
  }

  listSlotMetadata(): KeySlotMetadata[] {
    return [...this.metadata.values()].map((item) => ({ ...item, allowedModels: [...item.allowedModels] }));
  }

  getSlotMetadata(slotId: string): KeySlotMetadata | undefined {
    const found = this.metadata.get(slotId);
    return found ? { ...found, allowedModels: [...found.allowedModels] } : undefined;
  }

  async upsertSlot(input: SlotCreateInput): Promise<KeySlotMetadata> {
    const existing = this.metadata.get(input.id);
    const trimmedSecret = input.secret.trim();
    const resolvedSecret = trimmedSecret || (existing ? (this.secrets.get(input.id) ?? '') : '');
    this.secrets.set(input.id, resolvedSecret);

    const next: KeySlotMetadata = {
      id: input.id,
      label: input.label.trim() || input.id,
      provider: input.provider,
      tier: input.tier,
      baseUrl: input.baseUrl.trim() || DEFAULT_BASE_URLS[input.provider],
      maskedSecret: maskKey(resolvedSecret, input.provider),
      enabled: input.enabled,
      priority: input.priority,
      allowedModels: [...input.allowedModels],
      cooldownUntilMs: existing?.cooldownUntilMs ?? 0,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      authInvalid: trimmedSecret ? false : (existing?.authInvalid ?? false),
      lastError: trimmedSecret ? null : (existing?.lastError ?? null),
      createdAtIso: existing?.createdAtIso ?? new Date().toISOString(),
      lastUsedAtIso: existing?.lastUsedAtIso ?? null
    };
    this.metadata.set(next.id, next);
    return { ...next, allowedModels: [...next.allowedModels] };
  }

  async updateSlotMetadata(slot: KeySlotMetadata): Promise<void> {
    if (!this.metadata.has(slot.id)) return;
    this.metadata.set(slot.id, { ...slot, allowedModels: [...slot.allowedModels] });
  }

  async deleteSlot(slotId: string): Promise<boolean> {
    this.secrets.delete(slotId);
    return this.metadata.delete(slotId);
  }

  async getSecret(slotId: string): Promise<string | null> {
    return this.secrets.has(slotId) ? (this.secrets.get(slotId) ?? '') : null;
  }

  getConfig(): RouterConfig {
    return { ...this.config };
  }

  async saveConfig(config: RouterConfig): Promise<void> {
    this.config = { ...config };
  }
}

export class MemoryLedgerAdapter implements LedgerPort {
  private entries: UsageLedgerEntry[];
  private seq: number;

  constructor() {
    this.entries = [];
    this.seq = 1;
  }

  record(entry: UsageLedgerEntry): void {
    this.entries.push({ ...entry, id: this.seq++ });
  }

  querySummary(limit: number = 30): UsageSummary {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    let successfulRequests = 0;
    let failedRequests = 0;
    let privacyBlockedRequests = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;
    let totalSavingsUsd = 0;

    for (const item of this.entries) {
      if (item.status === 'ok') successfulRequests++;
      else if (item.status === 'privacy_blocked') privacyBlockedRequests++;
      else failedRequests++;
      totalInputTokens += item.inputTokens;
      totalOutputTokens += item.outputTokens;
      totalCostUsd += item.estimatedCostUsd;
      totalSavingsUsd += item.estimatedSavingsUsd;
    }

    return {
      totalRequests: this.entries.length,
      successfulRequests,
      failedRequests,
      privacyBlockedRequests,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      totalSavingsUsd: Number(totalSavingsUsd.toFixed(6)),
      recentEntries: this.entries.slice(-safeLimit).reverse().map((e) => ({ ...e }))
    };
  }

  reset(): void {
    this.entries = [];
  }
}

export function maskKey(secret: string, provider: KeySlotMetadata['provider']): string {
  if (provider === 'ollama' && !secret) return 'local-no-key';
  if (secret.length <= 8) return secret ? '****' : 'unset';
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
