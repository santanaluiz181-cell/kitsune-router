import type {
  ChatMessage,
  CompletionResponse,
  KeySlotMetadata,
  ModelProfile,
  RouterConfig,
  UsageLedgerEntry,
  UsageSummary
} from '../domain/types.ts';

export class ProviderRequestError extends Error {
  readonly httpStatus: number;
  readonly retryAfterMs: number | null;

  constructor(message: string, httpStatus: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'ProviderRequestError';
    this.httpStatus = httpStatus;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface ProviderSendInput {
  slot: KeySlotMetadata;
  secret: string;
  model: ModelProfile;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ProviderPort {
  sendCompletion(input: ProviderSendInput): Promise<CompletionResponse>;
  healthCheck(slot: KeySlotMetadata, secret: string): Promise<{ ok: boolean; status: number; detail: string }>;
}

export interface SlotCreateInput {
  id: string;
  label: string;
  provider: KeySlotMetadata['provider'];
  tier: KeySlotMetadata['tier'];
  baseUrl: string;
  secret: string;
  enabled: boolean;
  priority: number;
  allowedModels: string[];
}

export interface VaultPort {
  listSlotMetadata(): KeySlotMetadata[];
  getSlotMetadata(slotId: string): KeySlotMetadata | undefined;
  upsertSlot(input: SlotCreateInput): Promise<KeySlotMetadata>;
  updateSlotMetadata(slot: KeySlotMetadata): Promise<void>;
  deleteSlot(slotId: string): Promise<boolean>;
  getSecret(slotId: string): Promise<string | null>;
  getConfig(): RouterConfig;
  saveConfig(config: RouterConfig): Promise<void>;
}

export interface LedgerPort {
  record(entry: UsageLedgerEntry): void;
  querySummary(limit?: number): UsageSummary;
  reset(): void;
}
