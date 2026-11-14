import { DEFAULT_BASE_URLS } from '../domain/model_catalog.ts';
import type { ChatMessage, CompletionResponse, KeySlotMetadata } from '../domain/types.ts';
import { ProviderRequestError } from '../ports/contracts.ts';
import type { ProviderPort, ProviderSendInput } from '../ports/contracts.ts';
import {
  combineSignals,
  extractTokenValue,
  fetchWithNetworkGuard,
  normalizeBaseUrl,
  parseRetryAfterMs,
  safeInt,
  safeJsonParse
} from './gemini_adapter.ts';

interface AnthropicContentBlock {
  type?: string;
  text?: string;
}

interface AnthropicResponseJson {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
}

export class AnthropicAdapter implements ProviderPort {
  private readonly defaultTimeoutMs: number;

  constructor(defaultTimeoutMs: number = 45_000) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  async sendCompletion(input: ProviderSendInput): Promise<CompletionResponse> {
    const startedAt = Date.now();
    const base = ensureAnthropicV1(normalizeBaseUrl(input.slot.baseUrl, DEFAULT_BASE_URLS.anthropic));
    const url = `${base}/messages`;
    const headers = buildAnthropicHeaders(input.secret);
    const payload = buildAnthropicPayload(input);
    const signal = combineSignals(input.signal, this.defaultTimeoutMs);

    const response = await fetchWithNetworkGuard(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal
    });

    const parsed = safeJsonParse<AnthropicResponseJson>(await response.text());
    if (!response.ok) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      const errorMsg = parsed?.error?.message || `Anthropic Claude HTTP ${response.status}`;
      throw new ProviderRequestError(errorMsg, response.status, retryAfterMs);
    }

    const text = (parsed?.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text ?? '')
      .join('')
      .trim();

    if (!text) {
      throw new ProviderRequestError('Anthropic Claude retornou resposta vazia', 502, null);
    }

    return {
      text,
      modelId: input.model.id,
      provider: input.slot.provider,
      inputTokens: safeInt(parsed?.usage?.input_tokens),
      outputTokens: safeInt(parsed?.usage?.output_tokens),
      latencyMs: Math.max(1, Date.now() - startedAt),
      finishReason: parsed?.stop_reason ?? 'end_turn'
    };
  }

  async healthCheck(slot: KeySlotMetadata, secret: string): Promise<{ ok: boolean; status: number; detail: string }> {
    const base = ensureAnthropicV1(normalizeBaseUrl(slot.baseUrl, DEFAULT_BASE_URLS.anthropic));
    const url = `${base}/models?limit=1`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: buildAnthropicHeaders(secret),
        signal: AbortSignal.timeout(10_000)
      });
      if (res.ok) {
        return { ok: true, status: res.status, detail: `Claude / Anthropic ativo (HTTP ${res.status})` };
      }
      const parsed = safeJsonParse<AnthropicResponseJson>(await res.text());
      return {
        ok: false,
        status: res.status,
        detail: parsed?.error?.message || `Falha Claude / Anthropic (HTTP ${res.status})`
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro de rede';
      return { ok: false, status: 503, detail: `Timeout Claude / Anthropic: ${msg}` };
    }
  }
}

export function buildAnthropicHeaders(rawSecret: string): Record<string, string> {
  const token = extractTokenValue(rawSecret);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01'
  };
  if (token.startsWith('sk-ant-oat') || token.startsWith('eyJ')) {
    headers.Authorization = `Bearer ${token}`;
  } else if (token) {
    headers['x-api-key'] = token;
  }
  return headers;
}

function buildAnthropicPayload(input: ProviderSendInput): Record<string, unknown> {
  const systemParts: string[] = [];
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of input.messages as ChatMessage[]) {
    const clean = msg.content.trim();
    if (!clean) continue;
    if (msg.role === 'system') {
      systemParts.push(clean);
      continue;
    }
    const role: 'user' | 'assistant' = msg.role === 'assistant' ? 'assistant' : 'user';
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${clean}`;
    } else {
      messages.push({ role, content: clean });
    }
  }

  if (messages.length === 0) {
    messages.push({ role: 'user', content: 'Ping' });
  }

  const maxTokens =
    typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? Math.floor(input.maxTokens)
      : 4096;

  const payload: Record<string, unknown> = {
    model: input.model.upstreamModelId,
    max_tokens: maxTokens,
    messages
  };
  if (systemParts.length > 0) {
    payload.system = systemParts.join('\n\n');
  }
  if (typeof input.temperature === 'number' && Number.isFinite(input.temperature)) {
    payload.temperature = input.temperature;
  }
  return payload;
}

function ensureAnthropicV1(baseUrl: string): string {
  return /\/v1$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1`;
}
