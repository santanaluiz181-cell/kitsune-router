import type { CompletionResponse, KeySlotMetadata, ProviderKind } from '../domain/types.ts';
import type { ProviderPort, ProviderSendInput } from '../ports/contracts.ts';
import { AnthropicAdapter } from './anthropic_adapter.ts';
import { GeminiApiAdapter } from './gemini_adapter.ts';
import { OpenAICompatAdapter } from './openai_compat_adapter.ts';

export class MultiProviderAdapter implements ProviderPort {
  private readonly gemini: ProviderPort;
  private readonly anthropic: ProviderPort;
  private readonly openaiCompat: ProviderPort;

  constructor(
    gemini: ProviderPort = new GeminiApiAdapter(),
    anthropic: ProviderPort = new AnthropicAdapter(),
    openaiCompat: ProviderPort = new OpenAICompatAdapter()
  ) {
    this.gemini = gemini;
    this.anthropic = anthropic;
    this.openaiCompat = openaiCompat;
  }

  sendCompletion(input: ProviderSendInput): Promise<CompletionResponse> {
    return this.resolveAdapter(input.slot.provider).sendCompletion(input);
  }

  healthCheck(slot: KeySlotMetadata, secret: string): Promise<{ ok: boolean; status: number; detail: string }> {
    return this.resolveAdapter(slot.provider).healthCheck(slot, secret);
  }

  private resolveAdapter(provider: ProviderKind): ProviderPort {
    if (provider === 'google-ai-studio' || provider === 'google-oauth') {
      return this.gemini;
    }
    if (provider === 'anthropic') {
      return this.anthropic;
    }
    return this.openaiCompat;
  }
}
